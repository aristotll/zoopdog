'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');

const {
  METADATA_SCHEMA_VERSION,
  buildMetadata,
  mergeUserNomEntriesIntoEntries,
  serializeRuntimeDictionary,
  validateEntry
} = require('../scripts/build-extension-vnedict-json');
const {
  ERRORS,
  STATES,
  RuntimeError,
  createCoordinator,
  createDexieAdapter,
  parseDictionary,
  validateMetadata
} = require('../zd-extension/js/zd-dictionary-runtime');
const {
  FRAME_BOUNDS,
  PROTOCOL_VERSION,
  bindFramePort,
  clampDimensions,
  validateFrameMessage,
  validateInitEvent,
  validateParentMessage
} = require('../zd-extension/js/zd-popup-protocol');
const {
  createLatestTask,
  runWhenReady
} = require('../zd-extension/js/zd-browser-runtime');

test('runtime dictionary builder emits deterministic compact bytes and exact metadata', () => {
  const entries = [
    {vn: 'xin chào', en: [{def: 'hello', pos: 'int'}]},
    {vn: 'chó', en: [{def: 'dog', pos: ''}]}
  ];
  const bytes = serializeRuntimeDictionary(entries);
  const again = serializeRuntimeDictionary(entries);
  const metadata = buildMetadata(bytes);

  assert.equal(bytes, again);
  assert.equal(bytes, JSON.stringify(entries));
  assert.deepEqual(metadata, {
    schemaVersion: METADATA_SCHEMA_VERSION,
    revision: crypto.createHash('sha256').update(bytes).digest('hex'),
    entryCount: 2
  });
});

test('runtime dictionary revision changes when content changes', () => {
  const before = serializeRuntimeDictionary([
    {vn: 'chó', en: [{def: 'dog', pos: ''}]}
  ]);
  const after = serializeRuntimeDictionary([
    {vn: 'chó', en: [{def: 'hound', pos: ''}]}
  ]);

  assert.notEqual(buildMetadata(before).revision, buildMetadata(after).revision);
});

test('runtime dictionary builder rejects malformed entries before writing', () => {
  assert.throws(
    () => serializeRuntimeDictionary([{vn: 'chó', en: [{def: 3, pos: ''}]}]),
    /definition/i
  );
  assert.throws(() => serializeRuntimeDictionary({vn: 'chó'}), /array/i);
});

// The hand-maintained entries are the authority on a term's Chu Nom, and the extension is
// the surface that reads `zd-extension/js/vnedict.json` -- so they have to reach it the same
// way they already reach both userscripts.
test('the extension build merges hand-maintained Nom into an existing headword', () => {
  const entries = [{vn: 'đúng lúc', en: [{def: 'at the right time', pos: ''}]}];

  const merged = mergeUserNomEntriesIntoEntries(entries, [
    {vi: 'đúng lúc', key: 'đúng lúc', nom: ['中𣅶'], explain: ['At the right time']}
  ]);

  assert.equal(merged, 1);
  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0].en.map((item) => item.def), [
    '中𣅶',
    'at the right time',
    'At the right time'
  ]);
  validateEntry(entries[0], 0);
});

test('the extension build creates an entry for a headword the dictionary never listed', () => {
  const entries = [{vn: 'chó', en: [{def: 'dog', pos: ''}]}];

  const merged = mergeUserNomEntriesIntoEntries(entries, [
    {vi: 'Thượng Quan', key: 'thượng quan', nom: ['上官'], explain: ['Shangguan']}
  ]);

  assert.equal(merged, 1);
  assert.deepEqual(entries[1], {
    vn: 'Thượng Quan',
    en: [{def: '上官', pos: ''}, {def: 'Shangguan', pos: ''}]
  });
  validateEntry(entries[1], 1);
});

test('the extension build never duplicates a rendering the dictionary already carries', () => {
  const entries = [{vn: 'ba', en: [{def: '𠀧', pos: ''}, {def: 'three', pos: ''}]}];

  const merged = mergeUserNomEntriesIntoEntries(entries, [
    {vi: 'ba', key: 'ba', nom: ['𠀧'], explain: ['three']}
  ]);

  assert.equal(merged, 0);
  assert.deepEqual(entries[0].en.map((item) => item.def), ['𠀧', 'three']);
});

test('the repository runtime dictionary carries the hand-maintained entries', () => {
  const repoPaths = require('../scripts/lib/paths');
  const {readUserNomEntries} = require('../scripts/user-nom-entries');
  const userEntries = readUserNomEntries(repoPaths.absolute.userNomEntries);
  const runtime = JSON.parse(
    fs.readFileSync(repoPaths.absolute.runtimeDictionary, 'utf8')
  );

  const byKey = new Map();
  for (const entry of runtime) {
    const key = entry.vn.normalize('NFC').toLocaleLowerCase('vi-VN').replace(/\s+/gu, ' ');
    if (!byKey.has(key)) {
      byKey.set(key, new Set());
    }
    for (const item of entry.en) {
      byKey.get(key).add(item.def);
    }
  }

  const missing = userEntries.filter((entry) => {
    const definitions = byKey.get(entry.key);
    return !definitions || !entry.nom.every((nom) => definitions.has(nom));
  });

  assert.deepEqual(missing.map((entry) => entry.vi), []);
});

function fixtureBytes(definition = 'dog') {
  return JSON.stringify([{vn: 'chó', en: [{def: definition, pos: ''}]}]);
}

function fixtureMetadata(bytes = fixtureBytes()) {
  return {
    schemaVersion: METADATA_SCHEMA_VERSION,
    revision: crypto.createHash('sha256').update(bytes).digest('hex'),
    entryCount: 1
  };
}

function createAdapter({metadata = null, entries = []} = {}) {
  const state = {metadata, entries: structuredClone(entries), replacements: 0};
  return {
    state,
    async readState() {
      return {metadata: state.metadata, entryCount: state.entries.length};
    },
    async replace(nextEntries, nextMetadata) {
      state.entries = structuredClone(nextEntries);
      state.metadata = structuredClone(nextMetadata);
      state.replacements += 1;
    }
  };
}

test('runtime metadata and payload validators reject wrong schema, count and entry shape', () => {
  const bytes = fixtureBytes();
  assert.deepEqual(validateMetadata(fixtureMetadata(bytes)), fixtureMetadata(bytes));
  assert.throws(
    () => validateMetadata({...fixtureMetadata(bytes), schemaVersion: 2}),
    (error) => error instanceof RuntimeError && error.code === ERRORS.METADATA_INVALID.code
  );
  assert.throws(
    () => parseDictionary(bytes, {...fixtureMetadata(bytes), entryCount: 2}),
    (error) => error instanceof RuntimeError && error.code === ERRORS.PAYLOAD_INVALID.code
  );
  assert.throws(
    () => parseDictionary('[{"vn":"chó","en":[{"def":3,"pos":""}]}]', fixtureMetadata(bytes)),
    (error) => error instanceof RuntimeError && error.code === ERRORS.PAYLOAD_INVALID.code
  );
});

test('coordinator skips payload replacement only for internally current data', async () => {
  const bytes = fixtureBytes();
  const metadata = fixtureMetadata(bytes);
  const adapter = createAdapter({metadata, entries: JSON.parse(bytes)});
  let dictionaryFetches = 0;
  const coordinator = createCoordinator({
    adapter,
    fetchMetadata: async () => metadata,
    fetchDictionaryText: async () => {
      dictionaryFetches += 1;
      return bytes;
    },
    digest: async () => metadata.revision
  });

  const result = await coordinator.ensureReady();
  assert.equal(result.state, STATES.READY_CURRENT);
  assert.equal(dictionaryFetches, 0);
  assert.equal(adapter.state.replacements, 0);
});

test('metadata-less rows refresh once and a forced reload refreshes current rows', async () => {
  const bytes = fixtureBytes();
  const metadata = fixtureMetadata(bytes);
  const adapter = createAdapter({entries: JSON.parse(bytes)});
  const coordinator = createCoordinator({
    adapter,
    fetchMetadata: async () => metadata,
    fetchDictionaryText: async () => bytes,
    digest: async () => metadata.revision
  });

  assert.equal((await coordinator.ensureReady()).state, STATES.READY_REFRESHED);
  assert.equal(adapter.state.replacements, 1);
  assert.equal((await coordinator.ensureReady({force: true})).state, STATES.READY_REFRESHED);
  assert.equal(adapter.state.replacements, 2);
});

test('coordinator coalesces concurrent readiness calls into one replacement', async () => {
  const bytes = fixtureBytes();
  const metadata = fixtureMetadata(bytes);
  const adapter = createAdapter();
  let resolveDictionary;
  const dictionary = new Promise((resolve) => { resolveDictionary = resolve; });
  const coordinator = createCoordinator({
    adapter,
    fetchMetadata: async () => metadata,
    fetchDictionaryText: async () => dictionary,
    digest: async () => metadata.revision
  });

  const first = coordinator.ensureReady();
  const second = coordinator.ensureReady();
  resolveDictionary(bytes);
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.equal(firstResult.state, STATES.READY_REFRESHED);
  assert.deepEqual(secondResult, firstResult);
  assert.equal(adapter.state.replacements, 1);
});

test('refresh failure preserves validated prior data as stale and performs no replacement', async () => {
  const oldBytes = fixtureBytes('old dog');
  const oldMetadata = fixtureMetadata(oldBytes);
  const adapter = createAdapter({metadata: oldMetadata, entries: JSON.parse(oldBytes)});
  const coordinator = createCoordinator({
    adapter,
    fetchMetadata: async () => fixtureMetadata(fixtureBytes('new dog')),
    fetchDictionaryText: async () => { throw new Error('offline'); },
    digest: async () => 'unused'
  });

  const result = await coordinator.ensureReady();
  assert.equal(result.state, STATES.READY_STALE);
  assert.equal(result.error.code, ERRORS.PAYLOAD_FETCH.code);
  assert.match(result.error.remedy, /retry/i);
  assert.equal(adapter.state.replacements, 0);
  assert.deepEqual(adapter.state.entries, JSON.parse(oldBytes));
});

test('first-run failure is unavailable with a stable remedy', async () => {
  const adapter = createAdapter();
  const coordinator = createCoordinator({
    adapter,
    fetchMetadata: async () => { throw new Error('offline'); },
    fetchDictionaryText: async () => fixtureBytes(),
    digest: async () => 'unused'
  });

  const result = await coordinator.ensureReady();
  assert.equal(result.state, STATES.UNAVAILABLE);
  assert.equal(result.error.code, ERRORS.METADATA_FETCH.code);
  assert.match(result.error.remedy, /retry/i);
});

test('digest mismatch blocks replacement while no-digest mode is explicit', async () => {
  const bytes = fixtureBytes();
  const metadata = fixtureMetadata(bytes);
  const rejectedAdapter = createAdapter();
  const rejected = createCoordinator({
    adapter: rejectedAdapter,
    fetchMetadata: async () => metadata,
    fetchDictionaryText: async () => bytes,
    digest: async () => '0'.repeat(64)
  });
  const rejectedResult = await rejected.ensureReady();
  assert.equal(rejectedResult.error.code, ERRORS.DIGEST_MISMATCH.code);
  assert.equal(rejectedAdapter.state.replacements, 0);

  const reducedAdapter = createAdapter();
  const reduced = createCoordinator({
    adapter: reducedAdapter,
    fetchMetadata: async () => metadata,
    fetchDictionaryText: async () => bytes,
    digest: null
  });
  const reducedResult = await reduced.ensureReady();
  assert.equal(reducedResult.state, STATES.READY_REFRESHED);
  assert.equal(reducedResult.verification, 'shape-and-count');
});

function createFakeDexie({entries, metadata, failBulkAdd = false}) {
  let rows = structuredClone(entries);
  let record = metadata ? {...metadata, key: 'dictionary'} : undefined;
  const entriesTable = {
    async count() { return rows.length; },
    async clear() { rows = []; },
    async bulkAdd(nextRows) {
      if (failBulkAdd) throw new Error('controlled bulk failure');
      rows.push(...structuredClone(nextRows));
    }
  };
  const metadataTable = {
    async get() { return record; },
    async put(nextRecord) { record = structuredClone(nextRecord); }
  };
  return {
    entries: entriesTable,
    metadata: metadataTable,
    snapshot() { return {entries: structuredClone(rows), metadata: structuredClone(record)}; },
    async transaction(_mode, _entries, _metadata, operation) {
      const before = this.snapshot();
      try {
        return await operation();
      } catch (error) {
        rows = before.entries;
        record = before.metadata;
        throw error;
      }
    }
  };
}

test('Dexie adapter replaces entries and metadata atomically', async () => {
  const oldBytes = fixtureBytes('old dog');
  const oldMetadata = fixtureMetadata(oldBytes);
  const nextBytes = fixtureBytes('new dog');
  const nextMetadata = fixtureMetadata(nextBytes);
  const db = createFakeDexie({
    entries: JSON.parse(oldBytes),
    metadata: oldMetadata,
    failBulkAdd: true
  });
  const adapter = createDexieAdapter(db);

  await assert.rejects(
    () => adapter.replace(JSON.parse(nextBytes), nextMetadata),
    /controlled bulk failure/
  );
  assert.deepEqual(db.snapshot(), {
    entries: JSON.parse(oldBytes),
    metadata: {...oldMetadata, key: 'dictionary'}
  });
});

test('extension service worker uses revision-aware Dexie schema and shared coordinator', () => {
  const source = fs.readFileSync(path.join(repoRoot, 'zd-extension/js/background.js'), 'utf8');
  const runtimeImport = source.indexOf('importScripts(chrome.runtime.getURL("js/zd-dictionary-runtime.js"))');
  const coordinatorUse = source.indexOf('zdDictionaryRuntime.createCoordinator');

  assert.notEqual(runtimeImport, -1);
  assert.ok(runtimeImport < coordinatorUse);
  assert.match(source, /db\.version\(3\)\.stores\([\s\S]*metadata:\s*['"]&key['"]/u);
  assert.doesNotMatch(source, /db\.entries\.clear\(\)\s*\.then\(\(\) => populateFrom/u);
  assert.match(source, /ensureReady\(\{force:\s*true\}\)/u);
  assert.match(source, /ERRORS\.METADATA_INVALID/u);
  assert.match(source, /globalThis\.crypto/u);
});

test('website source and generated page load dictionary runtime before popup logic', () => {
  for (const relativePath of ['popupdict.jade', 'popupdict.html']) {
    const source = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
    const runtime = source.indexOf('zd-extension/js/zd-dictionary-runtime.js');
    const popup = source.indexOf('js/popupdict.js');
    assert.notEqual(runtime, -1, relativePath);
    assert.ok(runtime < popup, relativePath);
    assert.match(source, /dictionary-status/u, relativePath);
  }
  const popupSource = fs.readFileSync(path.join(repoRoot, 'js/popupdict.js'), 'utf8');
  assert.match(popupSource, /db\.version\(3\)\.stores\([\s\S]*metadata:\s*['"]&key['"]/u);
  assert.match(popupSource, /zdDictionaryRuntime\.createCoordinator/u);
  assert.match(popupSource, /location\.protocol\s*===\s*['"]file:['"]/u);
  assert.match(popupSource, /new XMLHttpRequest\(\)/u);
  assert.match(popupSource, /dialect-menu[\s\S]*addEventListener\(['"]change['"]/u);
});

test('extension popup exposes refresh state and disables reload while pending', () => {
  const jade = fs.readFileSync(path.join(repoRoot, 'zd-extension/popup.jade'), 'utf8');
  const html = fs.readFileSync(path.join(repoRoot, 'zd-extension/popup.html'), 'utf8');
  const source = fs.readFileSync(path.join(repoRoot, 'zd-extension/js/popup.js'), 'utf8');
  assert.match(jade, /#dictionary-status/u);
  assert.match(html, /id="dictionary-status"/u);
  assert.match(source, /reload\.disabled\s*=\s*true/u);
  assert.match(source, /reload\.disabled\s*=\s*false/u);
  assert.match(source, /dictionary-status/u);
  assert.match(source, /function sendRuntimeMessage/u);
  assert.equal((source.match(/chrome\.runtime\.sendMessage/gu) || []).length, 1);
});

function validResults() {
  return [{vn: 'chó', en: [{def: 'dog', pos: 'noun'}]}];
}

test('popup protocol accepts only closed, bounded parent messages', () => {
  assert.equal(validateParentMessage({
    version: PROTOCOL_VERSION,
    type: 'populate',
    dialect: 'hanoi',
    results: validResults()
  }), true);
  assert.equal(validateParentMessage({version: PROTOCOL_VERSION, type: 'lock'}), true);
  assert.equal(validateParentMessage({version: PROTOCOL_VERSION, type: 'unlock'}), true);
  assert.equal(validateParentMessage({version: 99, type: 'lock'}), false);
  assert.equal(validateParentMessage({version: PROTOCOL_VERSION, type: 'populate', dialect: 'x', results: validResults()}), false);
  assert.equal(validateParentMessage({version: PROTOCOL_VERSION, type: 'populate', dialect: 'hanoi', results: Array(101).fill(validResults()[0])}), false);
  assert.equal(validateParentMessage({version: PROTOCOL_VERSION, type: 'lock', payload: 'no'}), false);
});

test('popup protocol validates and clamps frame dimensions', () => {
  assert.equal(validateFrameMessage({
    version: PROTOCOL_VERSION,
    type: 'resize',
    dimensions: {height: 120, width: 240, verticalPadding: 10, horizontalPadding: 10}
  }), true);
  assert.equal(validateFrameMessage({version: PROTOCOL_VERSION, type: 'toggle-lock'}), true);
  for (const bad of [-1, Infinity, NaN, '12', undefined]) {
    assert.equal(validateFrameMessage({
      version: PROTOCOL_VERSION,
      type: 'resize',
      dimensions: {height: bad, width: 20, verticalPadding: 0, horizontalPadding: 0}
    }), false);
  }
  assert.deepEqual(
    clampDimensions({height: 10000, width: 10000, verticalPadding: 50, horizontalPadding: 50}),
    {height: FRAME_BOUNDS.maxHeight, width: FRAME_BOUNDS.maxWidth}
  );
});

test('popup initializer requires the parent source, protocol version and one transferred port', () => {
  const parent = {};
  const port = {postMessage() {}};
  assert.equal(validateInitEvent({
    source: parent,
    data: {type: 'zd:init', version: PROTOCOL_VERSION},
    ports: [port]
  }, parent), port);
  assert.equal(validateInitEvent({source: {}, data: {type: 'zd:init', version: PROTOCOL_VERSION}, ports: [port]}, parent), null);
  assert.equal(validateInitEvent({source: parent, data: {type: 'populate', version: PROTOCOL_VERSION}, ports: [port]}, parent), null);
  assert.equal(validateInitEvent({source: parent, data: {type: 'zd:init', version: PROTOCOL_VERSION}, ports: []}, parent), null);
});

test('frame port binder accepts one initializer, ignores ambient traffic and closes its session', () => {
  const listeners = new Set();
  const target = {
    addEventListener(type, listener) { if (type === 'message') listeners.add(listener); },
    removeEventListener(type, listener) { if (type === 'message') listeners.delete(listener); },
    dispatch(event) { for (const listener of [...listeners]) listener(event); }
  };
  const parent = {};
  const messages = [];
  function fakePort(name) {
    return {
      name,
      closed: false,
      postMessage() {},
      start() {},
      close() { this.closed = true; }
    };
  }
  const first = fakePort('first');
  const second = fakePort('second');
  const binding = bindFramePort(target, parent, (message) => messages.push(message));

  target.dispatch({source: parent, data: {type: 'populate', version: PROTOCOL_VERSION}, ports: [first]});
  assert.equal(binding.getPort(), null);
  target.dispatch({source: parent, data: {type: 'zd:init', version: PROTOCOL_VERSION}, ports: [first]});
  assert.equal(binding.getPort(), first);
  target.dispatch({source: parent, data: {type: 'zd:init', version: PROTOCOL_VERSION}, ports: [second]});
  assert.equal(binding.getPort(), first);
  first.onmessage({data: {type: 'lock'}});
  assert.deepEqual(messages, [{type: 'lock'}]);
  binding.close();
  assert.equal(first.closed, true);
  assert.equal(binding.getPort(), null);
});

test('Handlebars popup template escapes dictionary-controlled markup', () => {
  const Handlebars = require('../zd-extension/js/lib/handlebars.min.js');
  const templateSource = fs.readFileSync(path.join(repoRoot, 'zd-extension/frame.jade'), 'utf8');
  assert.doesNotMatch(templateSource, /\{\{\{/u);
  const rendered = Handlebars.compile('{{vn}} {{def}}')({vn: '<img src=x>', def: '<script>x</script>'});
  assert.equal(rendered, '&lt;img src&#x3D;x&gt; &lt;script&gt;x&lt;/script&gt;');
});

test('popup endpoints use one-time MessageChannel transport and one frame source', () => {
  const showframe = fs.readFileSync(path.join(repoRoot, 'zd-extension/js/showframe.js'), 'utf8');
  const frame = fs.readFileSync(path.join(repoRoot, 'zd-extension/js/frame.js'), 'utf8');
  const protocol = fs.readFileSync(path.join(repoRoot, 'zd-extension/js/zd-popup-protocol.js'), 'utf8');
  const jade = fs.readFileSync(path.join(repoRoot, 'zd-extension/frame.jade'), 'utf8');
  const html = fs.readFileSync(path.join(repoRoot, 'zd-extension/frame.html'), 'utf8');

  assert.match(showframe, /new MessageChannel\(\)/u);
  assert.match(showframe, /setAttribute\(['"]sandbox['"],\s*['"]allow-scripts['"]\)/u);
  assert.match(showframe, /this\.dialect\s*=\s*['"]hanoi['"]/u);
  assert.match(showframe, /postMessage\([\s\S]*zd:init[\s\S]*\[channel\.port2\]/u);
  assert.doesNotMatch(showframe, /addEventListener\(['"]message/u);
  assert.match(protocol, /event\.ports\[0\]/u);
  assert.match(protocol, /removeEventListener\(['"]message/u);
  assert.match(frame, /bindFramePort\(window, window\.parent/u);
  assert.doesNotMatch(frame, /window\.postMessage\(\{type:\s*['"]toggle-lock/u);
  assert.match(jade, /script\(src=["']js\/zd-popup-protocol\.js["']\)/u);
  assert.match(jade, /script\(src=["']js\/frame\.js["']\)/u);
  assert.doesNotMatch(jade, /const sendSize|window\.addEventListener/u);
  assert.match(html, /src="js\/zd-popup-protocol\.js"/u);
  assert.match(html, /src="js\/frame\.js"/u);
});

test('ready-state initializer runs once before or after DOM readiness', () => {
  let loadingListener;
  const loadingDocument = {
    readyState: 'loading',
    addEventListener(type, listener, options) {
      assert.equal(type, 'DOMContentLoaded');
      assert.deepEqual(options, {once: true});
      loadingListener = listener;
    }
  };
  let loadingCalls = 0;
  const start = runWhenReady(loadingDocument, () => { loadingCalls += 1; });
  assert.equal(loadingCalls, 0);
  loadingListener();
  loadingListener();
  start();
  assert.equal(loadingCalls, 1);

  let readyCalls = 0;
  runWhenReady({readyState: 'interactive'}, () => { readyCalls += 1; });
  assert.equal(readyCalls, 1);
});

test('latest-task epochs reject stale and invalidated async work', () => {
  const tasks = createLatestTask();
  const first = tasks.begin();
  const second = tasks.begin();
  assert.equal(tasks.isCurrent(first), false);
  assert.equal(tasks.isCurrent(second), true);
  tasks.invalidate();
  assert.equal(tasks.isCurrent(second), false);
});

test('browser entry points initialize additively and lookup sources use epochs', () => {
  const firstPartySources = [
    'zd-extension/js/content.js',
    'zd-extension/js/popup.js',
    'js/popupdict.js',
    'js/zd-pron.js',
    'zd-extension/js/zd-pronguide.js'
  ];
  for (const relativePath of firstPartySources) {
    const source = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
    assert.doesNotMatch(source, /window\.onload\s*=/u, relativePath);
    assert.match(source, /zdBrowserRuntime\.runWhenReady/u, relativePath);
  }
  for (const relativePath of ['zd-extension/js/content.js', 'js/popupdict.js']) {
    const source = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
    assert.match(source, /createLatestTask\(\)/u, relativePath);
    assert.match(source, /isCurrent\(/u, relativePath);
    assert.match(source, /invalidate\(\)/u, relativePath);
    assert.match(source, /oldWord\s*=\s*null/u, relativePath);
    assert.match(source, /popup\.onToggleLock/u, relativePath);
    assert.match(source, /await\s+(?:window|self)\.popup\.inject\(\)[\s\S]*isCurrent\(/u, relativePath);
    const invalidOriginGuard = source.indexOf('if (!origin || !origin.word || !');
    assert.notEqual(invalidOriginGuard, -1, relativePath);
    assert.match(source.slice(invalidOriginGuard, invalidOriginGuard + 300), /invalidateLookup\(\)/u, relativePath);
  }
});

test('browser runtime helper loads before every consumer', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'zd-extension/manifest.json'), 'utf8'));
  const contentScripts = manifest.content_scripts[0].js;
  assert.ok(contentScripts.indexOf('js/zd-browser-runtime.js') < contentScripts.indexOf('js/content.js'));

  const pages = [
    ['popupdict.jade', 'js/popupdict.js'],
    ['pronunciation.jade', 'js/zd-pron.js'],
    ['homophones.jade', 'js/zd-pron.js'],
    ['pronguide.jade', 'zd-extension/js/zd-pronguide.js'],
    ['zd-extension/popup.jade', 'js/popup.js']
  ];
  for (const [relativePath, consumer] of pages) {
    const source = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
    assert.ok(source.indexOf('zd-browser-runtime.js') < source.indexOf(consumer), relativePath);
  }
});

test('extension manifest declares only usage-backed permissions', () => {
  const manifestPath = path.join(repoRoot, 'zd-extension/manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const extensionSource = [
    'zd-extension/js/background.js',
    'zd-extension/js/content.js',
    'zd-extension/js/popup.js'
  ].map((relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')).join('\n');

  assert.deepEqual(manifest.permissions, ['storage']);
  assert.ok(!Object.hasOwn(manifest, 'host_permissions'));
  const permissionUsage = {
    storage: /chrome\.storage/u
  };
  for (const permission of manifest.permissions) {
    assert.ok(permissionUsage[permission], `No usage mapping for ${permission}`);
    assert.match(extensionSource, permissionUsage[permission], permission);
  }
});

test('runtime dictionary build is wired, documented and uses one atomic writer', () => {
  const makefile = fs.readFileSync(path.join(repoRoot, 'Makefile'), 'utf8');
  const buildDocs = fs.readFileSync(path.join(repoRoot, 'docs/build.md'), 'utf8');
  const dataDocs = fs.readFileSync(path.join(repoRoot, 'docs/dictionary-data.md'), 'utf8');
  const pathsSource = fs.readFileSync(path.join(repoRoot, 'scripts/lib/paths.js'), 'utf8');
  const scriptFiles = fs.readdirSync(path.join(repoRoot, 'scripts'), {recursive: true})
    .filter((entry) => String(entry).endsWith('.js'))
    .map((entry) => fs.readFileSync(path.join(repoRoot, 'scripts', String(entry)), 'utf8'))
    .join('\n');

  assert.match(makefile, /^rebuild-extension-vnedict-json:/mu);
  assert.match(makefile, /scripts\/build-extension-vnedict-json\.js/u);
  assert.match(buildDocs, /rebuild-extension-vnedict-json/u);
  assert.match(dataDocs, /vnedict\.meta\.json/u);
  assert.match(pathsSource, /runtimeDictionaryMetadata/u);
  assert.equal((scriptFiles.match(/function atomicWrite\s*\(/gu) || []).length, 1);
  assert.equal(fs.existsSync(path.join(repoRoot, 'zd-extension/js/vnedict.meta.json')), true);
});

test('make verify syntax-checks first-party browser modules', () => {
  const makefile = fs.readFileSync(path.join(repoRoot, 'Makefile'), 'utf8');

  assert.match(makefile, /^verify:\s+verify-scripts\s+verify-browser$/mu);
  assert.match(makefile, /^verify-browser:/mu);
  assert.match(makefile, /find js zd-extension\/js -name '\*\.js'/u);
  assert.match(makefile, /! -path '\*\/lib\/\*'/u);
});
