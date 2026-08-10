const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');

const userEntries = require('../scripts/user-nom-entries');
const cli = require('../scripts/add-chu-nom');
const repoRoot = path.resolve(__dirname, '..');

function writeJson(target, value) {
  fs.mkdirSync(path.dirname(target), {recursive: true});
  fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`);
}

function makeFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zoopdog-add-nom-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));

  fs.mkdirSync(path.join(root, 'scripts'), {recursive: true});
  fs.mkdirSync(path.join(root, 'zd-extension/db_src'), {recursive: true});
  fs.mkdirSync(path.join(root, '.idea'), {recursive: true});

  writeJson(path.join(root, 'zd-extension/db_src/vnedict2.json'), [
    {
      vn: 'quản lý',
      en: [{def: '管理', pos: ''}, {def: 'manage', pos: ''}]
    },
    {
      vn: 'kiểm tra',
      en: [{def: '檢查', pos: ''}, {def: 'check', pos: ''}]
    },
    {
      vn: 'xem',
      en: [{def: '䀡', pos: ''}, {def: 'see', pos: ''}]
    },
    {
      vn: 'Sao',
      en: [{def: '𣋀', pos: ''}, {def: 'star', pos: ''}]
    },
    {
      vn: 'Vàng',
      en: [{def: '黃', pos: ''}, {def: 'yellow', pos: ''}]
    }
  ]);
  writeJson(path.join(root, 'zd-extension/db_src/mdx_nom.json'), {
    entries: {'kiểm tra': ['檢查']}
  });
  fs.writeFileSync(path.join(root, 'zd-extension/db_src/user_nom_entries.jsonc'), `[
  {
    // Existing entry comment.
    "vi": "tiếng Anh",
    "nom": ["㗂英"],
    "explain": ["English language"]
  }
]\n`);
  fs.writeFileSync(path.join(root, '.idea/newfile.md'), [
    '# Queue',
    'quan ly, kiểm tra xem',
    '---',
    'Sao Vàng / 𣋀黃 / yellow star',
    ''
  ].join('\n'));
  fs.writeFileSync(path.join(root, 'zoopdog-nom-ruby.user.js'), 'var NOM_MAP = {};\n');
  fs.writeFileSync(path.join(root, 'zoopdog-popupdict.user.js'), 'var ZOO_DICTIONARY = {};\n');

  const calls = [];
  const commandRunner = (command, args, options) => {
    calls.push({command, args: [...args], cwd: options.cwd});
    return {status: 0, stdout: '', stderr: ''};
  };

  return {root, calls, commandRunner};
}

function installRealBuilders(fixtureRoot) {
  for (const script of [
    'user-nom-entries.js',
    'build-nom-userscript.js',
    'build-popupdict-userscript.js'
  ]) {
    fs.copyFileSync(
      path.join(repoRoot, 'scripts', script),
      path.join(fixtureRoot, 'scripts', script)
    );
  }
  for (const relative of [
    'zd-extension/js/lib/chroma.min.js',
    'zd-extension/js/zd-pron-data.js',
    'zd-extension/js/zd-pron-functions.js',
    'zd-extension/js/zd-pron-drawtones.js'
  ]) {
    const target = path.join(fixtureRoot, relative);
    fs.mkdirSync(path.dirname(target), {recursive: true});
    fs.writeFileSync(target, '// isolated fixture runtime\n');
  }
}

function captureIo() {
  let stdout = '';
  let stderr = '';
  return {
    io: {
      stdout: {write: (value) => { stdout += String(value); }},
      stderr: {write: (value) => { stderr += String(value); }}
    },
    stdout: () => stdout,
    stderr: () => stderr
  };
}

function approveActionable(manifest) {
  for (const entry of manifest.entries) {
    if (entry.status === 'skipped') {
      continue;
    }
    entry.decision = entry.nom.length ? 'apply' : 'reject';
  }
  return manifest;
}

test('existing user entry parser preserves Vietnamese text and normalizes lookup keys', () => {
  const parsed = userEntries.parseUserNomEntries(`[
    {
      // Keep this comment parseable.
      "vi": "  Quản   Lý  ",
      "nom": ["管理"],
      "explain": "manage",
    },
  ]`, 'fixture.jsonc');

  assert.deepEqual(parsed, [{
    vi: 'Quản   Lý',
    key: 'quản lý',
    nom: ['管理'],
    explain: ['manage']
  }]);
});

test('user entry module exposes the existing normalization helpers for reuse', () => {
  assert.equal(userEntries.cleanText('\uFEFF  tiếng Anh  '), 'tiếng Anh');
  assert.equal(userEntries.normalizeTerm('  Quản   Lý  '), 'quản lý');
  assert.equal(
    userEntries.stripJsonComments('{/* note */"ok": true,}'),
    '{"ok": true}'
  );
  assert.deepEqual(userEntries.asTextArray([' a ', '', 'b']), ['a', 'b']);
});

test('shared helper refactor keeps both generated userscripts byte-identical', () => {
  const targets = [
    path.join(repoRoot, 'zoopdog-nom-ruby.user.js'),
    path.join(repoRoot, 'zoopdog-popupdict.user.js')
  ];
  const before = targets.map((target) => fs.readFileSync(target));

  try {
    execFileSync(process.execPath, ['scripts/build-nom-userscript.js'], {
      cwd: repoRoot,
      stdio: 'pipe'
    });
    execFileSync(process.execPath, ['scripts/build-popupdict-userscript.js'], {
      cwd: repoRoot,
      stdio: 'pipe'
    });

    targets.forEach((target, index) => {
      assert.deepEqual(fs.readFileSync(target), before[index]);
    });
  } finally {
    targets.forEach((target, index) => {
      if (!fs.readFileSync(target).equals(before[index])) {
        fs.writeFileSync(target, before[index]);
      }
    });
  }
});

test('CLI module exposes an importable main function and stable exit codes', () => {
  assert.equal(typeof cli.main, 'function');
  assert.deepEqual(cli.EXIT_CODES, {
    SUCCESS: 0,
    VALIDATION: 2,
    STALE: 3,
    APPLY_FAILED: 4
  });
});

test('file mentions and Markdown input are parsed with stable source coordinates', () => {
  assert.deepEqual(cli.parseFileMention('notes.md#L2-L4'), {
    path: 'notes.md',
    startLine: 2,
    endLine: 4
  });
  assert.deepEqual(cli.parseFileMention('notes.md#L6-7'), {
    path: 'notes.md',
    startLine: 6,
    endLine: 7
  });

  const items = cli.parseInputText([
    '# Queue',
    'quan ly, kiểm tra xem',
    '---',
    'Sao Vàng / 𣋀黃 / yellow star'
  ].join('\n'), {startLine: 2, endLine: 4});

  assert.deepEqual(items, [
    {
      id: 'L2:I1',
      line: 2,
      itemIndex: 1,
      original: 'quan ly',
      inlineNom: [],
      inlineExplain: []
    },
    {
      id: 'L2:I2',
      line: 2,
      itemIndex: 2,
      original: 'kiểm tra xem',
      inlineNom: [],
      inlineExplain: []
    },
    {
      id: 'L4:I1',
      line: 4,
      itemIndex: 1,
      original: 'Sao Vàng',
      inlineNom: ['𣋀黃'],
      inlineExplain: ['yellow star']
    }
  ]);
});

test('input parsing preserves comma-rich inline explanations and compresses empty separators', () => {
  assert.deepEqual(
    cli.parseInputText('Sao Vàng / 𣋀黃 / yellow star, proper name'),
    [{
      id: 'L1:I1',
      line: 1,
      itemIndex: 1,
      original: 'Sao Vàng',
      inlineNom: ['𣋀黃'],
      inlineExplain: ['yellow star, proper name']
    }]
  );
  assert.deepEqual(
    cli.parseInputText('một,,hai').map((item) => item.id),
    ['L1:I1', 'L1:I2']
  );
  assert.deepEqual(
    cli.parseInputText('a / 阿 / letter | b').map((item) => ({
      original: item.original,
      explain: item.inlineExplain
    })),
    [
      {original: 'a', explain: ['letter']},
      {original: 'b', explain: []}
    ]
  );
});

test('mixed Vietnamese/CJK lines discard annotations before dictionary resolution', (t) => {
  const items = cli.parseInputText([
    'đích的 thực食',
    '',
    '純漢字\u0301！？',
    'đánh打 lạc洛'
  ].join('\n'));

  assert.deepEqual(items, [
    {
      id: 'L1:I1',
      line: 1,
      itemIndex: 1,
      original: 'đích thực',
      rawInput: 'đích的 thực食',
      inlineNom: [],
      inlineExplain: [],
      filteredInput: true
    },
    {
      id: 'L4:I1',
      line: 4,
      itemIndex: 1,
      original: 'đánh lạc',
      rawInput: 'đánh打 lạc洛',
      inlineNom: [],
      inlineExplain: [],
      filteredInput: true
    }
  ]);

  const fixture = makeFixture(t);
  const manifest = cli.createPlan({
    repoRoot: fixture.root,
    words: 'đích的 thực食\nđánh打 lạc洛'
  });
  assert.deepEqual(manifest.entries.map((entry) => ({
    original: entry.original,
    vi: entry.vi,
    nom: entry.nom,
    status: entry.status,
    provenance: entry.provenance
  })), [
    {
      original: 'đích的 thực食',
      vi: 'đích thực',
      nom: [],
      status: 'needs-review',
      provenance: ['input-filtered']
    },
    {
      original: 'đánh打 lạc洛',
      vi: 'đánh lạc',
      nom: [],
      status: 'needs-review',
      provenance: ['input-filtered']
    }
  ]);
  assert.match(manifest.entries[0].notes.join(' '), /filtered.*dictionary.*AI review/i);
  assert.equal(manifest.entries.some((entry) => entry.nom.includes('的食') || entry.nom.includes('打洛')), false);

  assert.deepEqual(
    cli.parseInputText([
      'đích (的) thực',
      'đích的\u0301 thực食',
      'đích-的thực食!'
    ].join('\n')).map((item) => item.original),
    ['đích thực', 'đích thực', 'đích thực']
  );

  const oneLinePlan = cli.createPlan({
    repoRoot: fixture.root,
    words: 'kiểm檢 tra查 xem'
  });
  assert.equal(oneLinePlan.entries.length, 1);
  assert.equal(oneLinePlan.entries[0].vi, 'kiểm tra xem');
  assert.equal(oneLinePlan.entries[0].provenance.includes('input-filtered'), true);
});

test('Vietnamese accent folding and typo distance are deterministic', () => {
  assert.equal(cli.foldAccents('  Đặng   Văn  '), 'dang van');
  assert.equal(cli.levenshtein('quan ly', 'quan li'), 1);
  assert.equal(cli.levenshtein('abc', 'xyz'), 3);
});

test('planner restores unique diacritics, expands known phrases, and composes in Vietnamese order', (t) => {
  const fixture = makeFixture(t);
  const manifest = cli.createPlan({
    repoRoot: fixture.root,
    words: 'quan ly | kiểm tra xem | Sao Vàng / 𣋀黃 / yellow star'
  });

  assert.equal(manifest.schemaVersion, 1);
  assert.deepEqual(manifest.entries.map((entry) => entry.key), [
    'quản lý',
    'kiểm tra xem',
    'kiểm tra',
    'sao vàng'
  ]);

  const manager = manifest.entries[0];
  assert.equal(manager.vi, 'quản lý');
  assert.deepEqual(manager.nom, ['管理']);
  assert.deepEqual(manager.explain, ['manage']);
  assert.equal(manager.status, 'proposed');

  const composed = manifest.entries[1];
  assert.deepEqual(composed.nom, ['檢查䀡']);
  assert.equal(composed.status, 'needs-review');
  assert.match(composed.notes.join(' '), /composed/i);

  const inline = manifest.entries[3];
  assert.deepEqual(inline.nom, ['𣋀黃']);
  assert.deepEqual(inline.explain, ['yellow star']);
});

test('planner surfaces every locally supported phrase composition instead of choosing one', (t) => {
  const fixture = makeFixture(t);
  const dictionaryPath = path.join(fixture.root, 'zd-extension/db_src/vnedict2.json');
  const dictionary = JSON.parse(fs.readFileSync(dictionaryPath, 'utf8'));
  dictionary.push(
    {vn: 'a b', en: [{def: '甲', pos: ''}]},
    {vn: 'c', en: [{def: '丙', pos: ''}]},
    {vn: 'a', en: [{def: '阿', pos: ''}]},
    {vn: 'b c', en: [{def: '乙', pos: ''}]}
  );
  writeJson(dictionaryPath, dictionary);

  const manifest = cli.createPlan({repoRoot: fixture.root, words: 'a b c'});
  assert.deepEqual(manifest.entries[0].nom, ['甲丙', '阿乙']);
  assert.equal(manifest.entries[0].status, 'needs-review');
});

test('planner reports folded ambiguity, bounded typo choices, and existing user skips', (t) => {
  const fixture = makeFixture(t);
  const dictionaryPath = path.join(fixture.root, 'zd-extension/db_src/vnedict2.json');
  const dictionary = JSON.parse(fs.readFileSync(dictionaryPath, 'utf8'));
  dictionary.push(
    {vn: 'má', en: [{def: '媽', pos: ''}, {def: 'mother', pos: ''}]},
    {vn: 'mà', en: [{def: '麻', pos: ''}, {def: 'but', pos: ''}]}
  );
  writeJson(dictionaryPath, dictionary);

  const manifest = cli.createPlan({
    repoRoot: fixture.root,
    words: 'ma | quan li | tieng anh'
  });

  assert.deepEqual(manifest.entries[0].choices, ['mà', 'má']);
  assert.equal(manifest.entries[0].status, 'needs-review');
  assert.deepEqual(manifest.entries[1].choices, ['quản lý']);
  assert.equal(manifest.entries[1].status, 'needs-review');
  assert.equal(manifest.entries[2].key, 'tiếng anh');
  assert.equal(manifest.entries[2].status, 'skipped');
});

test('plan CLI writes a byte-stable manifest and structured output without source mutation', (t) => {
  const fixture = makeFixture(t);
  const manifestPath = path.join(fixture.root, 'tmp', 'plan.json');
  const inputPath = path.join(fixture.root, '.idea/newfile.md');
  const beforeInput = fs.readFileSync(inputPath);
  const firstIo = captureIo();

  const firstExit = cli.main([
    'plan',
    '--file', '.idea/newfile.md#L2-L4',
    '--manifest', manifestPath,
    '--repo-root', fixture.root
  ], firstIo.io);
  const firstManifest = fs.readFileSync(manifestPath);

  const secondIo = captureIo();
  const secondExit = cli.main([
    'plan',
    '--file', '.idea/newfile.md#L2-L4',
    '--manifest', manifestPath,
    '--repo-root', fixture.root
  ], secondIo.io);

  assert.equal(firstExit, cli.EXIT_CODES.SUCCESS);
  assert.equal(secondExit, cli.EXIT_CODES.SUCCESS);
  assert.deepEqual(fs.readFileSync(manifestPath), firstManifest);
  assert.deepEqual(fs.readFileSync(inputPath), beforeInput);
  assert.equal(JSON.parse(firstIo.stdout()).action, 'plan');
  assert.equal(firstIo.stderr(), '');
});

test('plan CLI rejects mutually exclusive input arguments with structured validation output', (t) => {
  const fixture = makeFixture(t);
  const output = captureIo();
  const manifestPath = path.join(fixture.root, 'plan.json');

  const exitCode = cli.main([
    'plan', '--words', 'quản lý', '--file', '.idea/newfile.md',
    '--manifest', manifestPath, '--repo-root', fixture.root
  ], output.io);

  assert.equal(exitCode, cli.EXIT_CODES.VALIDATION);
  assert.equal(fs.existsSync(manifestPath), false);
  assert.equal(JSON.parse(output.stderr()).error.code, 'validation');
});

test('CLI rejects unknown flags instead of silently ignoring typos', (t) => {
  const fixture = makeFixture(t);
  const output = captureIo();
  const exitCode = cli.main([
    'plan', '--wrods', 'quản lý', '--manifest', path.join(fixture.root, 'plan.json'),
    '--repo-root', fixture.root
  ], output.io);

  assert.equal(exitCode, cli.EXIT_CODES.VALIDATION);
  assert.match(JSON.parse(output.stderr()).error.message, /Unknown option: --wrods/);
});

test('CLI rejects duplicate and command-inapplicable flags', (t) => {
  const fixture = makeFixture(t);
  for (const argv of [
    ['plan', '--words', 'a', '--words', 'b', '--manifest', path.join(fixture.root, 'a.json')],
    ['plan', '--approve', '--manifest', path.join(fixture.root, 'b.json')],
    ['apply', '--words', 'a', '--manifest', path.join(fixture.root, 'missing.json'), '--approve']
  ]) {
    const output = captureIo();
    assert.equal(cli.main([...argv, '--repo-root', fixture.root], output.io), cli.EXIT_CODES.VALIDATION);
  }
});

test('missing nested input paths are reported as validation errors', (t) => {
  const fixture = makeFixture(t);
  const output = captureIo();
  const exitCode = cli.main([
    'plan', '--file', 'missing-parent/input.md',
    '--manifest', path.join(fixture.root, 'plan.json'), '--repo-root', fixture.root
  ], output.io);

  assert.equal(exitCode, cli.EXIT_CODES.VALIDATION);
  assert.equal(JSON.parse(output.stderr()).error.code, 'validation');
});

test('planner rejects an in-repository symlink that resolves outside the repository', (t) => {
  const fixture = makeFixture(t);
  const outside = path.join(os.tmpdir(), `zoopdog-outside-${process.pid}-${Date.now()}.md`);
  fs.writeFileSync(outside, 'quản lý\n');
  t.after(() => fs.rmSync(outside, {force: true}));
  fs.symlinkSync(outside, path.join(fixture.root, '.idea/outside.md'));

  assert.throws(
    () => cli.createPlan({repoRoot: fixture.root, file: '.idea/outside.md'}),
    /resolves outside repository root/
  );
});

test('apply validation requires approval and rejects stale source hashes before writing', (t) => {
  const fixture = makeFixture(t);
  const manifest = approveActionable(cli.createPlan({
    repoRoot: fixture.root,
    words: 'quan ly'
  }));
  const manifestPath = path.join(fixture.root, 'plan.json');
  writeJson(manifestPath, manifest);
  const userPath = path.join(fixture.root, 'zd-extension/db_src/user_nom_entries.jsonc');
  const before = fs.readFileSync(userPath);

  const noApproval = captureIo();
  const noApprovalExit = cli.main([
    'apply', '--manifest', manifestPath, '--repo-root', fixture.root
  ], noApproval.io);
  assert.equal(noApprovalExit, cli.EXIT_CODES.VALIDATION);
  assert.deepEqual(fs.readFileSync(userPath), before);

  fs.appendFileSync(path.join(fixture.root, 'zd-extension/db_src/vnedict2.json'), ' ');
  const stale = captureIo();
  const staleExit = cli.main([
    'apply', '--manifest', manifestPath, '--repo-root', fixture.root, '--approve'
  ], stale.io);
  assert.equal(staleExit, cli.EXIT_CODES.STALE);
  assert.equal(JSON.parse(stale.stderr()).error.code, 'stale');
  assert.deepEqual(fs.readFileSync(userPath), before);
});

test('manifest validation rejects unsafe paths, invalid Nom, and duplicate apply keys', (t) => {
  const fixture = makeFixture(t);
  const base = approveActionable(cli.createPlan({repoRoot: fixture.root, words: 'quan ly'}));

  const escaped = structuredClone(base);
  escaped.sourceHashes[0].path = '../outside.json';
  assert.throws(
    () => cli.validateManifest(escaped, {repoRoot: fixture.root, approved: true}),
    /escapes repository root/
  );

  const invalidNom = structuredClone(base);
  invalidNom.entries[0].nom = ['not CJK'];
  assert.throws(
    () => cli.validateManifest(invalidNom, {repoRoot: fixture.root, approved: true}),
    /valid Nom\/CJK/
  );

  const duplicate = structuredClone(base);
  duplicate.entries.push({
    ...duplicate.entries[0],
    id: `${duplicate.entries[0].sourceItemId}:duplicate-key`,
    primary: false
  });
  assert.throws(
    () => cli.validateManifest(duplicate, {repoRoot: fixture.root, approved: true}),
    /Duplicate approved key/
  );

  const missingHash = structuredClone(base);
  missingHash.sourceHashes = missingHash.sourceHashes.filter(
    (snapshot) => snapshot.path !== 'zd-extension/db_src/vnedict2.json'
  );
  assert.throws(
    () => cli.validateManifest(missingHash, {repoRoot: fixture.root, approved: true}),
    /missing required source hash/i
  );

  const malformedHash = structuredClone(base);
  malformedHash.sourceHashes[0].hash = 42;
  assert.throws(
    () => cli.validateManifest(malformedHash, {repoRoot: fixture.root, approved: true}),
    /invalid source hash/i
  );

  const invalidShape = structuredClone(base);
  invalidShape.entries[0].status = 'garbage';
  invalidShape.entries[0].explain = [null];
  assert.throws(
    () => cli.validateManifest(invalidShape, {repoRoot: fixture.root, approved: true}),
    /invalid status|text arrays/i
  );

  const filteredMetadata = cli.createPlan({
    repoRoot: fixture.root,
    words: 'đích的 thực食'
  });
  filteredMetadata.entries[0].status = 'proposed';
  filteredMetadata.entries[0].provenance = [];
  filteredMetadata.entries[0].decision = 'reject';
  assert.throws(
    () => cli.validateManifest(filteredMetadata, {repoRoot: fixture.root, approved: true}),
    /filtered input metadata/i
  );

  const downgradedFiltered = cli.createPlan({
    repoRoot: fixture.root,
    words: 'đích的 thực食'
  });
  downgradedFiltered.source.items[0].filteredInput = false;
  downgradedFiltered.entries[0].status = 'proposed';
  downgradedFiltered.entries[0].provenance = [];
  downgradedFiltered.entries[0].decision = 'reject';
  assert.throws(
    () => cli.validateManifest(downgradedFiltered, {repoRoot: fixture.root, approved: true}),
    /filtered input metadata/i
  );

  const deletedFilteredMetadata = cli.createPlan({
    repoRoot: fixture.root,
    words: 'đích的 thực食'
  });
  delete deletedFilteredMetadata.source.items[0].rawInput;
  delete deletedFilteredMetadata.source.items[0].filteredInput;
  deletedFilteredMetadata.source.items[0].original = 'đích thực';
  deletedFilteredMetadata.entries[0].original = 'đích thực';
  deletedFilteredMetadata.entries[0].status = 'proposed';
  deletedFilteredMetadata.entries[0].provenance = [];
  deletedFilteredMetadata.entries[0].nom = ['的實'];
  deletedFilteredMetadata.entries[0].decision = 'apply';
  assert.throws(
    () => cli.validateManifest(deletedFilteredMetadata, {repoRoot: fixture.root, approved: true}),
    /inline source items/i
  );

  const skippedFiltered = cli.createPlan({
    repoRoot: fixture.root,
    words: 'đích的 thực食'
  });
  skippedFiltered.entries[0].status = 'skipped';
  assert.throws(
    () => cli.validateManifest(skippedFiltered, {repoRoot: fixture.root, approved: true}),
    /invalid skipped status/i
  );

  const fileManifest = approveActionable(cli.createPlan({
    repoRoot: fixture.root,
    file: '.idea/newfile.md#L2-L4'
  }));
  fileManifest.source.items[0].original = 'tampered item';
  assert.throws(
    () => cli.validateManifest(fileManifest, {repoRoot: fixture.root, approved: true}),
    /items do not match/i
  );

  const malformedRange = approveActionable(cli.createPlan({
    repoRoot: fixture.root,
    file: '.idea/newfile.md#L2-L4'
  }));
  malformedRange.source.range = {startLine: '2', endLine: 4};
  assert.throws(
    () => cli.validateManifest(malformedRange, {repoRoot: fixture.root, approved: true}),
    /invalid source range/i
  );
});

test('apply CLI classifies unreadable JSON as manifest validation failure', (t) => {
  const fixture = makeFixture(t);
  const manifestPath = path.join(fixture.root, 'broken.json');
  fs.writeFileSync(manifestPath, '{');
  const output = captureIo();

  const exitCode = cli.main([
    'apply', '--manifest', manifestPath, '--repo-root', fixture.root, '--approve'
  ], output.io);

  assert.equal(exitCode, cli.EXIT_CODES.VALIDATION);
  assert.equal(JSON.parse(output.stderr()).error.code, 'validation');
});

test('JSONC upsert changes only values, preserves comments, and appends new entries', () => {
  const source = `[
  {
    // Keep this field comment.
    "vi": "Quản lý",
    "nom": ["舊"],
    "explain": ["old"],
  },
  /* Keep this entry comment. */
  {
    "vi": "giữ lại",
    "nom": ["保持"]
  },
]\n`;

  const updated = cli.upsertUserEntriesJsonc(source, [
    {vi: 'quản lý', key: 'quản lý', nom: ['管理'], explain: ['manage']},
    {vi: 'Sao Vàng', key: 'sao vàng', nom: ['𣋀黃'], explain: ['yellow star']}
  ]);

  assert.match(updated, /Keep this field comment/);
  assert.match(updated, /Keep this entry comment/);
  const parsed = userEntries.parseUserNomEntries(updated, 'updated.jsonc');
  assert.deepEqual(parsed.find((entry) => entry.key === 'quản lý').nom, ['管理']);
  assert.deepEqual(parsed.find((entry) => entry.key === 'quản lý').explain, ['manage']);
  assert.deepEqual(parsed.find((entry) => entry.key === 'giữ lại').nom, ['保持']);
  assert.deepEqual(parsed.find((entry) => entry.key === 'sao vàng').nom, ['𣋀黃']);
});

test('JSONC upsert inserts a missing property before trailing comments and preserves CRLF indentation', () => {
  const source = '[\r\n    {\r\n        "vi": "quản lý",\r\n        "nom": ["舊"] // keep trailing comment\r\n    }\r\n]\r\n';
  const updated = cli.upsertUserEntriesJsonc(source, [
    {vi: 'quản lý', nom: ['管理'], explain: ['manage']}
  ]);

  assert.match(updated, /\["管理"\], \/\/ keep trailing comment/);
  assert.match(updated, /\r\n        "explain": \["manage"\]\r\n/);
  assert.doesNotMatch(updated, /(^|[^\r])\n/);
  assert.deepEqual(
    userEntries.parseUserNomEntries(updated, 'crlf.jsonc')[0].explain,
    ['manage']
  );
});

test('JSONC append preserves an established four/eight-space indentation style', () => {
  const source = '[\n    {\n        "vi": "cũ",\n        "nom": ["舊"]\n    }\n]\n';
  const updated = cli.upsertUserEntriesJsonc(source, [
    {vi: 'mới', nom: ['新'], explain: ['new']}
  ]);

  assert.match(updated, /\n    \{\n        "vi": "mới",\n        "nom": \[\n/);
});

test('file cleanup removes only applied items and preserves unresolved content', () => {
  const source = '# Queue\nquan ly, kiểm tra xem; giữ lại\nSao Vàng\n';
  const items = cli.parseInputText(source);
  const cleaned = cli.cleanupInputContent(source, items, new Set(['L2:I2']));

  assert.equal(cleaned, '# Queue\nquan ly, giữ lại\nSao Vàng\n');

  const spaced = '  a  ,  b ; c\n';
  const spacedItems = cli.parseInputText(spaced);
  assert.equal(
    cli.cleanupInputContent(spaced, spacedItems, new Set(['L1:I2'])),
    '  a  , c\n'
  );
});

test('transactional apply updates, builds, verifies, and reports structured results', (t) => {
  const fixture = makeFixture(t);
  const manifest = approveActionable(cli.createPlan({repoRoot: fixture.root, words: 'quan ly'}));
  const runner = (command, args, options) => {
    fixture.calls.push({command, args: [...args], cwd: options.cwd});
    if (args[0] === 'scripts/build-nom-userscript.js') {
      fs.writeFileSync(path.join(fixture.root, 'zoopdog-nom-ruby.user.js'),
        'var NOM_MAP = {"quản lý":"管理"};\n');
    }
    if (args[0] === 'scripts/build-popupdict-userscript.js') {
      fs.writeFileSync(path.join(fixture.root, 'zoopdog-popupdict.user.js'),
        'var ZOO_DICTIONARY = {"quản lý":[["quản lý",[]]]};\n');
    }
    return {status: 0, stdout: '', stderr: ''};
  };

  const result = cli.applyManifest(manifest, {
    repoRoot: fixture.root,
    approved: true,
    commandRunner: runner
  });

  assert.deepEqual(result.updated, ['quản lý']);
  assert.equal(fixture.calls.length, 5);
  assert.deepEqual(fixture.calls.map((call) => call.args[0]), [
    'scripts/build-nom-userscript.js',
    'scripts/build-popupdict-userscript.js',
    '--check',
    '--check',
    '--check'
  ]);
  const entries = userEntries.readUserNomEntries(
    path.join(fixture.root, 'zd-extension/db_src/user_nom_entries.jsonc')
  );
  assert.deepEqual(entries.find((entry) => entry.key === 'quản lý').nom, ['管理']);
});

test('apply with no approved entries performs no writes, builds, or checks', (t) => {
  const fixture = makeFixture(t);
  const manifest = cli.createPlan({repoRoot: fixture.root, words: 'quan ly'});
  manifest.entries[0].decision = 'reject';
  const owned = [
    'zd-extension/db_src/user_nom_entries.jsonc',
    'zoopdog-nom-ruby.user.js',
    'zoopdog-popupdict.user.js'
  ];
  const before = Object.fromEntries(owned.map((relative) => [
    relative, fs.readFileSync(path.join(fixture.root, relative))
  ]));

  const result = cli.applyManifest(manifest, {
    repoRoot: fixture.root,
    approved: true,
    commandRunner: fixture.commandRunner
  });

  assert.deepEqual(result, {
    ok: true,
    action: 'apply',
    updated: [],
    removedItems: [],
    rebuilt: [],
    checks: []
  });
  assert.equal(fixture.calls.length, 0);
  owned.forEach((relative) => {
    assert.deepEqual(fs.readFileSync(path.join(fixture.root, relative)), before[relative]);
  });
});

test('transactional apply restores exact bytes when a build fails', (t) => {
  const fixture = makeFixture(t);
  const manifest = approveActionable(cli.createPlan({repoRoot: fixture.root, words: 'quan ly'}));
  const owned = [
    'zd-extension/db_src/user_nom_entries.jsonc',
    'zoopdog-nom-ruby.user.js',
    'zoopdog-popupdict.user.js'
  ];
  const before = Object.fromEntries(owned.map((relative) => [
    relative, fs.readFileSync(path.join(fixture.root, relative))
  ]));
  const runner = (command, args) => {
    if (args[0] === 'scripts/build-nom-userscript.js') {
      fs.writeFileSync(path.join(fixture.root, 'zoopdog-nom-ruby.user.js'), 'changed');
      return {status: 0, stdout: '', stderr: ''};
    }
    return {status: 1, stdout: '', stderr: 'controlled failure'};
  };

  assert.throws(
    () => cli.applyManifest(manifest, {
      repoRoot: fixture.root,
      approved: true,
      commandRunner: runner
    }),
    (error) => error.exitCode === cli.EXIT_CODES.APPLY_FAILED
  );
  owned.forEach((relative) => {
    assert.deepEqual(fs.readFileSync(path.join(fixture.root, relative)), before[relative]);
  });
});

test('transactional apply rolls back when generated maps omit an approved key', (t) => {
  const fixture = makeFixture(t);
  const manifest = approveActionable(cli.createPlan({repoRoot: fixture.root, words: 'quan ly'}));
  const userPath = path.join(fixture.root, 'zd-extension/db_src/user_nom_entries.jsonc');
  const before = fs.readFileSync(userPath);

  assert.throws(() => cli.applyManifest(manifest, {
    repoRoot: fixture.root,
    approved: true,
    commandRunner: fixture.commandRunner
  }), /missing approved key/);
  assert.deepEqual(fs.readFileSync(userPath), before);
});

test('transactional apply rolls back when a syntax check fails', (t) => {
  const fixture = makeFixture(t);
  const manifest = approveActionable(cli.createPlan({repoRoot: fixture.root, words: 'quan ly'}));
  const userPath = path.join(fixture.root, 'zd-extension/db_src/user_nom_entries.jsonc');
  const before = fs.readFileSync(userPath);
  const runner = (command, args) => {
    if (args[0] === 'scripts/build-nom-userscript.js') {
      fs.writeFileSync(path.join(fixture.root, 'zoopdog-nom-ruby.user.js'),
        'var NOM_MAP = {"quản lý":"管理"};\n');
      return {status: 0, stdout: '', stderr: ''};
    }
    if (args[0] === 'scripts/build-popupdict-userscript.js') {
      fs.writeFileSync(path.join(fixture.root, 'zoopdog-popupdict.user.js'),
        'var ZOO_DICTIONARY = {"quản lý":[]};\n');
      return {status: 0, stdout: '', stderr: ''};
    }
    return {status: 1, stdout: '', stderr: 'syntax failure'};
  };

  assert.throws(() => cli.applyManifest(manifest, {
    repoRoot: fixture.root,
    approved: true,
    commandRunner: runner
  }), /syntax-check/);
  assert.deepEqual(fs.readFileSync(userPath), before);
});

test('isolated end-to-end apply runs the real repository builders', (t) => {
  const fixture = makeFixture(t);
  installRealBuilders(fixture.root);
  const manifest = approveActionable(cli.createPlan({
    repoRoot: fixture.root,
    words: 'Sao Vàng / 𣋀黃 / yellow star'
  }));

  const result = cli.applyManifest(manifest, {
    repoRoot: fixture.root,
    approved: true
  });

  assert.deepEqual(result.updated, ['sao vàng']);
  assert.match(
    fs.readFileSync(path.join(fixture.root, 'zoopdog-nom-ruby.user.js'), 'utf8'),
    /"sao vàng":"𣋀黃"/
  );
  assert.match(
    fs.readFileSync(path.join(fixture.root, 'zoopdog-popupdict.user.js'), 'utf8'),
    /"sao vàng"/
  );
});

test('Codex command contains the canonical Node.js review workflow', () => {
  const codex = fs.readFileSync(
    path.join(repoRoot, '.codex/commands/add-chu-nom.md'),
    'utf8'
  );

  assert.match(codex, /node scripts\/add-chu-nom\.js plan/);
  assert.match(codex, /node scripts\/add-chu-nom\.js apply/);
  assert.match(codex, /--approve/);
  assert.doesNotMatch(codex, /node scripts\/build-(?:nom|popupdict)-userscript/);
});

test('Claude command is only a reference link to the canonical Codex document', () => {
  const claude = fs.readFileSync(
    path.join(repoRoot, '.claude/commands/add-chu-nom.md'),
    'utf8'
  );

  assert.equal(claude, [
    '# /add-chu-nom',
    '',
    'See [`.codex/commands/add-chu-nom.md`](../../.codex/commands/add-chu-nom.md) for instructions.',
    ''
  ].join('\n'));
  assert.doesNotMatch(claude, /node |--approve|## Workflow/);
});
