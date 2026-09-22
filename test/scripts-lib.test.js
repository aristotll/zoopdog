const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const text = require('../scripts/lib/text');
const cjk = require('../scripts/lib/cjk');
const paths = require('../scripts/lib/paths');
const sources = require('../scripts/lib/sources');
const userscript = require('../scripts/lib/userscript');
const shardPath = require('../scripts/lib/shard-path');
const nomCsv = require('../scripts/lib/nom-entries-csv');

const repoRoot = path.resolve(__dirname, '..');

// Parses the `| vi | shard path |` fixture table out of SHARDING.md rather than duplicating it
// here by hand -- the doc is the one source of truth both this repo and book-translator's
// Python suite assert against.
function readShardingFixture() {
  const doc = fs.readFileSync(
    path.join(repoRoot, 'zd-extension/db_src/user_nom_entries/SHARDING.md'),
    'utf8'
  );
  const rows = [];
  for (const line of doc.split('\n')) {
    const match = /^\|\s*(.+?)\s*\|\s*(\d{2}\/\d{2}\.csv)\s*\|$/.exec(line);
    if (match) rows.push({vi: match[1], shardPath: match[2]});
  }
  return rows;
}

test('text helpers normalize Vietnamese consistently', () => {
  assert.equal(text.cleanText('\uFEFF  tiếng Anh  '), 'tiếng Anh');
  assert.equal(text.normalizeTerm('  Quản   Lý  '), 'quản lý');
  assert.equal(text.foldAccents('  Đặng   Văn  '), 'dang van');
  assert.deepEqual(text.stableUnique(['a', '', 'a', 'b']), ['a', 'b']);
});

test('stripNul is an option on cleanText, not a separate implementation', () => {
  const withNul = 'ti\u0000ếng';
  assert.equal(text.cleanText(withNul), withNul.normalize('NFC'));
  assert.equal(text.cleanText(withNul, {stripNul: true}), 'tiếng');
  assert.equal(text.normalizeTerm(' QU\u0000ẢN  LÝ ', {stripNul: true}), 'quản lý');
});

test('CJK patterns cover the documented ranges and nothing else', () => {
  const inRange = ['㐀', '䶿', '一', '鿿', '豈', '﫿',
    String.fromCodePoint(0x20000), String.fromCodePoint(0x323AF)];
  const outOfRange = ['㏿', '䷀', '', 'ﬀ',
    String.fromCodePoint(0x1FFFF), String.fromCodePoint(0x323B0), 'a', 'ế'];

  for (const character of inRange) {
    assert.ok(cjk.CJK_PATTERN.test(character), `${character.codePointAt(0).toString(16)} in range`);
    assert.ok(cjk.CJK_ONLY_PATTERN.test(character));
  }
  for (const character of outOfRange) {
    assert.ok(!cjk.CJK_PATTERN.test(character), `${character.codePointAt(0).toString(16)} out of range`);
    assert.ok(!cjk.CJK_ONLY_PATTERN.test(character));
  }
  assert.ok(cjk.CJK_ONLY_PATTERN.test('管理'));
  assert.ok(!cjk.CJK_ONLY_PATTERN.test('管理 manage'));
});

test('extractNomCandidates option sets reproduce every historical variant', () => {
  const definition = '管理 (简体 管治), 檢查/䀡 to manage';

  // build-nom-userscript.js: guard on CJK, strip parentheticals, split on separators.
  assert.deepEqual(
    cjk.extractNomCandidates(definition),
    ['管理', '檢查', '䀡']
  );

  // Strip parentheticals, no separator split, no CJK guard.
  assert.deepEqual(
    cjk.extractNomCandidates(definition, {requireCjk: false, separators: null}),
    ['管理', '檢查', '䀡']
  );

  // merge-mdx-nom-into-vnedict2.js `cjkTokens`: raw match, parentheticals kept.
  assert.deepEqual(
    cjk.extractNomCandidates(definition, {
      requireCjk: false,
      stripParentheticals: false,
      separators: null
    }),
    ['管理', '简体', '管治', '檢查', '䀡']
  );

  // The CJK guard is what makes a pure-English definition yield nothing.
  assert.deepEqual(cjk.extractNomCandidates('to manage'), []);
  assert.deepEqual(
    cjk.extractNomCandidates('to manage', {requireCjk: false}),
    []
  );
});

test('isEmbeddableTerm keeps the Nom builder rule in one place', () => {
  assert.equal(cjk.isEmbeddableTerm('y'), false);
  assert.equal(cjk.isEmbeddableTerm('an'), true);
  assert.equal(cjk.isEmbeddableTerm('ý'), true);
  // Whitespace is stripped before counting, so a two-letter phrase is embeddable.
  assert.equal(cjk.isEmbeddableTerm('a b'), true);
  assert.equal(cjk.isEmbeddableTerm(''), false);
  assert.equal(cjk.isEmbeddableTerm(undefined), false);

  // Exhaustive agreement with the rule as it was written in build-nom-userscript.js,
  // including its coercion behaviour normalized to a boolean.
  const original = (term) => Boolean(term) && (
    Array.from(term.replace(/\s/g, '')).length >= 2 || /[^\x00-\x7F]/.test(term)
  );
  for (const term of ['', 'a', 'y', 'ab', 'a b', ' a ', 'ý', 'ề', '管', '管理', 'the', 'an']) {
    assert.equal(cjk.isEmbeddableTerm(term), original(term), `isEmbeddableTerm(${JSON.stringify(term)})`);
  }
});

test('repository paths resolve to the real files', () => {
  assert.equal(paths.rootDir, repoRoot);
  for (const key of Object.keys(paths.relative)) {
    assert.equal(paths.absolute[key], path.join(repoRoot, paths.relative[key]));
  }
  for (const key of ['dictionary', 'mdxNom', 'userNomEntries', 'nomUserscript', 'popupUserscript']) {
    assert.ok(fs.existsSync(paths.absolute[key]), `${key} exists`);
  }
  assert.equal(
    paths.resolveIn('/somewhere', 'dictionary'),
    '/somewhere/zd-extension/db_src/vnedict2.json'
  );
  assert.throws(() => paths.resolveIn(repoRoot, 'nope'), /Unknown repository path/);
});

test('source helpers read both MDX payload shapes and build stable definition keys', () => {
  assert.deepEqual(sources.mdxEntries({entries: {a: ['甲']}}), {a: ['甲']});
  assert.deepEqual(sources.mdxEntries({a: ['甲']}), {a: ['甲']});
  assert.deepEqual(sources.mdxEntries(null), {});

  assert.equal(sources.definitionKey(' manage ', ' v '), 'manage\u0000v');
  assert.notEqual(
    sources.definitionKey('a', 'bc'),
    sources.definitionKey('ab', 'c')
  );

  const payload = sources.readJson(paths.absolute.mdxNom);
  assert.ok(Object.keys(sources.mdxEntries(payload)).length > 0);
});

test('release URLs are derived from the declared repository paths', () => {
  assert.equal(
    paths.releaseUrl('nomUserscript'),
    `${paths.releaseBaseUrl}/zoopdog-nom-ruby.user.js`
  );
  assert.equal(
    paths.releaseUrl('popupUserscript'),
    `${paths.releaseBaseUrl}/zoopdog-popupdict.user.js`
  );
  assert.throws(() => paths.releaseUrl('nope'), /Unknown repository path/);
});

test('userscript versions compare as dotted numbers', () => {
  assert.equal(userscript.compareVersions('2026.09.05', '2026.04.19'), 1);
  assert.equal(userscript.compareVersions('2026.09.05', '2026.09.05'), 0);
  assert.equal(userscript.compareVersions('2026.09.05.1', '2026.09.05'), 1);
  assert.equal(userscript.compareVersions('2026.09.05', '2026.09.05.0'), 0);
  assert.throws(() => userscript.compareVersions('2026.09.05', 'dev'), /numeric/);
});

test('the version stamp only moves forward', () => {
  const datestamp = userscript.versionDatestamp(new Date(2026, 8, 5));
  assert.equal(datestamp, '2026.09.05');

  assert.equal(userscript.nextUserscriptVersion(null, datestamp), '2026.09.05');
  assert.equal(userscript.nextUserscriptVersion('2026.04.19', datestamp), '2026.09.05');
  assert.equal(userscript.nextUserscriptVersion('2026.09.05', datestamp), '2026.09.05.1');
  assert.equal(userscript.nextUserscriptVersion('2026.09.05.1', datestamp), '2026.09.05.2');
  // A stamp from a machine whose clock ran ahead must still be overtaken, not repeated.
  assert.equal(userscript.nextUserscriptVersion('2026.10.01', datestamp), '2026.10.01.1');
});

test('the version line is read, replaced and required exactly once', () => {
  const header = '// ==UserScript==\n// @version     0.0.0\n// ==/UserScript==\nvar a = 1;\n';

  assert.equal(userscript.readUserscriptVersion(header), '0.0.0');
  assert.equal(userscript.readUserscriptVersion('var a = 1;'), null);
  assert.match(userscript.setUserscriptVersion(header, '2026.09.05'), /@version {5}2026\.09\.05\n/);
  assert.throws(() => userscript.setUserscriptVersion('var a = 1;', '1'), /exactly once, found 0/);
  assert.throws(
    () => userscript.setUserscriptVersion(`${header}// @version 1.0\n`, '1'),
    /exactly once, found 2/
  );
});

test('a userscript is restamped only when its other bytes change', (t) => {
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'zoopdog-version-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const target = path.join(dir, 'probe.user.js');
  const draft = (body) => `// @version     ${userscript.PENDING_VERSION}\n${body}\n`;
  const day = (date) => new Date(2026, 8, date);

  const first = userscript.writeVersionedUserscript(target, draft('var a = 1;'), day(5));
  assert.deepEqual(first, {version: '2026.09.05', changed: true});

  const again = userscript.writeVersionedUserscript(target, draft('var a = 1;'), day(6));
  assert.deepEqual(again, {version: '2026.09.05', changed: false});
  assert.match(fs.readFileSync(target, 'utf8'), /@version {5}2026\.09\.05\n/);

  const edited = userscript.writeVersionedUserscript(target, draft('var a = 2;'), day(6));
  assert.deepEqual(edited, {version: '2026.09.06', changed: true});
  assert.match(fs.readFileSync(target, 'utf8'), /var a = 2;/);

  const sameDay = userscript.writeVersionedUserscript(target, draft('var a = 3;'), day(6));
  assert.deepEqual(sameDay, {version: '2026.09.06.1', changed: true});
});

test('shardPathFor matches the documented fixture (parity with book-translator)', () => {
  const fixture = readShardingFixture();
  assert.ok(fixture.length >= 20, 'SHARDING.md fixture table should have its documented rows');
  for (const {vi, shardPath: expected} of fixture) {
    assert.equal(shardPath.shardPathFor(vi), expected, `shard path for "${vi}"`);
  }
});

test('shardPathFor is stable and matches its own components', () => {
  assert.equal(shardPath.shardPathFor('quản lý'), shardPath.shardPathFor('  Quản   Lý  '));
  const {folder, file, index} = shardPath.shardComponentsFor('quản lý');
  assert.equal(`${folder}/${file}.csv`, shardPath.shardPathFor('quản lý'));
  assert.ok(index >= 0 && index < shardPath.SHARD_COUNT);
});

test('allShardPaths enumerates exactly 128 fixed paths', () => {
  const all = shardPath.allShardPaths();
  assert.equal(all.length, 128);
  assert.equal(new Set(all).size, 128);
  assert.ok(all.includes('00/00.csv'));
  assert.ok(all.includes('07/15.csv'));
});

test('nom-entries-csv round-trips single- and multi-valued entries', () => {
  const entries = [
    {vi: 'quản lý', nom: ['管理'], explain: ['manager, manage, administer']},
    {vi: 'ăn xong', nom: ['咹歱', '咹了'], explain: ['finish eating', 'after eating']}
  ];
  const csv = nomCsv.serializeShardCsv(entries);
  const parsed = nomCsv.parseShardCsv(csv);
  const byVi = Object.fromEntries(parsed.map((e) => [e.vi, e]));
  assert.deepEqual(byVi['quản lý'].nom, ['管理']);
  assert.deepEqual(byVi['quản lý'].explain, ['manager, manage, administer']);
  assert.deepEqual(byVi['ăn xong'].nom, ['咹歱', '咹了']);
  assert.deepEqual(byVi['ăn xong'].explain, ['finish eating', 'after eating']);
});

test('nom-entries-csv sorts rows by normalized vi and parses an empty/header-only shard', () => {
  const csv = nomCsv.serializeShardCsv([
    {vi: 'ăn xong', nom: ['咹歱'], explain: []},
    {vi: 'bạn bè', nom: ['伴陛'], explain: []}
  ]);
  const lines = csv.trim().split('\n');
  assert.equal(lines[0], 'vi,nom,explain');
  // Plain codepoint order, not locale-aware collation -- see nom-entries-csv.js's
  // `compareNormalized` for why: it must be the same order in every environment, not the
  // linguistically "correct" one. "ăn xong" (U+0103) sorts after plain-ASCII "bạn bè" (U+0062)
  // for exactly that reason.
  assert.ok(lines[1].startsWith('bạn bè'), 'plain-ASCII-leading term sorts before a diacritic one');
  assert.deepEqual(nomCsv.parseShardCsv('vi,nom,explain\n'), []);
  assert.deepEqual(nomCsv.parseShardCsv(''), []);
});

test('nom-entries-csv rejects a literal list separator instead of silently merging values', () => {
  assert.throws(
    () => nomCsv.serializeShardCsv([{vi: 'x', nom: ['a|b'], explain: []}]),
    /reserved list separator/
  );
});

test('minified release builds keep the metadata block and stay valid JavaScript', () => {
  const {minifyUserscript} = require('../scripts/lib/minify');
  const source = [
    '// ==UserScript==',
    '// @name        Probe',
    '// @version     1.2.3',
    '// ==/UserScript==',
    '',
    '(function () {',
    '  // a comment that should vanish',
    '  const answer = 41 + 1;',
    '  return answer;',
    '})();',
    ''
  ].join('\n');
  const minified = minifyUserscript(source);

  assert.ok(minified.startsWith(source.slice(0, source.indexOf('// ==/UserScript==') + 18)));
  assert.doesNotMatch(minified, /should vanish/);
  assert.ok(minified.length < source.length);
  assert.doesNotThrow(() => new Function(minified.slice(minified.indexOf('==/UserScript==') + 15)));
  assert.throws(() => minifyUserscript('no header'), /UserScript/);
});
