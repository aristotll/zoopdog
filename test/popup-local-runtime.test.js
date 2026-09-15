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
    addEventListener() {},
    querySelectorAll() { return []; }
  };
  const context = vm.createContext({
    Promise, JSON, Error, Object, String, Array, Math, Date, isFinite,
    clearTimeout, setTimeout, document,
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

test('an older candidate response cannot overwrite a newer term', async () => {
  const requests = [];
  const harness = createHarness((options) => requests.push(options));
  const ids = harness.context.ZOO_MODAL_IDS.nom;
  Object.keys(ids).forEach((key) => harness.add(ids[key]));
  harness.context.zooWireNomForm();
  harness.context.zooNomFormState.refresh('cũ');
  harness.context.zooNomFormState.refresh('mới');
  const respond = (text, candidates) => requests
    .filter((request) => request.url.includes('kind=nom') && request.url.includes('text=' + encodeURIComponent(text)))
    .forEach((request) => request.onload({status: 200, responseText: JSON.stringify({candidates})}));
  requests.filter((request) => request.url.includes('/v1/nom/entry') && request.url.includes('vi=m%E1%BB%9Bi'))
    .forEach((request) => request.onload({status: 200, responseText: '{"exists":false}'}));
  respond('mới', ['新']);
  await new Promise((resolve) => setImmediate(resolve));
  respond('cũ', ['舊']);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.elements.get(ids.nom).value, '新');
  assert.equal(harness.elements.get(ids.suggestions).children[0].value, '新');
  requests.forEach((request) => request.onload({
    status: 200,
    responseText: request.url.includes('/v1/suggest') ? '{"candidates":[]}' : '{"exists":false}'
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
