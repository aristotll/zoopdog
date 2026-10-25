'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const runtimePath = path.join(__dirname, '..', 'scripts', 'userscript', 'popupdict-local.runtime.js');
const runtime = fs.readFileSync(runtimePath, 'utf8');

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
  vm.runInContext(runtime, context, {filename: runtimePath});
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

test('zooExploredDomain collapses subdomains and keeps country second levels', () => {
  const {context} = createHarness(() => {});
  assert.equal(context.zooExploredDomain('dtinews.dantri.com.vn'), 'dantri.com.vn');
  assert.equal(context.zooExploredDomain('www.bing.com'), 'bing.com');
  assert.equal(context.zooExploredDomain('127.0.0.1'), '');
});

test('zooPaintExplored colours explored domains (direct and /url?q= links) and clears stale ones', () => {
  const {context} = createHarness(() => {});
  const hit = googleResult('https://dtinews.dantri.com.vn/a.htm');
  const wrapped = googleResult('https://www.google.com/url?q=https%3A%2F%2Fvdict.com%2Fx&sa=U');
  const miss = googleResult('https://example.org/');
  const doc = {querySelectorAll: () => [hit.anchor, wrapped.anchor, miss.anchor]};
  const domains = {'dantri.com.vn': {color: '#c8f7c5', label: 'Explored: dict dantri'}, 'vdict.com': {color: '#eadcff', label: 'Explored: research vdict'}};
  assert.equal(context.zooPaintExplored(doc, domains), 2);
  assert.equal(hit.block.style.background, '#c8f7c5');
  assert.equal(hit.block.title, 'Explored: dict dantri');
  assert.equal(wrapped.block.style.background, '#eadcff');
  assert.equal(miss.block.style.background, undefined);
  context.zooPaintExplored(doc, {});
  assert.equal(hit.block.style.background, '');
});

test('explored highlight starts only on a Google search page and asks only for changes after the first load', async () => {
  const urls = [];
  const harness = createHarness((options) => {
    urls.push(options.url);
    options.onload({status: 200, responseText: JSON.stringify({version: 'v1', domains: {}})});
  });
  const doc = {body: null, querySelectorAll: () => []};
  assert.equal(await harness.context.zooStartExploredHighlight(doc, {hostname: 'example.org', pathname: '/search'}), false);
  assert.equal(urls.length, 0);
  assert.equal(await harness.context.zooStartExploredHighlight(doc, {hostname: 'www.google.com', pathname: '/search'}), true);
  assert.match(urls[0], /\/v1\/explored-sites$/);
});

test('explored highlight retries a failed first request quickly and paints from the cached copy at once', async () => {
  let calls = 0;
  const storage = {zooExploredSites: JSON.stringify({version: 'old', domains: {'vdict.com': {color: '#eadcff', label: 'x'}}})};
  const harness = createHarness((options) => {
    calls += 1;
    if (calls === 1) return options.onerror();
    options.onload({status: 200, responseText: JSON.stringify({version: 'v2', domains: {'vdict.com': {color: '#c8f7c5', label: 'y'}}})});
  });
  harness.context.localStorage = {getItem: (k) => storage[k] || null, setItem: (k, v) => { storage[k] = v; }};
  const hit = googleResult('https://vdict.com/x');
  const doc = {body: null, querySelectorAll: () => [hit.anchor]};
  const started = harness.context.zooStartExploredHighlight(doc, {hostname: 'www.google.com', pathname: '/search'});
  assert.equal(hit.block.style.background, '#eadcff'); // cached copy, before any answer
  await started; // first attempt failed
  assert.equal(calls, 1);
  await new Promise((resolve) => setTimeout(resolve, 1700)); // first retry (1.5 s)
  assert.equal(calls, 2);
  assert.equal(hit.block.style.background, '#c8f7c5');
  assert.equal(JSON.parse(storage.zooExploredSites).version, 'v2');
});

test('AI overview /goto links are matched by their site name (aria-label or short text)', () => {
  const {context} = createHarness(() => {});
  const chip = googleResult('https://www.google.com/goto?url=CAESopaque');
  chip.anchor.getAttribute = (name) => (name === 'aria-label' ? 'Tuổi Trẻ' : null);
  chip.anchor.querySelector = () => null; // no heading: not an organic result
  chip.anchor.textContent = '';
  chip.anchor.closest = () => null;
  chip.anchor.style = {};
  chip.anchor.dataset = {};
  chip.anchor.title = '';
  const text = googleResult('https://www.google.com/goto?url=CAESother');
  text.anchor.getAttribute = () => null;
  text.anchor.querySelector = () => null;
  text.anchor.textContent = 'Laodong.vn';
  Object.assign(text.anchor, {style: {}, dataset: {}, title: ''});
  const stranger = googleResult('https://www.google.com/goto?url=CAESx');
  stranger.anchor.getAttribute = () => 'Đăng nhập';
  stranger.anchor.querySelector = () => null;
  Object.assign(stranger.anchor, {textContent: 'Đăng nhập', style: {}, dataset: {}, title: ''});
  const domains = {'tuoitre.vn': {color: '#c8f7c5', label: 'Explored: dict tuoitre'}, 'laodong.vn': {color: '#ffe9a8', label: 'Explored: tts laodong'}};
  const names = {tuoitre: 'tuoitre.vn', laodongvn: 'laodong.vn'};
  assert.equal(context.zooExploredKey('Tuổi Trẻ'), 'tuoitre');
  const doc = {querySelectorAll: () => [chip.anchor, text.anchor, stranger.anchor]};
  assert.equal(context.zooPaintExplored(doc, domains, names), 2);
  assert.equal(chip.anchor.style.background, '#c8f7c5');
  assert.equal(chip.anchor.style.boxShadow, '0 0 0 3px #c8f7c5');
  assert.equal(text.anchor.title, 'Explored: tts laodong');
  assert.equal(stranger.anchor.style.background, undefined);
});

