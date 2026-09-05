const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const text = require('../scripts/lib/text');
const cjk = require('../scripts/lib/cjk');
const paths = require('../scripts/lib/paths');
const sources = require('../scripts/lib/sources');
const userscript = require('../scripts/lib/userscript');

const repoRoot = path.resolve(__dirname, '..');

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

  // add-chu-nom's planner: strip parentheticals, no separator split, no CJK guard.
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

test('raw URLs are derived from the declared repository paths', () => {
  assert.equal(
    paths.rawUrl('nomUserscript'),
    `${paths.rawBaseUrl}/zoopdog-nom-ruby.user.js`
  );
  assert.equal(
    paths.rawUrl('popupUserscript'),
    `${paths.rawBaseUrl}/zoopdog-popupdict.user.js`
  );
  assert.throws(() => paths.rawUrl('nope'), /Unknown repository path/);
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
