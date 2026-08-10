const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const text = require('../scripts/lib/text');
const cjk = require('../scripts/lib/cjk');
const paths = require('../scripts/lib/paths');
const sources = require('../scripts/lib/sources');

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
