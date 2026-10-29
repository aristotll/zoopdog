'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const runtimePath = path.join(__dirname, '..', 'scripts', 'userscript', 'popupdict-local.runtime.js');
const runtime = fs.readFileSync(runtimePath, 'utf8');
const transport = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'userscript', 'local-transport.js'), 'utf8');
const selectionTools = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'userscript', 'local-selection.js'), 'utf8');
const modalGeometry = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'userscript', 'local-modal-geometry.js'), 'utf8');
const entryDiff = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'userscript', 'local-entry-diff.js'), 'utf8');
const modalGuard = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'userscript', 'local-modal-guard.js'), 'utf8');

function element() {
  const listeners = {};
  let textContent = '';
  const node = {
    children: [],
    classList: {add() {}, remove() {}},
    setAttribute() {},
    closest() { return null; },
    dataset: {},
    hidden: false,
    value: '',
    disabled: false,
    checked: false,
    addEventListener(type, listener) { (listeners[type] || (listeners[type] = [])).push(listener); },
    dispatch(type) { (listeners[type] || []).forEach((listener) => listener({preventDefault() {}})); },
    appendChild(child) { this.children.push(child); },
    querySelector() { return null; },
    get childElementCount() { return this.children.length; }
  };
  Object.defineProperty(node, 'textContent', {
    get() { return textContent; },
    set(value) { textContent = String(value); node.children.length = 0; }
  });
  return node;
}

function createHarness(request) {
  const elements = new Map();
  const document = {
    getElementById(id) { return elements.get(id) || null; },
    createElement() { return element(); },
    // zooWireNotesAll's result rows append plain text nodes alongside the
    // "engines: " <strong> label -- exercised now that zooOpenNomModal
    // auto-runs "Refresh all" on open, not only by a manual button click.
    createTextNode(data) { return {nodeType: 3, textContent: String(data)}; },
    addEventListener() {},
    querySelectorAll() { return []; }
  };
  const context = vm.createContext({
    Promise, JSON, Error, Object, String, Array, Math, Date, isFinite,
    clearTimeout, setTimeout, URL, document,
    setInterval(fn, ms) { const timer = setInterval(fn, ms); timer.unref(); return timer; },
    GM_xmlhttpRequest: request,
    escapeHtml(value) { return String(value); }
  });
  vm.runInContext(transport + '\n' + selectionTools + '\n' + modalGeometry + '\n' + entryDiff + '\n' + modalGuard + '\n' + runtime, context, {filename: runtimePath});
  return {context, elements, add(id) { const node = element(); elements.set(id, node); return node; }};
}

test('local request rejects when manager drops every callback', async () => {
  const {context} = createHarness(() => {});
  context.ZOO_LOCAL_REQUEST_TIMEOUT = 10;
  await assert.rejects(Promise.race([
    context.zooGetJSON('/healthz'),
    new Promise((resolve, reject) => setTimeout(() => reject(new Error('watchdog missing')), 60))
  ]), /timed out/);
});

test('local request resolves on success, rejects startup exceptions, and ignores late callbacks', async () => {
  let options;
  const {context} = createHarness((next) => { options = next; });
  const request = context.zooGetJSON('/healthz');
  options.onload({status: 200, responseText: '{"ok":true}'});
  options.onerror();
  assert.deepEqual(await request, {ok: true});

  const broken = createHarness(() => { throw new Error('startup failed'); });
  await assert.rejects(broken.context.zooGetJSON('/healthz'), /startup failed/);
});

test('a resized Chữ Nôm modal is saved per site and restored on open', () => {
  const harness = createHarness(() => {});
  const {context} = harness;
  const store = new Map();
  context.location = {hostname: 'www.example.co.uk'};
  context.window = {innerWidth: 1200, innerHeight: 800};
  context.GM_setValue = (key, value) => store.set(key, value);
  context.GM_getValue = (key, fallback) => (store.has(key) ? store.get(key) : fallback);
  const classes = new Set();
  const panel = element();
  panel.style = {};
  panel.classList = {add: (name) => classes.add(name)};
  const modal = {querySelector: () => panel};
  harness.elements.set('m', modal);
  context.document.querySelector = (selector) => (selector === '#m .zd-modal' ? panel : null);
  const events = {};
  panel.addEventListener = (type, fn) => { events[type] = fn; };
  context.document.addEventListener = () => {};
  panel.offsetWidth = 400; panel.offsetHeight = 300;

  context.zooMakeModalResizable('m');
  assert.equal(classes.has('zd-modal-resizable'), true);
  events.pointerdown(); events.pointerup();
  assert.equal(store.size, 0, 'an unchanged size is not stored');
  events.pointerdown(); panel.offsetWidth = 640; panel.offsetHeight = 480; events.pointerup();
  assert.deepEqual([...store.keys()], ['zd-modal-size:example.co.uk:m']);
  assert.deepEqual(JSON.parse(store.get('zd-modal-size:example.co.uk:m')), {width: 640, height: 480});

  panel.style = {};
  context.zooRestoreModalSize('m', panel);
  assert.equal(panel.style.width, '640px');
  assert.equal(panel.style.height, '480px');
});

test('local Chữ Nôm suggestions match characters anywhere in a rendering', () => {
  const {context} = createHarness(() => {});
  assert.deepEqual(
    Array.from(context.zooFilterContainingSuggestions(['𥪝𠊛', '𥪝人', '中人'], '𠊛')),
    ['𥪝𠊛'],
  );
  assert.deepEqual(
    Array.from(context.zooFilterContainingSuggestions(['𥪝𠊛', '𥪝人', '中人'], '𥪝')),
    ['𥪝𠊛', '𥪝人'],
  );
});

test('local containing filter keeps native datalist option values', () => {
  const harness = createHarness(() => {});
  const input = harness.add('input');
  const datalist = harness.add('picker');
  harness.context.zooWireContainingDatalist(input, datalist);
  harness.context.zooFillDatalist('picker', ['𥪝𠊛', '𥪝人']);

  input.value = '𠊛';
  input.dispatch('input');
  assert.deepEqual(datalist.children.map((node) => node.value), ['𥪝𠊛']);
  assert.equal(datalist.children[0].label, '𠊛');
});

test('opening or editing a term clears generated Nôm state before the request settles', () => {
  const harness = createHarness((options) => options.onload({status: 200, responseText: '{}'}));
  const ids = harness.context.ZOO_MODAL_IDS.nom;
  Object.keys(ids).forEach((key) => harness.add(ids[key]));
  harness.context.zooWireNomForm();
  const suggestions = harness.elements.get(ids.suggestions);
  suggestions.appendChild(element());
  const nom = harness.elements.get(ids.nom);
  nom.value = '舊';
  nom.dataset.autofillDefault = '舊';

  harness.context.zooOpenNomModal('mới');
  assert.equal(suggestions.childElementCount, 0);
  assert.equal(nom.value, '');
  assert.equal(nom.dataset.autofillDefault, undefined);

  suggestions.appendChild(element());
  nom.value = '舊';
  nom.dataset.autofillDefault = '舊';
  harness.elements.get(ids.vi).dispatch('input');
  assert.equal(suggestions.childElementCount, 0);
  assert.equal(nom.value, '');
  assert.equal(nom.dataset.autofillDefault, undefined);
});

// The server's /v1/nom/form answer: what the modal renders for a term.
function nomForm(candidates, nextOrder) {
  return JSON.stringify({
    candidates, next_order: nextOrder || 'zoopdog', is_update: false, title: 'Add Chữ Nôm entry', existing_info: ''
  });
}

test('an older candidate response cannot overwrite a newer term', async () => {
  const requests = [];
  const harness = createHarness((options) => requests.push(options));
  const ids = harness.context.ZOO_MODAL_IDS.nom;
  Object.keys(ids).forEach((key) => harness.add(ids[key]));
  harness.context.zooWireNomForm();
  harness.context.zooNomFormState.refresh('cũ');
  harness.context.zooNomFormState.refresh('mới');
  const respond = (text, candidates) => requests
    .filter((request) => request.url.includes('/v1/nom/form') && request.url.includes('vi=' + encodeURIComponent(text)))
    .forEach((request) => request.onload({status: 200, responseText: nomForm(candidates)}));
  respond('mới', ['新']);
  await new Promise((resolve) => setImmediate(resolve));
  respond('cũ', ['舊']);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.elements.get(ids.nom).value, '新');
  assert.equal(harness.elements.get(ids.suggestions).children[0].value, '新');
  requests.forEach((request) => request.onload({
    status: 200,
    responseText: request.url.includes('/v1/nom/form') ? nomForm([]) : '{"candidates":[]}'
  }));
});

test('empty candidates stay empty while failures show recovery guidance and re-enable Notes', async () => {
  let request;
  const harness = createHarness((options) => { request = options; });
  const ids = harness.context.ZOO_MODAL_IDS.nom;
  Object.keys(ids).forEach((key) => harness.add(ids[key]));
  harness.context.zooWireNomForm();
  harness.elements.get(ids.vi).value = 'nhân dân tệ';
  harness.elements.get(ids.notesRefresh).dispatch('click');
  request.onload({status: 200, responseText: '{"candidates":[],"engine":"test"}'});
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.elements.get(ids.notesRefresh).disabled, false);
  assert.doesNotMatch(harness.elements.get(ids.status).textContent, /Reload the page/i);

  harness.elements.get(ids.notesRefresh).dispatch('click');
  request.onerror();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.elements.get(ids.notesRefresh).disabled, false);
  assert.match(harness.elements.get(ids.status).textContent, /Reload the page/i);
});

test('the Chữ Nôm refresh button asks for the zoopdog order and refills the field', async () => {
  const requests = [];
  const harness = createHarness((options) => requests.push(options));
  const ids = harness.context.ZOO_MODAL_IDS.nom;
  Object.keys(ids).forEach((key) => harness.add(ids[key]));
  harness.context.zooWireNomForm();
  harness.elements.get(ids.vi).value = 'mới';
  harness.elements.get(ids.nomRefresh).dispatch('click');
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /\/v1\/nom\/form/);
  assert.match(requests[0].url, /order=zoopdog/);
  requests[0].onload({status: 200, responseText: nomForm(['乙', '甲'], 'default')});
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.elements.get(ids.nom).value, '乙');
  assert.equal(harness.elements.get(ids.suggestions).children[0].value, '乙');
  // Second click toggles back to the default ranking; third is zoopdog order again.
  harness.elements.get(ids.nomRefresh).dispatch('click');
  assert.equal(requests.length, 2);
  assert.doesNotMatch(requests[1].url, /order=zoopdog/);
  requests[1].onload({status: 200, responseText: nomForm(['甲', '乙'], 'zoopdog')});
  await new Promise((resolve) => setImmediate(resolve));
  harness.elements.get(ids.nomRefresh).dispatch('click');
  assert.match(requests[2].url, /order=zoopdog/);
});

test('selection rect falls back to composed ranges only for shadow-root text', () => {
  const {context} = createHarness(() => {});
  const shadowRect = {width: 40, height: 10, left: 5, top: 6};
  context.document.createRange = () => ({
    setStart() {}, setEnd() {}, getBoundingClientRect() { return shadowRect; },
    cloneContents() { return 'fragment'; }
  });
  context.document.createElement = () => {
    const removed = [];
    return {
      appendChild() {},
      querySelectorAll() { return [{parentNode: {removeChild(n) { removed.push(n); }}}]; },
      get textContent() { return removed.length ? 'T\u1EEB g\u00F3c' : 'T\u1EEB\u81EA g\u00F3c'; }
    };
  };
  const shadowRoot = {nodeType: 11, children: []};
  const host = {nodeType: 1, shadowRoot, children: []};
  const container = {nodeType: 1, children: [host]};
  const seen = [];
  const selection = {
    getComposedRanges(options) {
      seen.push(options.shadowRoots);
      return [{startContainer: {}, startOffset: 0, endContainer: {}, endOffset: 1}];
    }
  };
  const composed = context.zooComposedSelection(selection, container);
  assert.equal(composed.rect, shadowRect);
  assert.equal(composed.text, 'T\u1EEB g\u00F3c');
  assert.equal(seen[0].length, 1);
  assert.equal(seen[0][0], shadowRoot);
  // No shadow roots: never asks the browser.
  assert.equal(context.zooComposedSelection(selection, {nodeType: 1, children: []}), null);
  assert.equal(seen.length, 1);
  // Browser without getComposedRanges keeps the old behaviour.
  assert.equal(context.zooComposedSelection({}, container), null);
});

test('the update preview draws the server diff: changed segment marked, text never parsed as markup', () => {
  const {context} = createHarness(() => {});
  const list = element();
  const changed = context.zooRenderEntryDiff(list, {
    changed: 1,
    rows: [
      {kind: 'key', field: 'VI', badge: 'entry', value: 'Sư thúc'},
      {kind: 'change', field: 'Chữ Nôm', badge: 'locked',
        old: [{text: 'a', changed: false}, {text: '<b>x</b>', changed: true}], new: []},
      {kind: 'context', field: 'Note', badge: 'unchanged', value: ''}
    ]
  });
  assert.equal(changed, 1);
  assert.equal(list.hidden, false);
  assert.equal(list.children.length, 3);
  const old = list.children[1].children[1];
  assert.equal(old.children[1].children[1].textContent, '<b>x</b>', 'changed run is its own node, set as text');
  assert.equal(list.children[1].children[2].children[1].children[0].textContent, '(empty)');
  assert.equal(context.zooRenderEntryDiff(element(), {changed: 0, rows: []}), 0);
});

test('the Chữ Nôm order modal renders the title, hint and default pick the server wrote', async () => {
  const requests = [];
  const harness = createHarness((options) => requests.push(options));
  const ids = harness.context.ZOO_MODAL_IDS.order;
  Object.keys(ids).forEach((key) => harness.add(ids[key]));
  harness.context.zooWireNomOrderForm();
  harness.elements.get(ids.vi).value = 'ba';
  harness.elements.get(ids.caseSensitive).dispatch('change');
  assert.match(requests[0].url, /\/v1\/nom\/order/);
  requests[0].onload({status: 200, responseText: JSON.stringify({
    exists: false, order: [], variants: ['巴', '𠀧', '三'], title: 'Set Chữ Nôm order', existing_info: '',
    current_hint: 'Currently shown as ruby: 巴 · 3 renderings known', pick: '𠀧'
  })});
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.elements.get(ids.nom).value, '𠀧');
  assert.equal(harness.elements.get(ids.title).textContent, 'Set Chữ Nôm order');
  assert.equal(harness.elements.get(ids.current).textContent, 'Currently shown as ruby: 巴 · 3 renderings known');
  assert.equal(harness.elements.get(ids.existingInfo).hidden, true);
  assert.equal(harness.elements.get(ids.suggestions).children.length, 3);
});

test('a guarded save disables the modal actions until it settles and ignores a second submit', async () => {
  const {context} = createHarness(() => {});
  const attrs = {};
  const button = (cancel) => ({
    disabled: false,
    hasAttribute(name) { return cancel && name === 'data-zd-modal-cancel'; },
    matches(selector) { return selector === 'button'; }
  });
  const save = button(false);
  const confirm = button(false);
  const cancel = button(true);
  const modal = {
    querySelectorAll() { return [save, confirm, cancel]; },
    getAttribute(name) { return attrs[name] || null; },
    setAttribute(name, value) { attrs[name] = value; },
    removeAttribute(name) { delete attrs[name]; }
  };
  save.closest = () => modal;
  let release;
  let calls = 0;
  const guarded = context.zooGuard(() => {
    calls += 1;
    return new Promise((resolve) => { release = resolve; });
  });
  const event = {currentTarget: save, preventDefault() {}};
  guarded(event);
  assert.equal(save.disabled, true);
  assert.equal(confirm.disabled, true);
  assert.equal(cancel.disabled, false, 'Cancel stays usable');
  guarded(event);
  assert.equal(calls, 1, 'a second submit while busy is ignored');
  release();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(save.disabled, false);
  assert.equal(confirm.disabled, false);
  guarded(event);
  assert.equal(calls, 2);
});

// -- Reading a selection aloud ------------------------------------------------------------------

function readHarness(answers, confirmAnswer = true) {
  const requests = [];
  const harness = createHarness((options) => {
    requests.push({url: options.url, method: options.method, body: options.data && JSON.parse(options.data), headers: options.headers});
    const next = answers.shift();
    options.onload({status: next.status, responseText: JSON.stringify(next.body)});
  });
  const toast = harness.add('zoopdog-toast');
  const confirms = [];
  harness.context.window = {confirm(message) { confirms.push(message); return confirmAnswer; }};
  return {harness, requests, toast, confirms};
}

test('reading a selection posts it as JSON and toasts the finished label', async () => {
  const {harness, requests, toast} = readHarness([{status: 202, body: {status: 'queued', label: 'vi → en'}}]);
  await harness.context.zooReadSelection('  Hôm nay. The weather.  ');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, 'POST');
  assert.equal(requests[0].url, 'http://127.0.0.1:8770/v1/zoopdog/speak');
  assert.deepEqual(requests[0].body, {text: 'Hôm nay. The weather.', confirm: false});
  assert.equal(requests[0].headers['Content-Type'], 'application/json');
  assert.equal(toast.textContent, '🔊 vi → en');
});

test('a long selection asks the user and, on yes, resends with confirm', async () => {
  const {harness, requests, confirms} = readHarness([
    {status: 409, body: {status: 'confirm', reason: 'long_text', message: 'This selection is long (5,000 characters). Add it to the queue anyway?'}},
    {status: 202, body: {status: 'queued', label: 'en'}},
  ]);
  await harness.context.zooReadSelection('word '.repeat(1000));
  assert.deepEqual(confirms, ['This selection is long (5,000 characters). Add it to the queue anyway?']);
  assert.deepEqual(requests.map((request) => request.body.confirm), [false, true]);
});

test('declining the confirmation sends nothing more', async () => {
  const {harness, requests, toast} = readHarness([
    {status: 409, body: {status: 'confirm', reason: 'queue_long', message: '4 readings are already waiting in the queue. Add it to the queue anyway?'}},
  ], false);
  await harness.context.zooReadSelection('hello there');
  assert.equal(requests.length, 1);
  assert.equal(toast.textContent, '');
});

test('a refusal is shown as the server worded it, and empty text is never sent', async () => {
  const {harness, requests, toast} = readHarness([{status: 400, body: {status: 'error', message: 'Nothing to read in the selection.'}}]);
  await harness.context.zooReadSelection('   ');
  assert.equal(requests.length, 0);
  assert.equal(toast.textContent, 'Select some text first');
  await harness.context.zooReadSelection('...');
  assert.equal(toast.textContent, 'Nothing to read in the selection.');
});

test('Alt+R reads the selection by physical key and leaves other chords alone', async () => {
  const {harness, requests} = readHarness([{status: 202, body: {label: 'ja'}}]);
  harness.context.window.getSelection = () => ({toString: () => '今日は', rangeCount: 1});
  const press = (extra) => {
    let prevented = false;
    harness.context.zooHandleReadHotkey({altKey: true, code: 'KeyR', key: '®', preventDefault() { prevented = true; }, ...extra});
    return prevented;
  };
  assert.equal(press({ctrlKey: true}), false);
  assert.equal(press({code: 'KeyT'}), false);
  assert.equal(requests.length, 0);
  assert.equal(press({}), true);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(requests[0].body, {text: '今日は', confirm: false});
});

test('Refresh all retries a failing channel alone and shows it as an error next to the answered ones, once', async () => {
  const seen = [];
  const harness = createHarness((options) => {
    const url = new URL(options.url);
    const q = url.searchParams;
    seen.push(url.search);
    const reply = (body) => options.onload({status: 200, responseText: JSON.stringify(body)});
    if (q.get('engines')) return reply({engines: ['a', 'b']});
    if (q.get('engine') === '1' && !q.get('error')) return options.onerror();
    const answered = {engines: ['a'], label: 'a', text: 'ok'};
    if (q.get('error')) {
      return reply({rows: [answered, {engines: ['b'], label: 'error: b', text: '', error: true, message: '(request failed after 3 retries)'}]});
    }
    return reply({rows: [answered, {engines: ['b'], label: 'waiting: b', text: '', pending: true}]});
  });
  harness.context.ZOO_NOTES_ALL_BASE_DELAY_MS = 0;
  const rows = await harness.context.zooFetchNotesAll('nom-notes', 'a');
  assert.equal(seen.filter((search) => search.includes('engine=1')).length, 5); // 1 + 3 retries + error report
  assert.deepEqual(Array.from(rows, (row) => [row.label, row.text]), [['a', 'ok'], ['error: b', '']]);

  const down = createHarness((options) => options.onerror());
  down.context.ZOO_NOTES_ALL_BASE_DELAY_MS = 0;
  const unreachable = await down.context.zooFetchNotesAll('nom-notes', 'a');
  assert.match(unreachable[0].message, /unreachable/);
});

test('Refresh all waits for a slow channel far longer than the generic request timeout', async () => {
  const timeouts = {};
  const harness = createHarness((options) => {
    const q = new URL(options.url).searchParams;
    timeouts[q.get('engines') ? 'list' : q.get('error') ? 'report' : 'channel'] = options.timeout;
    if (q.get('engines')) return options.onload({status: 200, responseText: JSON.stringify({engines: ['a']})});
    return options.onload({status: 200, responseText: JSON.stringify({rows: [{engines: ['a'], label: 'a', text: 'ok'}]})});
  });
  await harness.context.zooFetchNotesAll('nom-notes', 'a');
  assert.equal(timeouts.list, harness.context.ZOO_LOCAL_REQUEST_TIMEOUT);
  assert.ok(timeouts.channel >= 61000, `channel timeout ${timeouts.channel}`);
});

function googleResult(href) {
  const block = {style: {}, title: '', dataset: {}};
  const anchor = {href, getAttribute() { return href; }, querySelector(sel) { return /h3/.test(sel) ? {} : null; }, closest() { return block; }};
  return {anchor, block};
}

function link(href, extra) {
  const anchor = Object.assign({href, style: {}, dataset: {}, title: '', textContent: '', getAttribute() { return null; },
    querySelector() { return null; }, closest() { return null; }}, extra || {});
  return anchor;
}

test('zooAnchorKeys: the direct host, plus page hints for an opaque /goto link, never Google\'s own host', () => {
  const {context} = createHarness(() => {});
  assert.deepEqual(Array.from(context.zooAnchorKeys(link('https://lifestyle.zingnews.vn/a.html'))), ['lifestyle.zingnews.vn']);
  assert.deepEqual(Array.from(context.zooAnchorKeys(link('https://www.google.com/url?q=https%3A%2F%2Fvdict.com%2Fx'))), ['vdict.com']);
  assert.deepEqual(Array.from(context.zooAnchorKeys(link('https://www.google.com/search?q=x'))), []);
  const goto = link('https://www.google.com/goto?url=CAESx', {
    getAttribute: (name) => (name === 'aria-label' ? 'Tuổi Trẻ' : null),
    closest: () => ({innerText: 'Nhà thuốc Long Châu\nhttps://hellobacsi.com › tam-ly › thau-cam\nThấu cảm là gì?'})});
  const keys = Array.from(context.zooAnchorKeys(goto));
  assert.equal(keys[0], 'Tuổi Trẻ');
  assert.ok(keys.includes('Nhà thuốc Long Châu') && keys.includes('hellobacsi.com'));
});

test('zooPaintExplored paints what the server matched, per key, and clears stale marks', () => {
  const {context} = createHarness(() => {});
  const organic = googleResult('https://lifestyle.zingnews.vn/a.html');
  const wrapped = googleResult('https://www.google.com/url?q=https%3A%2F%2Fvdict.com%2Fx&sa=U');
  const miss = googleResult('https://example.org/');
  const chip = link('https://www.hellobacsi.com/a/b');                       // headingless: an overlay on a chip/card
  const doc = {querySelectorAll: () => [organic.anchor, wrapped.anchor, miss.anchor, chip]};
  const matches = {'lifestyle.zingnews.vn': {color: '#c8f7c5', label: 'Probably explored'}, 'vdict.com': {color: '#eadcff', label: 'Explored: research vdict'}, 'www.hellobacsi.com': {color: '#ffe9a8', label: 'Explored: tts hellobacsi'}};
  assert.equal(context.zooPaintExplored(doc, matches), 3);
  assert.equal(organic.block.style.background, '#c8f7c5');           // organic result: plain background on its block
  assert.equal(organic.block.title, 'Probably explored');
  assert.equal(wrapped.block.style.background, '#eadcff');
  assert.equal(miss.block.style.background, undefined);
  assert.equal(chip.style.mixBlendMode, 'multiply');                 // overlay: tinted and outlined, never covered
  assert.equal(chip.style.outline, '2px solid #ffe9a8');
  context.zooPaintExplored(doc, {});
  assert.equal(organic.block.style.background, '');
  assert.equal(chip.style.outline, '');
});

test('an opaque goto link is painted from the answer to any of its page hints', () => {
  const {context} = createHarness(() => {});
  const card = link('https://www.google.com/goto?url=CAESx', {
    getAttribute: (name) => (name === 'aria-label' ? 'Thấu cảm là gì? Lợi ích' : null),
    closest: () => ({innerText: 'Nhà thuốc Long Châu\nThấu cảm là gì?'})});
  const doc = {querySelectorAll: () => [card]};
  assert.equal(context.zooPaintExplored(doc, {'Nhà thuốc Long Châu': {color: '#c8f7c5', label: 'Explored: dict nhathuoclongchau'}}), 1);
  assert.equal(card.title, 'Explored: dict nhathuoclongchau');
  assert.equal(context.zooPaintExplored({querySelectorAll: () => [link('https://www.google.com/goto?url=CAESy', {getAttribute: () => 'Đăng nhập'})]}, {}), 0);
});

test('explored highlight runs only on a Google search page; keys are asked once, after the server answered', async () => {
  const asked = [];
  const harness = createHarness((options) => {
    const url = new URL(options.url);
    const keys = JSON.parse(url.searchParams.get('keys'));
    asked.push(keys);
    const matches = {};
    if (keys.includes('lifestyle.zingnews.vn')) matches['lifestyle.zingnews.vn'] = {color: '#c8f7c5', label: 'Probably explored (same site as znews.vn)'};
    options.onload({status: 200, responseText: JSON.stringify({version: 'v1', matches})});
  });
  harness.context.localStorage = {getItem: () => null, setItem() {}};
  const hit = googleResult('https://lifestyle.zingnews.vn/a.html');
  const doc = {body: null, querySelectorAll: () => [hit.anchor]};
  assert.equal(await harness.context.zooStartExploredHighlight(doc, {hostname: 'example.org', pathname: '/search'}), false);
  assert.equal(asked.length, 0);
  assert.equal(await harness.context.zooStartExploredHighlight(doc, {hostname: 'www.google.com', pathname: '/search'}), true);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(asked, [[], ['lifestyle.zingnews.vn']]);      // version probe first, then the page's key, once
  assert.equal(hit.block.style.background, '#c8f7c5');
  assert.match(hit.block.title, /Probably explored/);
});

test('explored highlight paints the cached answers at once, retries a failed first request, and re-asks when the version moves', async () => {
  let calls = 0;
  const asked = [];
  const storage = {zooExploredMatches: JSON.stringify({version: 'old', matches: {'vdict.com': {color: '#eadcff', label: 'x'}}})};
  const harness = createHarness((options) => {
    calls += 1;
    if (calls === 1) return options.onerror();
    const keys = JSON.parse(new URL(options.url).searchParams.get('keys'));
    asked.push(keys);
    options.onload({status: 200, responseText: JSON.stringify({version: 'v2', matches: keys.includes('vdict.com') ? {'vdict.com': {color: '#c8f7c5', label: 'y'}} : {}})});
  });
  harness.context.localStorage = {getItem: (k) => storage[k] || null, setItem: (k, v) => { storage[k] = v; }};
  const hit = googleResult('https://vdict.com/x');
  const doc = {body: null, querySelectorAll: () => [hit.anchor]};
  const started = harness.context.zooStartExploredHighlight(doc, {hostname: 'www.google.com', pathname: '/search'});
  assert.equal(hit.block.style.background, '#eadcff'); // cached answer, before any reply
  await started; // first attempt failed
  assert.equal(calls, 1);
  await new Promise((resolve) => setTimeout(resolve, 1700)); // first retry (1.5 s): version old -> v2 drops the answers
  assert.equal(calls >= 2, true);
  assert.deepEqual(asked[0], []);
  assert.deepEqual(asked[1], ['vdict.com']);
  assert.equal(hit.block.style.background, '#c8f7c5');
  assert.equal(JSON.parse(storage.zooExploredMatches).version, 'v2');
});

test('local transport can run with an injected request adapter and preserves error payloads', async () => {
  const transportPath = path.join(__dirname, '..', 'scripts/userscript/local-transport.js');
  const code = fs.readFileSync(transportPath, 'utf8');
  const context = vm.createContext({Promise, Error, JSON, Object, encodeURIComponent, setTimeout, clearTimeout});
  vm.runInContext(code, context);
  let details;
  const request = context.createZooLocalTransport({baseUrl: 'http://127.0.0.1:8770',
    getTimeout: () => 100, send: options => {details = options;}});
  const pending = request('POST', '/v1/test', {word: 'tình cảm'}, '{"x":1}');
  assert.equal(details.url, 'http://127.0.0.1:8770/v1/test?word=t%C3%ACnh%20c%E1%BA%A3m');
  assert.equal(details.data, '{"x":1}');
  details.onload({status: 409, responseText: '{"error":"confirm","confirm":true}'});
  await assert.rejects(pending, error => error.status === 409 && error.payload.confirm);
});

test('order preview uses the same case-sensitive row as the confirmed save', async () => {
  const requests = [];
  const harness = createHarness(options => requests.push(options));
  const ids = harness.context.ZOO_MODAL_IDS.order;
  Object.keys(ids).forEach(key => harness.add(ids[key]));
  harness.context.zooWireNomOrderForm();
  harness.elements.get(ids.vi).value = 'Đỗ';
  harness.elements.get(ids.nom).value = '杜';
  harness.elements.get(ids.caseSensitive).checked = true;
  harness.elements.get(ids.form).dispatch('submit');
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /(?:\?|&)preview=1(?:&|$)/);
  assert.match(requests[0].url, /(?:\?|&)caseSensitive=1(?:&|$)/);
  harness.context.zooRenderEntryDiff = () => 1;
  requests[0].onload({status: 200, responseText: '{"diff":{"changed":1,"rows":[]}}'});
  await new Promise(resolve => setImmediate(resolve));
  harness.elements.get(ids.confirmBtn).dispatch('click');
  assert.equal(requests.length, 2);
  assert.match(requests[1].url, /(?:\?|&)caseSensitive=1(?:&|$)/);
  assert.doesNotMatch(requests[1].url, /(?:\?|&)preview=/);
  requests[1].onerror();
});

test('local suggestions accept legacy and current response fixtures', async () => {
  const contract = require('./fixtures/local-mode-contract.json');
  for (const response of [contract.examples.suggestLegacy, contract.examples.suggestCurrent]) {
    let request;
    const harness = createHarness(options => {request = options;});
    const pending = harness.context.zooFetchSuggestions('nom', 'ba');
    request.onload({status: 200, responseText: JSON.stringify(response)});
    assert.deepEqual(Array.from(await pending), ['巴']);
  }
});

test('local form surfaces the reader validation-error fixture', async () => {
  const contract = require('./fixtures/local-mode-contract.json');
  let request;
  const harness = createHarness(options => {request = options;});
  const pending = harness.context.zooFetchNomForm('ba');
  request.onload({status: 422, responseText: JSON.stringify(contract.examples.validationError)});
  await assert.rejects(pending, error => error.status === 422 && error.message === 'vi is required');
});

test('local selection wrappers use injected page caret and selection', () => {
  const {context} = createHarness(() => {});
  const node = {nodeType: 3, parentElement: {closest: () => ({closest: () => true})}};
  const selected = [];
  context.zdCaretFromPoint = point => ({node, offset: point.x});
  context.document.createRange = () => ({collapsed: true, setStart(_node, offset) { this.start = offset; },
    setEnd(_node, offset) { this.collapsed = offset <= this.start; }});
  context.window = {getSelection: () => ({removeAllRanges() {}, addRange(range) { selected.push(range); }})};
  assert.ok(context.zooAnnotationInLinkAt(0, 0));
  context.zooSelectBetweenPoints({x: 0, y: 0}, {x: 2, y: 0});
  assert.equal(selected.length, 1);
});
