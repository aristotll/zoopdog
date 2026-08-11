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
  // The builders import the shared primitives and assemble the extracted userscript
  // runtime, so the fixture needs both directories.
  for (const directory of ['scripts/lib', 'scripts/userscript']) {
    fs.cpSync(
      path.join(repoRoot, directory),
      path.join(fixtureRoot, directory),
      {recursive: true}
    );
  }
  for (const relative of [
    'zd-extension/js/lib/chroma.min.js',
    'zd-extension/js/zd-words.js',
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

test('separators split a mixed Vietnamese/CJK line into distinct items', () => {
  assert.deepEqual(
    cli.parseInputText('đích的 thực食, đánh打 lạc洛').map((item) => ({
      id: item.id,
      itemIndex: item.itemIndex,
      original: item.original,
      rawInput: item.rawInput,
      filteredInput: item.filteredInput
    })),
    [
      {
        id: 'L1:I1',
        itemIndex: 1,
        original: 'đích thực',
        rawInput: 'đích的 thực食',
        filteredInput: true
      },
      {
        id: 'L1:I2',
        itemIndex: 2,
        original: 'đánh lạc',
        rawInput: 'đánh打 lạc洛',
        filteredInput: true
      }
    ]
  );

  assert.deepEqual(
    cli.parseInputText('học học; kỳ期 nghỉ憩 | kỷ紀 luật律')
      .map((item) => item.original),
    ['học học', 'kỳ nghỉ', 'kỷ luật']
  );

  // A mixed line with no separator is still exactly one item.
  const single = cli.parseInputText('đích的 thực食');
  assert.equal(single.length, 1);
  assert.equal(single[0].original, 'đích thực');
  assert.equal(single[0].rawInput, 'đích的 thực食');
});

test('cleanup of a mixed annotated line leaves no residue', () => {
  const source = 'đích的 thực食, đánh打 lạc洛\n';
  const items = cli.parseInputText(source);

  assert.equal(
    cli.cleanupInputContent(source, items, new Set(['L1:I1', 'L1:I2'])),
    '\n',
    'applying every item drops the line, leaving only the file\'s trailing newline'
  );
  assert.equal(
    cli.cleanupInputContent(source, items, new Set(['L1:I1'])),
    ' đánh打 lạc洛\n',
    'applying one item leaves exactly the other item'
  );
  assert.equal(
    cli.cleanupInputContent(source, items, new Set(['L1:I2'])),
    'đích的 thực食\n'
  );
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
  assert.equal(JSON.parse(output.stderr()).error.category, 'validation');
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
  assert.equal(JSON.parse(output.stderr()).error.category, 'validation');
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
  assert.equal(JSON.parse(stale.stderr()).error.category, 'stale');
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
  assert.equal(JSON.parse(output.stderr()).error.category, 'validation');
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
  // Updating merges into the stored values rather than replacing them.
  assert.deepEqual(parsed.find((entry) => entry.key === 'quản lý').nom, ['舊', '管理']);
  assert.deepEqual(parsed.find((entry) => entry.key === 'quản lý').explain, ['old', 'manage']);
  assert.deepEqual(parsed.find((entry) => entry.key === 'giữ lại').nom, ['保持']);
  assert.deepEqual(parsed.find((entry) => entry.key === 'sao vàng').nom, ['𣋀黃']);

  const replaced = cli.upsertUserEntriesJsonc(source, [
    {vi: 'quản lý', key: 'quản lý', nom: ['管理'], explain: ['manage'], replace: true}
  ]);
  const replacedParsed = userEntries.parseUserNomEntries(replaced, 'replaced.jsonc');
  assert.deepEqual(replacedParsed.find((entry) => entry.key === 'quản lý').nom, ['管理']);
  assert.match(replaced, /Keep this field comment/);
});

test('JSONC upsert inserts a missing property before trailing comments and preserves CRLF indentation', () => {
  const source = '[\r\n    {\r\n        "vi": "quản lý",\r\n        "nom": ["舊"] // keep trailing comment\r\n    }\r\n]\r\n';
  const updated = cli.upsertUserEntriesJsonc(source, [
    {vi: 'quản lý', nom: ['管理'], explain: ['manage']}
  ]);

  assert.match(updated, /\["舊","管理"\], \/\/ keep trailing comment/);
  assert.match(updated, /\r\n        "explain": \["manage"\]\r\n/);
  assert.doesNotMatch(updated, /(^|[^\r])\n/);
  assert.deepEqual(
    userEntries.parseUserNomEntries(updated, 'crlf.jsonc')[0].explain,
    ['manage']
  );
});

test('JSONC upsert de-duplicates approved keys and is byte-idempotent', () => {
  const source = '[\n  // keep\n]\n';
  const approved = [
    {vi: 'Đồng nghiệp', nom: ['同業'], explain: ['colleague']},
    {vi: 'đồng   nghiệp', nom: [' 同業', '同業'], explain: ['coworker', 'colleague ']}
  ];

  const once = cli.upsertUserEntriesJsonc(source, approved);
  const twice = cli.upsertUserEntriesJsonc(once, approved);
  const parsed = userEntries.parseUserNomEntries(once, 'fixture.jsonc');

  assert.equal(parsed.filter((entry) => entry.key === 'đồng nghiệp').length, 1);
  assert.deepEqual(parsed[0].nom, ['同業']);
  assert.deepEqual(parsed[0].explain, ['colleague', 'coworker']);
  assert.equal(twice, once);
});

test('JSONC append preserves an established four/eight-space indentation style', () => {
  const source = '[\n    {\n        "vi": "cũ",\n        "nom": ["舊"]\n    }\n]\n';
  const updated = cli.upsertUserEntriesJsonc(source, [
    {vi: 'mới', nom: ['新'], explain: ['new']}
  ]);

  // The file's four/eight-space indentation is preserved, and appended values use the same
  // single-line style as the update path so one file never mixes two formats.
  assert.match(
    updated,
    /\n    \{\n        "vi": "mới",\n        "nom": \["新"\],\n        "explain": \["new"\]\n    \}\n/
  );
  assert.equal(userEntries.parseUserNomEntries(updated, 'style.jsonc').length, 2);
});

test('JSONC upsert merges into an existing entry instead of replacing it', () => {
  const source = `[
  {
    // Keep this comment.
    "vi": "tiếng Anh",
    "nom": ["㗂英", "㗂鶯"],
    "explain": ["English"]
  }
]
`;

  const merged = cli.upsertUserEntriesJsonc(source, [
    {vi: 'tiếng Anh', nom: ['㗂英'], explain: ['English language']}
  ]);
  const [entry] = userEntries.parseUserNomEntries(merged, 'fixture.jsonc');

  assert.deepEqual(entry.nom, ['㗂英', '㗂鶯'], 'existing Nom variants survive');
  assert.deepEqual(entry.explain, ['English', 'English language']);
  assert.match(merged, /\/\/ Keep this comment\./);

  const replaced = cli.upsertUserEntriesJsonc(source, [
    {vi: 'tiếng Anh', nom: ['㗂英'], explain: ['English language'], replace: true}
  ]);
  const [replacedEntry] = userEntries.parseUserNomEntries(replaced, 'fixture.jsonc');
  assert.deepEqual(replacedEntry.nom, ['㗂英'], 'replace: true opts into shrinking');
  assert.deepEqual(replacedEntry.explain, ['English language']);
});

test('manifest validation gates the replace opt-in behind review', (t) => {
  const fixture = makeFixture(t);

  const proposed = approveActionable(cli.createPlan({
    repoRoot: fixture.root,
    words: 'quan ly'
  }));
  const target = proposed.entries.find((entry) => entry.decision === 'apply');
  assert.equal(target.status, 'proposed');
  target.replace = true;
  assert.throws(
    () => cli.validateManifest(proposed, {repoRoot: fixture.root, approved: true}),
    /may only replace stored values from a reviewed entry/
  );

  const reviewed = cli.createPlan({repoRoot: fixture.root, words: 'đích的 thực食'});
  reviewed.entries[0].nom = ['的實'];
  reviewed.entries[0].decision = 'apply';
  reviewed.entries[0].replace = true;
  assert.equal(reviewed.entries[0].status, 'needs-review');
  assert.doesNotThrow(
    () => cli.validateManifest(reviewed, {repoRoot: fixture.root, approved: true})
  );

  const badFlag = approveActionable(cli.createPlan({
    repoRoot: fixture.root,
    words: 'quan ly'
  }));
  badFlag.entries.find((entry) => entry.decision === 'apply').replace = 'yes';
  assert.throws(
    () => cli.validateManifest(badFlag, {repoRoot: fixture.root, approved: true}),
    /invalid replace flag/
  );
});

test('JSONC append after a trailing comment stays valid and preserves the comment', () => {
  const source = `[
  {
    "vi": "tiếng Anh",
    "nom": ["㗂英"],
    "explain": []
  }
  // Trailing note kept for maintainers.
]
`;

  const appended = cli.upsertUserEntriesJsonc(source, [
    {vi: 'quản lý', nom: ['管理'], explain: ['manage']}
  ]);

  assert.match(appended, /\/\/ Trailing note kept for maintainers\./);
  assert.deepEqual(
    userEntries.parseUserNomEntries(appended, 'fixture.jsonc').map((entry) => entry.key),
    ['tiếng Anh'.toLocaleLowerCase('vi-VN'), 'quản lý']
  );

  // A block comment in the same position works too.
  const blockSource = source.replace(
    '// Trailing note kept for maintainers.',
    '/* Trailing block note. */'
  );
  const blockAppended = cli.upsertUserEntriesJsonc(blockSource, [
    {vi: 'quản lý', nom: ['管理'], explain: []}
  ]);
  assert.match(blockAppended, /\/\* Trailing block note\. \*\//);
  assert.equal(
    userEntries.parseUserNomEntries(blockAppended, 'fixture.jsonc').length,
    2
  );
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

test('a term repeated in one batch stays applyable', (t) => {
  const fixture = makeFixture(t);
  const manifest = cli.createPlan({
    repoRoot: fixture.root,
    words: 'kiểm tra\nkiểm tra'
  });

  const duplicates = manifest.entries.filter((entry) => entry.status === 'skipped');
  assert.equal(duplicates.length, 1);
  assert.equal(duplicates[0].primary, false,
    'a suppressed duplicate is not its source item\'s full-phrase entry');
  assert.equal(duplicates[0].sourceItemId, 'L2:I1');
  assert.match(duplicates[0].notes.join(' '), /Duplicate candidate/);

  approveActionable(manifest);
  const runner = (command, args, options) => {
    fixture.calls.push({command, args: [...args], cwd: options.cwd});
    if (args[0] === 'scripts/build-nom-userscript.js') {
      fs.writeFileSync(path.join(fixture.root, 'zoopdog-nom-ruby.user.js'),
        'var NOM_MAP = {"kiểm tra":"檢查"};\n');
    }
    if (args[0] === 'scripts/build-popupdict-userscript.js') {
      fs.writeFileSync(path.join(fixture.root, 'zoopdog-popupdict.user.js'),
        'var ZOO_DICTIONARY = {"kiểm tra":[["kiểm tra",[]]]};\n');
    }
    return {status: 0, stdout: '', stderr: ''};
  };

  const result = cli.applyManifest(manifest, {
    repoRoot: fixture.root,
    approved: true,
    commandRunner: runner
  });

  assert.deepEqual(result.updated, ['kiểm tra']);
  assert.deepEqual(result.removedItems, ['L1:I1']);
});

test('a repeated already-existing entry plans and applies as a no-op', (t) => {
  const fixture = makeFixture(t);
  const manifest = cli.createPlan({
    repoRoot: fixture.root,
    words: 'tiếng Anh\ntiếng Anh'
  });

  assert.deepEqual(manifest.entries.map((entry) => entry.status), ['skipped', 'skipped']);

  const result = cli.applyManifest(manifest, {
    repoRoot: fixture.root,
    approved: true,
    commandRunner: fixture.commandRunner
  });

  assert.deepEqual(result.updated, []);
  assert.equal(fixture.calls.length, 0);
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
    notEmbedded: [],
    rebuilt: [],
    checks: []
  });
  assert.equal(fixture.calls.length, 0);
  owned.forEach((relative) => {
    assert.deepEqual(fs.readFileSync(path.join(fixture.root, relative)), before[relative]);
  });
});

test('a key the Nom builder excludes is reported, not rolled back', (t) => {
  const fixture = makeFixture(t);
  const nomBuilder = require('../scripts/build-nom-userscript');
  assert.equal(nomBuilder.isEmbeddableTerm('y'), false,
    'a single ASCII character is deliberately not embeddable');

  const manifest = cli.createPlan({repoRoot: fixture.root, words: 'y'});
  manifest.entries[0].nom = ['醫'];
  manifest.entries[0].decision = 'apply';

  const runner = (command, args, options) => {
    fixture.calls.push({command, args: [...args], cwd: options.cwd});
    if (args[0] === 'scripts/build-nom-userscript.js') {
      // The real builder omits the key, exactly as isEmbeddableTerm dictates.
      fs.writeFileSync(path.join(fixture.root, 'zoopdog-nom-ruby.user.js'),
        'var NOM_MAP = {};\n');
    }
    if (args[0] === 'scripts/build-popupdict-userscript.js') {
      fs.writeFileSync(path.join(fixture.root, 'zoopdog-popupdict.user.js'),
        'var ZOO_DICTIONARY = {"y":[["y",[]]]};\n');
    }
    return {status: 0, stdout: '', stderr: ''};
  };

  const result = cli.applyManifest(manifest, {
    repoRoot: fixture.root,
    approved: true,
    commandRunner: runner
  });

  assert.deepEqual(result.updated, ['y']);
  assert.deepEqual(result.notEmbedded, ['y']);
  assert.deepEqual(
    userEntries.readUserNomEntries(
      path.join(fixture.root, 'zd-extension/db_src/user_nom_entries.jsonc')
    ).find((entry) => entry.key === 'y').nom,
    ['醫']
  );
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
  assert.match(codex, /node scripts\/add-chu-nom\.js review/);
  assert.match(codex, /node scripts\/add-chu-nom\.js apply/);
  assert.match(codex, /--approve/);
  assert.match(codex, /--decisions/);
  assert.doesNotMatch(codex, /node scripts\/build-(?:nom|popupdict)-userscript/);

  // The instruction that removes the hand-editing failure class, and the one linguistic rule
  // that moved here from the retired session-start rules file.
  assert.match(codex, /[Nn]ever edit the manifest by hand/);
  assert.match(codex, /Vietnamese word order/);
  assert.match(codex, /𣋀黃/, 'the word-order rule keeps its worked example');
  assert.doesNotMatch(codex, /黄星[^,.]*correct/i, 'the wrong form is shown only as the counter-example');
});

test('Makefile delegates plan, approved apply, rebuilds, and verification to Node.js', () => {
  const makefile = fs.readFileSync(path.join(repoRoot, 'Makefile'), 'utf8');

  assert.match(makefile, /^add-chu-nom-plan:/m);
  assert.match(makefile, /scripts\/add-chu-nom\.js plan --file/);
  assert.match(makefile, /^add-chu-nom-apply:/m);
  assert.match(makefile, /scripts\/add-chu-nom\.js apply.*--approve/);
  assert.match(makefile, /^rebuild-nom-userscript:/m);
  assert.match(makefile, /scripts\/build-nom-userscript\.js/);
  assert.match(makefile, /^rebuild-popupdict-userscript:/m);
  assert.match(makefile, /scripts\/build-popupdict-userscript\.js/);
  assert.match(makefile, /^rebuild-userscripts:/m);
  assert.match(makefile, /^verify-add-chu-nom:/m);
  assert.match(makefile, /\$\(NODE\) --test test\/\*\.test\.js/);
  assert.match(makefile, /--check/);

  const dryRun = execFileSync('make', [
    '-n', 'add-chu-nom-apply', 'MANIFEST=/tmp/reviewed.json'
  ], {cwd: repoRoot, encoding: 'utf8'});
  assert.match(dryRun, /apply --manifest "\/tmp\/reviewed\.json" --approve/);
});

test('Make targets require an explicit manifest path', () => {
  const makefile = fs.readFileSync(path.join(repoRoot, 'Makefile'), 'utf8');
  assert.doesNotMatch(makefile, /MANIFEST\s*\?=\s*\/tmp\//,
    'no predictable default in a world-writable shared directory');

  for (const target of ['add-chu-nom-apply', 'import-chu-nom', 'add-chu-nom-plan']) {
    assert.throws(
      () => execFileSync('make', ['-n', target], {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: 'pipe'
      }),
      (error) => {
        assert.notEqual(error.status, 0, `${target} must fail without MANIFEST`);
        assert.match(String(error.stderr), /MANIFEST is required/);
        return true;
      },
      `${target} without MANIFEST`
    );
  }

  // Targets that do not touch a manifest keep working with no arguments.
  for (const target of ['help', 'rebuild-userscripts', 'verify-add-chu-nom']) {
    assert.doesNotThrow(() => execFileSync('make', ['-n', target], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: 'pipe'
    }), `${target} needs no MANIFEST`);
  }
});

test('AGENTS.md routes to the workflow instead of restating it', () => {
  const agents = fs.readFileSync(path.join(repoRoot, 'AGENTS.md'), 'utf8');

  // The session-start local-rules read was removed: it charged every unrelated task for
  // context that belongs in the command document. Nothing may reintroduce it.
  assert.doesNotMatch(agents, /no-autoload-rules/,
    'AGENTS.md no longer mandates a session-start local rules read');
  assert.equal(agents.match(/`(\.claude\/[\w-]+)\/\*\.md`/), null,
    'AGENTS.md names no local rules directory to read every session');

  assert.doesNotMatch(
    agents,
    /no `package\.json`, task runner, or test framework/,
    'the repository now has a Makefile and a node:test suite'
  );
  // The documented verification entry point must exist as a real Make target, without
  // pinning its exact spelling.
  const documentedTargets = [...agents.matchAll(/make ([a-z][\w-]*)/g)].map((match) => match[1]);
  const makefile = fs.readFileSync(path.join(repoRoot, 'Makefile'), 'utf8');
  assert.ok(
    documentedTargets.some((target) =>
      /^verify/.test(target) && new RegExp(`^${target}:`, 'm').test(makefile)),
    'AGENTS.md documents a verification target that the Makefile defines'
  );

  // It points at the canonical documents rather than paraphrasing them, and every pointer
  // resolves to a file that exists.
  for (const pointer of [
    '.codex/commands/add-chu-nom.md',
    'docs/build.md',
    'docs/dictionary-data.md',
    'docs/history/chu-nom-lessons.md'
  ]) {
    assert.ok(agents.includes(pointer), `AGENTS.md points at ${pointer}`);
    assert.ok(fs.existsSync(path.join(repoRoot, pointer)), `${pointer} exists`);
  }

  // The workflow procedure lives in exactly one place. AGENTS.md may name the scripts but
  // must not carry the commands that drive them.
  for (const procedure of [/node scripts\/add-chu-nom\.js/, /--approve/, /--decisions/]) {
    assert.doesNotMatch(agents, procedure,
      'AGENTS.md links to the command document instead of repeating its procedure');
  }

  for (const importantPath of [
    'scripts/add-chu-nom.js',
    'scripts/add-chu-nom/',
    'Makefile'
  ]) {
    assert.ok(agents.includes(importantPath), `AGENTS.md should mention ${importantPath}`);
  }
});

test('the canonical command document has no divergent copy', () => {
  const allowed = new Set([
    '.codex/commands/add-chu-nom.md',
    '.claude/commands/add-chu-nom.md'
  ]);
  const tracked = execFileSync('git', ['ls-files'], {cwd: repoRoot, encoding: 'utf8'})
    .split('\n')
    .filter((entry) => entry.endsWith('.md') && !allowed.has(entry));

  const duplicates = tracked.filter((relative) => {
    const full = path.join(repoRoot, relative);
    if (!fs.existsSync(full)) {
      return false;
    }
    return /^---\r?\n[\s\S]*?description:.*Chu Nom/m.test(fs.readFileSync(full, 'utf8'));
  });

  assert.deepEqual(duplicates, [],
    'the /add-chu-nom command lives only in .codex/commands, with .claude as a pointer');
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

test('every workflow failure names an enumerated code and a remedy', () => {
  const {ERROR_CODES, EXIT_CODES} = require('../scripts/add-chu-nom/errors');
  const scriptDir = path.join(repoRoot, 'scripts');
  const files = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
      const target = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(target);
      else if (entry.name.endsWith('.js')) files.push(target);
    }
  })(scriptDir);

  const used = new Set();
  const mentioned = new Set();
  const unnamed = [];
  const forwarders = [];
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    const relative = path.relative(repoRoot, file);
    for (const match of source.matchAll(/new WorkflowError\(([^)]*)/g)) {
      const first = match[1].trim();
      const named = /^'([a-z0-9_]+)'\s*,/.exec(first);
      if (named) {
        used.add(named[1]);
        mentioned.add(named[1]);
        continue;
      }
      // A helper that forwards an already-chosen code is allowed, but only when it forwards a
      // parameter literally named `code` — anything else is a raise site that skipped the enum.
      if (/^code\s*,/.test(first)) {
        forwarders.push(relative);
        continue;
      }
      unnamed.push(`${relative}: ${first.slice(0, 60)}`);
    }
    // Codes also travel as plain issue records and as the first argument of the collector's
    // raise helpers. For the dead-code check any snake_case literal that matches an enum key
    // counts as a use — over-matching here can only hide a dead code, never invent one, and
    // the strict scan above still owns "no raise site skipped the enum".
    for (const match of source.matchAll(/['(,\s]'([a-z][a-z0-9_]{4,})'\s*[,)]/g)) {
      mentioned.add(match[1]);
    }
    for (const match of source.matchAll(/\bcode: '([a-z0-9_]+)'/g)) {
      mentioned.add(match[1]);
    }
  }

  assert.deepEqual(unnamed, [], 'every raise site passes an error code as its first argument');
  assert.ok(forwarders.length <= 1,
    `at most one helper forwards a code; found ${forwarders.join(', ')}`);

  const unknown = [...used].filter((code) => !Object.hasOwn(ERROR_CODES, code));
  assert.deepEqual(unknown, [], 'every raised code belongs to the frozen enumeration');

  const unused = Object.keys(ERROR_CODES).filter((code) => !mentioned.has(code));
  assert.deepEqual(unused, [], 'the enumeration carries no code that nothing can raise');

  const validExits = new Set(Object.values(EXIT_CODES));
  for (const [code, entry] of Object.entries(ERROR_CODES)) {
    assert.ok(entry.hint && entry.hint.length > 10, `${code} states a corrective action`);
    assert.ok(validExits.has(entry.exit), `${code} maps to a known exit code`);
    assert.notEqual(entry.exit, EXIT_CODES.SUCCESS, `${code} does not map to success`);
  }

  assert.equal(ERROR_CODES.stale_source.exit, EXIT_CODES.STALE);
  assert.equal(ERROR_CODES.approval_required.exit, EXIT_CODES.VALIDATION);
  assert.equal(ERROR_CODES.build_step_failed.exit, EXIT_CODES.APPLY_FAILED);
  assert.equal(Object.isFrozen(ERROR_CODES), true);
});

test('an unknown error code is rejected at construction', () => {
  const {WorkflowError} = require('../scripts/add-chu-nom/errors');
  assert.throws(() => new WorkflowError('not_a_real_code', 'boom'), /Unknown workflow error code/);
});

test('collection reports every independent defect in one pass', (t) => {
  const fixture = makeFixture(t);
  const {collectManifestIssues} = require('../scripts/add-chu-nom/manifest');
  const manifest = approveActionable(cli.createPlan({
    repoRoot: fixture.root,
    words: 'quản lý, đích thực, kiểm tra'
  }));

  const actionable = manifest.entries.filter((entry) => entry.status !== 'skipped');
  assert.ok(actionable.length >= 3, 'fixture plans enough actionable entries to defect three of them');

  actionable[0].decision = null;
  actionable[1].decision = 'apply';
  actionable[1].nom = ['not CJK'];
  actionable[2].decision = 'apply';
  actionable[2].vi = '';

  const {errors, applicable} = collectManifestIssues(manifest, {repoRoot: fixture.root});
  const codes = errors.map((error) => error.code);

  assert.ok(codes.includes('decision_missing'), `reports the missing decision, got ${codes}`);
  assert.ok(codes.includes('entry_nom_invalid'), `reports the invalid nom, got ${codes}`);
  assert.ok(codes.includes('entry_vi_missing'), `reports the empty vi, got ${codes}`);
  assert.ok(errors.length >= 3, 'all three are reported together rather than one per run');
  assert.deepEqual(applicable.filter((entry) => actionable.slice(0, 3).includes(entry)), [],
    'a defective entry is never treated as applicable');

  for (const error of errors) {
    assert.ok(error.hint && error.hint.length > 10, `${error.code} carries a remedy`);
  }
});

test('collection never writes to the manifest it inspects', (t) => {
  const fixture = makeFixture(t);
  const {collectManifestIssues} = require('../scripts/add-chu-nom/manifest');
  const manifest = approveActionable(cli.createPlan({
    repoRoot: fixture.root,
    words: 'quản lý'
  }));

  // Values the apply path would rewrite: padded and internally spaced `vi`, and a repeated
  // `nom`. If collection normalized anything, these would come back changed.
  const target = manifest.entries.find((entry) => entry.decision === 'apply');
  assert.ok(target, 'fixture has an entry marked for apply');
  target.vi = '  Quản   Lý  ';
  target.nom = ['管理', '管理'];

  const before = JSON.stringify(manifest);
  const {errors} = collectManifestIssues(manifest, {repoRoot: fixture.root});

  assert.deepEqual(errors.map((error) => error.code), [], 'the fixture manifest is valid');
  assert.equal(JSON.stringify(manifest), before,
    'no key assignment or text normalization leaks out of collection');
  assert.equal(target.vi, '  Quản   Lý  ', 'vi is left exactly as supplied');
  assert.deepEqual(target.nom, ['管理', '管理'], 'nom is left exactly as supplied');

  // The same manifest through the apply path does normalize, proving the split is real.
  const approved = cli.validateManifest(manifest, {repoRoot: fixture.root, approved: true});
  const normalized = approved.find((entry) => entry.id === target.id);
  assert.equal(normalized.vi, 'Quản   Lý');
  assert.equal(normalized.key, 'quản lý');
  assert.deepEqual(normalized.nom, ['管理']);
});

test('the apply path still normalizes entries after collection succeeds', (t) => {
  const fixture = makeFixture(t);
  const manifest = approveActionable(cli.createPlan({
    repoRoot: fixture.root,
    words: 'quản lý'
  }));

  const approved = cli.validateManifest(manifest, {repoRoot: fixture.root, approved: true});

  assert.ok(approved.length > 0);
  for (const entry of approved) {
    assert.equal(typeof entry.key, 'string');
    assert.ok(entry.key.length > 0, 'apply receives the normalized lookup key');
    assert.equal(entry.vi, entry.vi.trim());
  }
});

test('planning emits a review projection that excludes every integrity field', (t) => {
  const fixture = makeFixture(t);
  const output = captureIo();

  const exitCode = cli.main([
    'plan', '--words', 'kiểm tra xem', '--manifest', path.join(fixture.root, 'plan.json'),
    '--repo-root', fixture.root
  ], output.io);

  assert.equal(exitCode, cli.EXIT_CODES.SUCCESS);
  const result = JSON.parse(output.stdout());
  assert.ok(Array.isArray(result.review) && result.review.length > 0);
  assert.equal(result.review.length, JSON.parse(
    fs.readFileSync(path.join(fixture.root, 'plan.json'), 'utf8')
  ).entries.length, 'every candidate is presentable from stdout alone');

  for (const record of result.review) {
    for (const forbidden of ['sourceItemId', 'primary', 'key', 'sourceHashes', 'source']) {
      assert.equal(Object.hasOwn(record, forbidden), false,
        `${forbidden} stays out of the projection`);
    }
    assert.equal(typeof record.id, 'string');
    assert.equal(typeof record.status, 'string');
    for (const field of ['nom', 'explain', 'provenance', 'choices', 'notes']) {
      if (Object.hasOwn(record, field)) {
        assert.ok(record[field].length > 0, `${field} is omitted when empty`);
      }
    }
  }

  const skipped = result.review.filter((record) => record.status === 'skipped');
  assert.ok(skipped.every((record) => record.notes && record.notes.length),
    'a skipped candidate carries the reason it was skipped');
});

test('review records decisions without the manifest being edited by hand', (t) => {
  const fixture = makeFixture(t);
  const manifestPath = path.join(fixture.root, 'plan.json');
  const planOut = captureIo();
  cli.main([
    'plan', '--words', 'kiểm tra xem', '--manifest', manifestPath, '--repo-root', fixture.root
  ], planOut.io);

  const actionable = JSON.parse(planOut.stdout()).review
    .filter((record) => record.status !== 'skipped');
  assert.ok(actionable.length > 0, 'fixture plans at least one actionable candidate');

  const decisionsPath = path.join(fixture.root, 'decisions.json');
  fs.writeFileSync(decisionsPath, JSON.stringify(actionable.map((record) => ({
    id: record.id,
    decision: 'apply',
    nom: ['檢查'],
    explain: ['check']
  }))));

  const reviewOut = captureIo();
  const exitCode = cli.main([
    'review', '--manifest', manifestPath, '--decisions', decisionsPath,
    '--repo-root', fixture.root
  ], reviewOut.io);

  const result = JSON.parse(reviewOut.stdout());
  assert.equal(exitCode, cli.EXIT_CODES.SUCCESS, `review reported: ${JSON.stringify(result.issues)}`);
  assert.equal(result.ok, true);
  assert.deepEqual(result.issues, []);
  assert.equal(result.summary.undecided, 0);

  const stored = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  for (const record of actionable) {
    const entry = stored.entries.find((candidate) => candidate.id === record.id);
    assert.equal(entry.decision, 'apply');
    assert.deepEqual(entry.nom, ['檢查']);
  }

  const applied = cli.validateManifest(stored, {repoRoot: fixture.root, approved: true});
  assert.ok(applied.length > 0, 'a reviewed manifest passes the apply-time check');
});

test('review rejects an unrecognized field and leaves the manifest byte-identical', (t) => {
  const fixture = makeFixture(t);
  const manifestPath = path.join(fixture.root, 'plan.json');
  const planOut = captureIo();
  cli.main([
    'plan', '--words', 'kiểm tra xem', '--manifest', manifestPath, '--repo-root', fixture.root
  ], planOut.io);
  const target = JSON.parse(planOut.stdout()).review
    .find((record) => record.status !== 'skipped');
  const before = fs.readFileSync(manifestPath);

  for (const forbidden of ['sourceItemId', 'primary', 'key', 'status', 'provenance']) {
    const decisionsPath = path.join(fixture.root, `bad-${forbidden}.json`);
    fs.writeFileSync(decisionsPath, JSON.stringify([
      {id: target.id, decision: 'apply', nom: ['檢查'], [forbidden]: 'tampered'}
    ]));

    const output = captureIo();
    const exitCode = cli.main([
      'review', '--manifest', manifestPath, '--decisions', decisionsPath,
      '--repo-root', fixture.root
    ], output.io);

    assert.equal(exitCode, cli.EXIT_CODES.VALIDATION);
    const error = JSON.parse(output.stderr()).error;
    assert.equal(error.code, 'decision_field_unknown');
    assert.match(error.message, new RegExp(forbidden));
    assert.ok(error.hint.length > 10);
    assert.deepEqual(fs.readFileSync(manifestPath), before,
      `a rejected batch containing ${forbidden} writes nothing`);
  }
});

test('review refuses ids that are unknown or not actionable', (t) => {
  const fixture = makeFixture(t);
  const manifestPath = path.join(fixture.root, 'plan.json');
  const planOut = captureIo();
  // `tiếng Anh` is the term the fixture already stores in user entries, so planning skips it.
  cli.main([
    'plan', '--words', 'tiếng Anh', '--manifest', manifestPath, '--repo-root', fixture.root
  ], planOut.io);
  const skipped = JSON.parse(planOut.stdout()).review
    .find((record) => record.status === 'skipped');
  assert.ok(skipped, 'fixture plans a skipped candidate');

  const cases = [
    {id: 'L9:I9:full', code: 'decision_entry_unknown'},
    {id: skipped.id, code: 'decision_entry_not_actionable'}
  ];
  for (const {id, code} of cases) {
    const decisionsPath = path.join(fixture.root, `case-${code}.json`);
    fs.writeFileSync(decisionsPath, JSON.stringify([{id, decision: 'apply', nom: ['管理']}]));
    const output = captureIo();
    const exitCode = cli.main([
      'review', '--manifest', manifestPath, '--decisions', decisionsPath,
      '--repo-root', fixture.root
    ], output.io);

    assert.equal(exitCode, cli.EXIT_CODES.VALIDATION);
    assert.equal(JSON.parse(output.stderr()).error.code, code);
  }
});

test('review is idempotent and touches only the entries it names', (t) => {
  const fixture = makeFixture(t);
  const manifestPath = path.join(fixture.root, 'plan.json');
  const planOut = captureIo();
  cli.main([
    'plan', '--words', 'kiểm tra xem, Sao Vàng', '--manifest', manifestPath,
    '--repo-root', fixture.root
  ], planOut.io);
  const actionable = JSON.parse(planOut.stdout()).review
    .filter((record) => record.status !== 'skipped');
  assert.ok(actionable.length >= 2, 'fixture plans at least two actionable candidates');

  const first = actionable[0];
  const others = actionable.slice(1);
  const decide = (records, nom) => {
    const target = path.join(fixture.root, `decide-${records.length}-${nom}.json`);
    fs.writeFileSync(target, JSON.stringify(records.map((record) => ({
      id: record.id, decision: 'apply', nom: [nom]
    }))));
    const output = captureIo();
    cli.main([
      'review', '--manifest', manifestPath, '--decisions', target, '--repo-root', fixture.root
    ], output.io);
    return JSON.parse(output.stdout());
  };

  decide(actionable, '檢查');
  const revised = decide([first], '管理');

  assert.deepEqual(revised.recorded, [first.id], 'only the named entry is reported as recorded');
  const byId = new Map(revised.review.map((record) => [record.id, record]));
  assert.deepEqual(byId.get(first.id).nom, ['管理'], 'the correction replaced the earlier value');
  for (const other of others) {
    assert.deepEqual(byId.get(other.id).nom, ['檢查'], 'entries not named are untouched');
  }
});

test('review reports every outstanding issue instead of stopping at the first', (t) => {
  const fixture = makeFixture(t);
  const manifestPath = path.join(fixture.root, 'plan.json');
  const planOut = captureIo();
  cli.main([
    'plan', '--words', 'kiểm tra xem, Sao Vàng', '--manifest', manifestPath,
    '--repo-root', fixture.root
  ], planOut.io);
  const actionable = JSON.parse(planOut.stdout()).review
    .filter((record) => record.status !== 'skipped');

  const decisionsPath = path.join(fixture.root, 'partial.json');
  fs.writeFileSync(decisionsPath, JSON.stringify([
    {id: actionable[0].id, decision: 'apply', nom: ['not CJK']}
  ]));

  const output = captureIo();
  const exitCode = cli.main([
    'review', '--manifest', manifestPath, '--decisions', decisionsPath, '--repo-root', fixture.root
  ], output.io);

  assert.equal(exitCode, cli.EXIT_CODES.VALIDATION, 'an incomplete review is not ready to apply');
  const result = JSON.parse(output.stdout());
  assert.equal(result.ok, false);
  const codes = result.issues.map((issue) => issue.code);
  assert.ok(codes.includes('entry_nom_invalid'), `reports the bad nom, got ${codes}`);
  assert.ok(result.summary.undecided > 0, 'undecided entries are counted, not hidden');
  for (const issue of result.issues) {
    assert.ok(issue.hint && issue.hint.length > 10, `${issue.code} states a remedy`);
  }
  assert.ok(result.review.length > 0, 'the projection is still returned so the reviewer can continue');
});

test('review accepts decisions on stdin with Vietnamese and Chu Nom text intact', (t) => {
  const fixture = makeFixture(t);
  installRealBuilders(fixture.root);
  const manifestPath = path.join(fixture.root, 'plan.json');
  const planOut = captureIo();
  cli.main([
    'plan', '--words', 'kiểm tra xem', '--manifest', manifestPath, '--repo-root', fixture.root
  ], planOut.io);
  const actionable = JSON.parse(planOut.stdout()).review
    .filter((record) => record.status !== 'skipped');
  const target = actionable[0];

  const nom = ['𣋀黃'];
  const explain = ['kiểm tra — thử nghiệm'];
  const stdout = execFileSync(process.execPath, [
    path.join(repoRoot, 'scripts/add-chu-nom.js'),
    'review', '--manifest', manifestPath, '--decisions', '-', '--repo-root', fixture.root
  ], {
    input: JSON.stringify(actionable.map((record) => ({
      id: record.id,
      decision: 'apply',
      nom,
      explain
    }))),
    encoding: 'utf8'
  });

  const record = JSON.parse(stdout).review.find((candidate) => candidate.id === target.id);
  assert.deepEqual(record.nom, nom, 'Chu Nom text survives stdin transport');
  assert.deepEqual(record.explain, explain, 'Vietnamese diacritics survive stdin transport');

  const stored = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const entry = stored.entries.find((candidate) => candidate.id === target.id);
  assert.deepEqual(entry.nom, nom);
  assert.deepEqual(entry.explain, explain);
});

test('review rejects flags that belong to other commands', (t) => {
  const fixture = makeFixture(t);
  const manifestPath = path.join(fixture.root, 'plan.json');
  cli.main([
    'plan', '--words', 'quản lý', '--manifest', manifestPath, '--repo-root', fixture.root
  ], captureIo().io);

  const cases = [
    {argv: ['review', '--manifest', manifestPath, '--approve', '--decisions', '-'], code: 'approve_requires_apply'},
    {argv: ['review', '--manifest', manifestPath, '--words', 'x', '--decisions', '-'], code: 'input_option_requires_plan'},
    {argv: ['review', '--manifest', manifestPath], code: 'decisions_option_required'},
    {argv: ['review', '--decisions', '-'], code: 'manifest_option_required'},
    {argv: ['apply', '--manifest', manifestPath, '--decisions', '-'], code: 'unknown_option'}
  ];
  for (const {argv, code} of cases) {
    const output = captureIo();
    const exitCode = cli.main([...argv, '--repo-root', fixture.root], output.io);
    assert.equal(exitCode, cli.EXIT_CODES.VALIDATION, `${argv.join(' ')} is refused`);
    assert.equal(JSON.parse(output.stderr()).error.code, code);
  }
});
