const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {execFileSync} = require('node:child_process');

const merge = require('../scripts/merge-mdx-nom-into-vnedict2');
const extract = require('../scripts/extract-mdx-nom-data');

const repoRoot = path.resolve(__dirname, '..');

test('merge inserts Nom definitions ahead of English ones', () => {
  const entry = {vn: 'quản lý', en: [{def: 'to manage', pos: 'v'}]};
  const added = merge.insertNomDefinitions(entry, ['管理']);

  assert.equal(added, 1);
  assert.deepEqual(entry.en, [
    {def: '管理', pos: ''},
    {def: 'to manage', pos: 'v'}
  ]);
});

test('merge inserts after existing Nom definitions, not before them', () => {
  const entry = {
    vn: 'kiểm tra',
    en: [{def: '檢查', pos: ''}, {def: 'to check', pos: 'v'}]
  };
  const added = merge.insertNomDefinitions(entry, ['校驗']);

  assert.equal(added, 1);
  assert.deepEqual(entry.en.map((item) => item.def), ['檢查', '校驗', 'to check']);
});

test('merge skips candidates already present as tokens or definitions', () => {
  const entry = {vn: 'quản lý', en: [{def: '管理 (管治)', pos: ''}]};

  assert.equal(merge.insertNomDefinitions(entry, ['管理']), 0,
    'a token already inside an existing definition is not re-added');
  assert.equal(merge.insertNomDefinitions(entry, ['管治']), 0,
    'cjkTokens sees tokens inside parentheticals');
  assert.equal(entry.en.length, 1);

  assert.equal(merge.insertNomDefinitions(entry, ['理管']), 1);
});

test('merge de-duplicates definitions on the (def, pos) pair', () => {
  const entry = {
    vn: 'a',
    en: [
      {def: 'x', pos: 'n'},
      {def: 'x', pos: 'n'},
      {def: 'x', pos: 'v'},
      {def: ' x ', pos: 'n'}
    ]
  };
  const removed = merge.dedupeDefinitions(entry);

  assert.equal(removed, 2);
  assert.deepEqual(entry.en, [{def: 'x', pos: 'n'}, {def: 'x', pos: 'v'}]);
});

test('merge cjkTokens keeps parentheticals and does not split on separators', () => {
  assert.deepEqual(merge.cjkTokens('管理 (管治), 檢查/䀡'), ['管理', '管治', '檢查', '䀡']);
  assert.deepEqual(merge.cjkTokens('to manage'), []);
});

test('extract strips HTML and entities from MDX definitions', () => {
  // cleanText trims before tags are removed, so tag-adjacent spaces survive; downstream
  // candidate matching does not care, and this pins the existing behaviour.
  assert.equal(extract.stripHtml('<b>quản</b>&nbsp;lý'), ' quản lý');
  assert.equal(extract.stripHtml('<div class="x">管理</div>'), ' 管理 ');
});

test('extract keeps only Vietnamese headwords', () => {
  assert.equal(extract.isVietnameseKey('quản lý'), true);
  assert.equal(extract.isVietnameseKey('management'), true);
  assert.equal(extract.isVietnameseKey('管理'), false);
  assert.equal(extract.isVietnameseKey('管理 quản lý'), false,
    'a key containing CJK is not a Vietnamese headword');
  assert.equal(extract.isVietnameseKey('123'), false);
});

test('extract removes the repeated headword before collecting candidates', () => {
  assert.deepEqual(
    extract.extractCandidates('quản lý 管理', 'quản lý'),
    ['管理']
  );
  assert.deepEqual(
    extract.extractCandidates('<i>quản lý</i> 管理 管治', 'quản lý'),
    ['管理', '管治']
  );
  assert.deepEqual(extract.extractCandidates('no cjk here', 'quản lý'), []);
});

test('extract requires at least two characters in a normalized key', () => {
  const entries = {};
  extract.addEntry(entries, 'y', ['醫']);
  assert.deepEqual(entries, {}, 'single-character keys are dropped');

  extract.addEntry(entries, 'quản lý', ['管理']);
  extract.addEntry(entries, '  QUẢN   LÝ  ', ['管治', '管理']);
  assert.deepEqual(entries, {'quản lý': ['管理', '管治']},
    'keys normalize and candidates merge without duplicates');
});

test('extract reports missing js-mdict from the command line', () => {
  assert.throws(
    () => execFileSync(process.execPath, ['scripts/extract-mdx-nom-data.js', '/nonexistent.mdx'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: 'pipe',
      env: {...process.env, NODE_PATH: ''}
    }),
    (error) => {
      assert.notEqual(error.status, 0);
      assert.match(String(error.stderr), /Missing dependency: js-mdict|js-mdict/);
      return true;
    }
  );
});
