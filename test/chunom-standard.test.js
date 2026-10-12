const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const standard = require('../scripts/lib/chunom-standard');
const layer = require('../scripts/chunom-standard-layer');
const order = require('../scripts/user-nom-order');
const {readNomOrder} = require('../scripts/chunom-standard-layer');
const repoPaths = require('../scripts/lib/paths');

// Rows as chunom.org's standard-list answers them (2026-10-11): a character has a Unicode column, a compound has none and the
// frequency 9999999; the last two are rows the list carries that are no Nom text.
const LIST = [
  '#\tUnicode\tFreq.\tText\tQN\tEnglish',
  '1.\tU+27D51\t1\t𧵑\tcủa\tof; to belong to; properties, belongings',
  '2.\t\t9999999\t𧵑終\tcủa chung\tpublic property',
  '3.\tU+5427\t2\t吧\tvà\tand, also',
  '4.\tU+20B20\t4\t𠬠\tmột\tone',
  '5.\t\t9999999\t𠬠𠃣\tmột ít\ta little bit, a tiny bit',
  '6.\tU+31F4\t9999999\tㇴ\tlại\t(iteration mark)',
  '7.\tU+16FF1\t9999999\t𖿱\tNone\t',
  ''
].join('\n');

function tempDir(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zoopdog-chunom-'));
  try {
    return run(dir);
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
}

test('reads characters and compounds, and leaves out the header and what is no Nom text', () => {
  const rows = standard.parseStandardList(LIST);
  assert.deepEqual(rows.map((row) => [row.term, row.nom, row.isCharacter]), [
    ['của', '𧵑', true],
    ['của chung', '𧵑終', false],
    ['và', '吧', true],
    ['một', '𠬠', true],
    ['một ít', '𠬠𠃣', false]
  ]);
  assert.equal(rows[0].english, 'of; to belong to; properties, belongings');
  assert.equal(rows[0].code, 'U+27D51');
});

test('the payload has the shape of mdx_nom.json, plus meanings and the standard character of each reading', () => {
  const payload = standard.buildPayload(standard.parseStandardList(LIST));
  assert.deepEqual(payload.entries, {'của': ['𧵑'], 'của chung': ['𧵑終'], 'và': ['吧'], 'một': ['𠬠'], 'một ít': ['𠬠𠃣']});
  assert.deepEqual(payload.standard, {'của': ['𧵑'], 'và': ['吧'], 'một': ['𠬠']});
  assert.deepEqual(payload.meanings['một ít'], ['a little bit, a tiny bit']);
  assert.equal(require('../scripts/lib/sources').mdxEntries(payload), payload.entries);
  assert.deepEqual([payload.rowCount, payload.characterCount, payload.entryCount], [5, 3, 5]);
});

test('merging adds the Nom forms a term lacks behind its own, and nothing twice', () => {
  const payload = standard.buildPayload(standard.parseStandardList(LIST));
  const dictionary = [
    {vn: 'một', en: [{def: '没', pos: ''}, {def: 'one', pos: ''}]},
    {vn: 'và', en: [{def: '吧', pos: ''}, {def: 'and', pos: ''}]}
  ];
  layer.mergeChunomIntoEntries(dictionary, payload);
  assert.deepEqual(dictionary[0].en.map((item) => item.def), ['没', '𠬠', 'one']); // behind the dictionary's own Nom form
  assert.deepEqual(dictionary[1].en.map((item) => item.def), ['吧', 'and']); // already there: untouched
  assert.equal(dictionary.length, 5); // và, một kept; của, của chung, một ít created

  const snapshot = JSON.stringify(dictionary);
  layer.mergeChunomIntoEntries(dictionary, payload);
  assert.equal(JSON.stringify(dictionary), snapshot);
});

test('a new term gets its Nom forms and the English of the list', () => {
  const dictionary = [];
  layer.mergeChunomIntoEntries(dictionary, standard.buildPayload(standard.parseStandardList(LIST)));
  const entry = dictionary.find((item) => item.vn === 'của chung');
  assert.deepEqual(entry.en, [{def: '𧵑終', pos: ''}, {def: 'public property', pos: ''}]);
});

test('a new term keeps chunom\'s glosses as written, even one that cites a Nom spelling', () => {
  const payload = {entries: {'tư hải': ['四海']}, meanings: {'tư hải': ['the world, cf. 𦊚𣷷']}, standard: {}};
  const dictionary = [];
  layer.mergeChunomIntoEntries(dictionary, payload);
  assert.deepEqual(dictionary[0].en.map((item) => item.def), ['四海', 'the world, cf. 𦊚𣷷']);
});

function withData(files, run) {
  return tempDir((dir) => {
    for (const [name, contents] of Object.entries(files)) {
      fs.writeFileSync(path.join(dir, name), typeof contents === 'string' ? contents : JSON.stringify(contents));
    }
    return run(dir);
  });
}

const CHUNOM = {standard: {'được': ['特'], ba: ['𠀧'], 'một': ['𠬠']}, entries: {}};

test('chunom order comes first and the user\'s own rows after it, so the user\'s row wins for the same term', () => {
  withData({'chunom_standard.json': CHUNOM, 'user_nom_order.jsonc': '[{"vi": "được", "nom": ["得"]}]'}, (dir) => {
    const rows = readNomOrder(path.join(dir, 'user_nom_order.jsonc'), [], CHUNOM);
    // no chunom row for a term the user ordered: the user's file has the last word, and the first
    assert.deepEqual(rows.map((row) => [row.vi, row.nom[0]]), [['ba', '𠀧'], ['một', '𠬠'], ['được', '得']]);
    assert.deepEqual(order.buildNomOrderIndex(rows).get('được'), ['得']);
    // the user's own file is read alone by readUserNomOrder: nothing of chunom's can be written back into it
    assert.deepEqual(order.readUserNomOrder(path.join(dir, 'user_nom_order.jsonc')).map((row) => row.vi), ['được']);
  });
});

test('chunom never reorders a term the user has an entry for', () => {
  withData({'chunom_standard.json': CHUNOM, 'user_nom_order.jsonc': '[]'}, (dir) => {
    const userEntries = [{vi: 'Ba', key: 'ba', nom: ['巴'], explain: []}];
    const rows = readNomOrder(path.join(dir, 'user_nom_order.jsonc'), userEntries, CHUNOM);
    assert.deepEqual(rows.map((row) => row.vi), ['được', 'một']); // `ba` is the user's
  });
});

test('without chunom\'s file the order is the user\'s alone', () => {
  withData({'user_nom_order.jsonc': '[{"vi": "ba", "nom": ["𠀧"]}]'}, (dir) => {
    assert.deepEqual(readNomOrder(path.join(dir, 'user_nom_order.jsonc')).map((row) => row.vi), ['ba']);
    assert.deepEqual(readNomOrder('/nonexistent/user_nom_order.jsonc'), []);
    assert.equal(layer.readChunomStandard('/nonexistent/chunom_standard.json'), null);
  });
});

test('the extension runtime build folds chunom in memory: the source file is untouched and the user\'s order still wins', () => {
  const {buildRuntimeDictionary} = require('../scripts/build-extension-vnedict-json');
  withData({
    'dict.json': [{vn: 'một', en: [{def: 'one', pos: ''}]}],
    'chunom_standard.json': {entries: {'một': ['𠬠'], 'hai': ['𠄩']}, meanings: {}, standard: {'một': ['𠬠']}},
    'order.jsonc': '[]',
    'user': ''
  }, (dir) => {
    const sourcePath = path.join(dir, 'dict.json');
    const before = fs.readFileSync(sourcePath);
    const result = buildRuntimeDictionary({
      sourcePath,
      chunomPath: path.join(dir, 'chunom_standard.json'),
      orderPath: path.join(dir, 'order.jsonc'),
      userNomPath: path.join(dir, 'missing_user_entries'),
      dictionaryPath: path.join(dir, 'out.json'),
      metadataPath: path.join(dir, 'meta.json'),
      collisionsPath: path.join(dir, 'collisions.json')
    });
    assert.ok(fs.readFileSync(sourcePath).equals(before), 'the dictionary source is read, never written');
    assert.ok(fs.readFileSync(result.dictionaryPath, 'utf8').includes('𠄩'), 'a term only chunom has is in the build');
  });
});

test('the extension dictionary build adds chunom\'s words once and keeps its own forms first', () => {
  const entries = [{vn: 'một', en: [{def: '没', pos: ''}, {def: 'one', pos: ''}]}];
  layer.mergeChunomIntoEntries(entries, standard.buildPayload(standard.parseStandardList(LIST)));
  layer.mergeChunomIntoEntries(entries, standard.buildPayload(standard.parseStandardList(LIST)));
  assert.deepEqual(entries[0].en.map((item) => item.def), ['没', '𠬠', 'one']);
});
