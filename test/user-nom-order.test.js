const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const order = require('../scripts/user-nom-order');

function withTempFile(contents, run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zoopdog-nom-order-'));
  const file = path.join(dir, 'user_nom_order.jsonc');
  fs.writeFileSync(file, contents, 'utf8');
  try {
    return run(file);
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
}

test('reads a JSONC order file, comments and all', () => {
  const source = [
    '[',
    '  // ba: 𠀧 is the ordinary Nôm numeral; 巴 is a phonetic borrowing',
    '  { "vi": "Ba", "nom": ["𠀧"] },',
    '  { "vi": "quán đỉnh", "nom": ["灌頂", "冠䟓"] }',
    ']'
  ].join('\n');

  const entries = withTempFile(source, (file) => order.readUserNomOrder(file));

  assert.deepEqual(entries, [
    {vi: 'Ba', key: 'ba', nom: ['𠀧']},
    {vi: 'quán đỉnh', key: 'quán đỉnh', nom: ['灌頂', '冠䟓']}
  ]);
});

test('a missing order file is not an error', () => {
  assert.deepEqual(order.readUserNomOrder('/nonexistent/user_nom_order.jsonc'), []);
});

test('rejects rows missing vi or nom', () => {
  assert.throws(() => order.parseUserNomOrder('[{"nom": ["巴"]}]', 'f'), /entry 1 is missing vi/);
  assert.throws(() => order.parseUserNomOrder('[{"vi": "ba"}]', 'f'), /entry 1 is missing nom/);
});

test('the index upserts: a later row for the same term replaces the earlier one', () => {
  const index = order.buildNomOrderIndex([
    {vi: 'ba', key: 'ba', nom: ['巴']},
    {vi: 'Ba', key: 'ba', nom: ['𠀧']}
  ]);
  assert.deepEqual(index.get('ba'), ['𠀧']);
  assert.equal(index.size, 1);
});

test('hoists preferred variants to the front of a nom map entry', () => {
  const nomMap = {ba: '巴 / 𠀧 / 芭'};
  order.applyUserNomOrderToNomMap(nomMap, [{vi: 'ba', key: 'ba', nom: ['𠀧']}]);
  assert.equal(nomMap.ba, '𠀧 / 巴 / 芭');
});

test('hoists several preferred variants in the order given', () => {
  const nomMap = {ba: '巴 / 𠀧 / 芭'};
  order.applyUserNomOrderToNomMap(nomMap, [{vi: 'ba', key: 'ba', nom: ['芭', '𠀧']}]);
  assert.equal(nomMap.ba, '芭 / 𠀧 / 巴');
});

test('a preferred variant the dictionary never listed is inserted at the front', () => {
  const nomMap = {ba: '巴'};
  order.applyUserNomOrderToNomMap(nomMap, [{vi: 'ba', key: 'ba', nom: ['𠀧']}]);
  assert.equal(nomMap.ba, '𠀧 / 巴');
});

test('a term with no dictionary entry at all is created from the order file', () => {
  const nomMap = {};
  order.applyUserNomOrderToNomMap(nomMap, [{vi: 'ba', key: 'ba', nom: ['𠀧']}]);
  assert.equal(nomMap.ba, '𠀧');
});

test('orderPreferredFirst is a stable hoist over definition-shaped rows', () => {
  const rows = [
    ['巴', ''],
    ['three', ''],
    ['𠀧', ''],
    ['芭', '']
  ];
  const ordered = order.orderPreferredFirst(rows, ['𠀧'], (row) => row[0]);
  assert.deepEqual(ordered, [['𠀧', ''], ['巴', ''], ['three', ''], ['芭', '']]);
});

test('orderPreferredFirst matches a preferred variant inside a mixed definition', () => {
  const rows = [{def: 'ba, three'}, {def: '巴 | 𠀧'}];
  const ordered = order.orderPreferredFirst(rows, ['𠀧'], (row) => row.def);
  assert.deepEqual(ordered, [{def: '巴 | 𠀧'}, {def: 'ba, three'}]);
});

test('orderPreferredFirst leaves rows alone when nothing is preferred', () => {
  const rows = [['巴', ''], ['𠀧', '']];
  assert.deepEqual(order.orderPreferredFirst(rows, [], (row) => row[0]), rows);
});

test('the repository order file parses and every row is well formed', () => {
  const repoPaths = require('../scripts/lib/paths');
  const entries = order.readUserNomOrder(repoPaths.absolute.userNomOrder);
  for (const entry of entries) {
    assert.ok(entry.vi, 'vi is present');
    assert.ok(entry.nom.length, `${entry.vi} lists at least one variant`);
  }
});

test('the popupdict build hoists a preferred rendering within a term CJK definitions', () => {
  const popupdict = require('../scripts/build-popupdict-userscript');
  const dictionary = {ba: [['ba', [['巴', ''], ['𠀧', ''], ['three', '']]]]};

  popupdict.applyUserNomOrderToDictionary(dictionary, [{vi: 'ba', key: 'ba', nom: ['𠀧']}]);

  assert.deepEqual(dictionary.ba[0][1], [['𠀧', ''], ['巴', ''], ['three', '']]);
});

test('the popupdict build leaves a term it has no entry for alone', () => {
  const popupdict = require('../scripts/build-popupdict-userscript');
  const dictionary = {};
  popupdict.applyUserNomOrderToDictionary(dictionary, [{vi: 'ba', key: 'ba', nom: ['𠀧']}]);
  assert.deepEqual(dictionary, {});
});

test('the extension build reorders an entry en definitions and reports the count', () => {
  const extension = require('../scripts/build-extension-vnedict-json');
  const entries = [
    {vn: 'Ba', en: [{def: '巴', pos: ''}, {def: '𠀧', pos: ''}, {def: 'three', pos: ''}]},
    {vn: 'bốn', en: [{def: '四', pos: ''}]}
  ];

  const reordered = extension.applyUserNomOrderToEntries(
    entries,
    [{vi: 'ba', key: 'ba', nom: ['𠀧']}]
  );

  assert.equal(reordered, 1);
  assert.deepEqual(entries[0].en.map((item) => item.def), ['𠀧', '巴', 'three']);
  assert.deepEqual(entries[1].en.map((item) => item.def), ['四']);
  // Still a valid runtime entry after the rewrite.
  extension.validateEntry(entries[0], 0);
});

test('the extension build pins a preferred rendering the dictionary never listed', () => {
  const extension = require('../scripts/build-extension-vnedict-json');
  const entries = [{vn: 'ba', en: [{def: '巴', pos: ''}]}];

  extension.applyUserNomOrderToEntries(entries, [{vi: 'ba', key: 'ba', nom: ['𠀧']}]);

  assert.deepEqual(entries[0].en, [{def: '𠀧', pos: ''}, {def: '巴', pos: ''}]);
  extension.validateEntry(entries[0], 0);
});

test('the nom userscript build applies the order file last', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'scripts', 'build-nom-userscript.js'),
    'utf8'
  );
  assert.ok(
    source.indexOf('mergeUserNomEntriesIntoNomMap(nomMap') <
      source.indexOf('applyUserNomOrderToNomMap(nomMap'),
    'ordering runs after every layer that can add a candidate'
  );
});
