const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const standard = require('../scripts/lib/chunom-standard');
const layer = require('../scripts/chunom-standard-layer');
const order = require('../scripts/user-nom-order');
const repoPaths = require('../scripts/lib/paths');
const nomMerge = require('../scripts/lib/nom-merge');
const mdxMerge = require('../scripts/merge-mdx-nom-into-vnedict2');

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
    const rows = layer.readNomOrder(path.join(dir, 'user_nom_order.jsonc'), [], CHUNOM);
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
    const rows = layer.readNomOrder(path.join(dir, 'user_nom_order.jsonc'), userEntries, CHUNOM);
    assert.deepEqual(rows.map((row) => row.vi), ['được', 'một']); // `ba` is the user's
  });
});

test('without chunom\'s file the order is the user\'s alone', () => {
  withData({'user_nom_order.jsonc': '[{"vi": "ba", "nom": ["𠀧"]}]'}, (dir) => {
    assert.deepEqual(layer.readNomOrder(path.join(dir, 'user_nom_order.jsonc')).map((row) => row.vi), ['ba']);
    assert.deepEqual(layer.readNomOrder('/nonexistent/user_nom_order.jsonc'), []);
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

test('a caseSensitive surname row leaves the lowercase word to chunom and still wins for its exact spelling', () => {
  const payload = {entries: {}, standard: {'triệu': ['兆']}};
  withData({
    'chunom_standard.json': payload,
    'user_nom_order.jsonc': '[{"vi": "Triệu", "nom": ["趙"], "caseSensitive": true}]'
  }, (dir) => {
    const orderPath = path.join(dir, 'user_nom_order.jsonc');
    const rows = layer.readNomOrder(orderPath, [], payload);
    assert.deepEqual(order.buildNomOrderIndex(rows).get('triệu'), ['兆']);

    // the nom-ruby maps: the casefolded entry leads with chunom's character, the exact spelling still renders the surname's
    const nomMap = {'triệu': '趙 / 兆 / 召'};
    order.applyUserNomOrderToNomMap(nomMap, rows);
    order.pinCaseSensitiveVariantsIntoNomMap(nomMap, rows);
    assert.equal(nomMap['triệu'].split(' / ')[0], '兆');
    assert.deepEqual(order.buildCaseSensitiveNomMap(nomMap, rows), {'Triệu': '趙 / 兆 / 召'});
  });
});

test('a casefolded user row still excludes chunom\'s row for the same term', () => {
  const payload = {entries: {}, standard: {'triệu': ['兆']}};
  withData({'user_nom_order.jsonc': '[{"vi": "triệu", "nom": ["召"]}, {"vi": "Triệu", "nom": ["趙"], "caseSensitive": true}]'}, (dir) => {
    const rows = layer.readNomOrder(path.join(dir, 'user_nom_order.jsonc'), [], payload);
    assert.deepEqual(order.buildNomOrderIndex(rows).get('triệu'), ['召']);
  });
});

test('loadChunomLayer reports the user\'s rows and chunom\'s rows separately and applies them in that order', () => {
  const payload = {entries: {'một': ['𠬠']}, standard: {'được': ['特'], ba: ['𠀧']}};
  withData({
    'chunom_standard.json': payload,
    'user_nom_order.jsonc': '[{"vi": "được", "nom": ["得"]}]'
  }, (dir) => {
    const loaded = layer.loadChunomLayer({
      chunomPath: path.join(dir, 'chunom_standard.json'),
      orderPath: path.join(dir, 'user_nom_order.jsonc'),
      userEntries: []
    });
    assert.deepEqual(loaded.userOrderRows.map((row) => row.vi), ['được']);
    assert.deepEqual(loaded.chunomOrderRows.map((row) => row.vi), ['ba']); // `được` is the user's
    assert.deepEqual(loaded.orderRows.map((row) => row.vi), ['ba', 'được']);
    const entries = [];
    loaded.fold(entries);
    assert.deepEqual(entries.map((entry) => entry.vn), ['một']);
  });
});

test('loadChunomLayer without chunom\'s file is the user\'s order alone and folds nothing', () => {
  withData({'user_nom_order.jsonc': '[{"vi": "ba", "nom": ["𠀧"]}]'}, (dir) => {
    const loaded = layer.loadChunomLayer({
      chunomPath: path.join(dir, 'missing.json'),
      orderPath: path.join(dir, 'user_nom_order.jsonc')
    });
    assert.equal(loaded.payload, null);
    assert.deepEqual(loaded.chunomOrderRows, []);
    assert.deepEqual(loaded.orderRows, loaded.userOrderRows);
    const entries = [{vn: 'ba', en: []}];
    loaded.fold(entries);
    assert.deepEqual(entries, [{vn: 'ba', en: []}]);
  });
});

test('the real builders return the user\'s own order rows, without chunom\'s', () => {
  const {buildFullNomMap} = require('../scripts/build-nom-userscript');
  const {buildFullDictionary} = require('../scripts/build-popupdict-userscript');
  const own = order.readUserNomOrder(repoPaths.absolute.userNomOrder).length;
  assert.equal(buildFullNomMap().userNomOrder.length, own);
  assert.equal(buildFullDictionary().userNomOrder.length, own);
});

test('a malformed chunom_standard.json fails with its path and the offending key', () => {
  withData({
    'no-entries.json': {standard: {}},
    'string-forms.json': {entries: {'một': '𠬠'}},
    'bad-meanings.json': {entries: {}, meanings: {'hai': [2]}},
    'not-object.json': [],
    'valid.json': {entries: {'một': ['𠬠']}}
  }, (dir) => {
    const at = (name) => path.join(dir, name);
    assert.throws(() => layer.readChunomStandard(at('no-entries.json')), (error) => error.message.includes(at('no-entries.json')) && error.message.includes('entries'));
    assert.throws(() => layer.readChunomStandard(at('string-forms.json')), (error) => error.message.includes(at('string-forms.json')) && error.message.includes('một'));
    assert.throws(() => layer.readChunomStandard(at('bad-meanings.json')), (error) => error.message.includes('meanings') && error.message.includes('hai'));
    assert.throws(() => layer.readChunomStandard(at('not-object.json')), /must be a JSON object/);
    assert.deepEqual(layer.readChunomStandard(at('valid.json')).entries, {'một': ['𠬠']});
  });
});

test('the mdx path and the chunom path merge the same forms into identical entries', () => {
  const forms = {'một': ['𠬠', '没'], 'hai': ['𠄩'], 'ba': ['𠀧']};
  const base = () => [{vn: 'một', en: [{def: '没', pos: ''}, {def: 'one', pos: ''}]}];

  const viaShared = base();
  const counts = nomMerge.mergeNomFormsIntoEntries(viaShared, forms);
  assert.deepEqual([counts.updatedEntries, counts.createdEntries, counts.skippedMalformed], [1, 2, 0]);

  const viaChunom = base();
  layer.mergeChunomIntoEntries(viaChunom, {entries: forms, standard: {}, meanings: {}});
  assert.deepEqual(viaChunom, viaShared);

  // the mdx script's own main(), on files, with its write captured
  withData({'dict.json': base(), 'mdx.json': {entries: forms}}, (dir) => {
    let written = null;
    mdxMerge.main({
      dictionaryPath: path.join(dir, 'dict.json'),
      mdxNomPath: path.join(dir, 'mdx.json'),
      write: (target, bytes) => { written = bytes; }
    });
    assert.deepEqual(JSON.parse(written), viaShared);
  });
  assert.equal(mdxMerge.insertNomDefinitions, nomMerge.insertNomDefinitions, 'the mdx script re-exports the shared helper');
  assert.equal(mdxMerge.dedupeDefinitions, nomMerge.dedupeDefinitions);
});

test('empty keys and blank Nom forms create no entry; non-array forms are counted as malformed', () => {
  const entries = [];
  const result = nomMerge.mergeNomFormsIntoEntries(entries, {
    '   ': ['𠬠'],
    'trống': ['', '  '],
    'hỏng': '𠬠',
    'một': ['𠬠']
  }, {extraDefsFor: (term) => ['gloss of ' + term]});
  assert.deepEqual(entries, [{vn: 'một', en: [{def: '𠬠', pos: ''}, {def: 'gloss of một', pos: ''}]}]);
  assert.deepEqual([result.createdEntries, result.skippedMalformed], [1, 1]);

  const viaChunom = [];
  layer.mergeChunomIntoEntries(viaChunom, {entries: {'trống': ['', ' ']}, meanings: {'trống': ['empty']}, standard: {}});
  assert.deepEqual(viaChunom, []);
});

test('indexEntriesByKey groups entries by normalized headword and skips empty ones', () => {
  const a = {vn: 'Ba Lê', en: []};
  const b = {vn: 'ba  lê', en: []};
  const blank = {vn: '  ', en: []};
  const index = nomMerge.indexEntriesByKey([a, b, blank]);
  assert.deepEqual([...index.keys()], ['ba lê']);
  assert.deepEqual(index.get('ba lê'), [a, b]);
});
