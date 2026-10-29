'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function fakeDocument() {
  function node(tag, text) {
    return {
      tag, text, children: [], attributes: {},
      appendChild(child) { this.children.push(child); return child; },
      setAttribute(name, value) { this.attributes[name] = value; }
    };
  }
  return {
    createDocumentFragment() { return node('#fragment'); },
    createElement(tag) { return node(tag); },
    createTextNode(text) { return node('#text', text); }
  };
}

function parser() {
  const source = fs.readFileSync(path.join(__dirname, '../scripts/userscript/safe-html.js'), 'utf8');
  const context = vm.createContext({});
  vm.runInContext(source, context);
  return context.zooBuildSafeFragment;
}

test('builds the popup and local controls without an HTML sink and decodes text once', () => {
  const build = parser();
  const fragment = build(fakeDocument(), '<div class="zd-definition"><h1>&lt;img src=&quot;x&quot;&gt; &amp;lt;</h1><ul><li><span class="zoopdog-pos">n</span> dog</li></ul><button data-zd-vi="a&#39;b" disabled>Mark</button><input type="text" required></div>');
  const div = fragment.children[0];
  assert.equal(div.children[0].children[0].text, '<img src="x"> &lt;');
  assert.equal(div.children[2].attributes['data-zd-vi'], "a'b");
  assert.equal(div.children[2].attributes.disabled, '');
  assert.equal(div.children[3].attributes.required, '');
});

test('rejects unsafe or malformed markup before it reaches the page', () => {
  const build = parser(), doc = fakeDocument();
  for (const html of ['<img src="x">', '<div onclick="alert(1)"></div>', '<button data-zd-vi="x" onmouseover="x"></button>', '<div><span></div>', '<div title="unterminated></div>', '<div>&bogus;</div>']) {
    assert.throws(() => build(doc, html), /Unsupported|Malformed/);
  }
});

test('the denied-policy fallback replaces content without an HTML sink', () => {
  const source = fs.readFileSync(path.join(__dirname, '../scripts/userscript/popupdict.runtime.js'), 'utf8');
  const helper = source.slice(source.indexOf('  var zooTrustedTypesPolicy;'), source.indexOf('  function normalizeLookup'));
  const doc = fakeDocument();
  const context = vm.createContext({window: {trustedTypes: {createPolicy() { throw new TypeError('policy denied'); }}}, document: doc, zooBuildSafeFragment: parser()});
  vm.runInContext(helper, context);
  const target = {ownerDocument: doc, firstChild: null, appendChild(fragment) { this.result = fragment; }, set innerHTML(value) { throw new TypeError('TrustedHTML required'); }};
  context.zooSetHTML(target, '<h1>&lt;safe&gt;</h1>');
  assert.equal(target.result.children[0].children[0].text, '<safe>');
});

test('the real local modal templates use only supported markup', () => {
  const source = fs.readFileSync(path.join(__dirname, '../scripts/userscript/popupdict-local.runtime.js'), 'utf8');
  const start = source.indexOf('    var nomIds = ZOO_MODAL_IDS.nom;', source.indexOf('  function zooBuildModals()'));
  const end = source.indexOf('    var container = document.createElement', start);
  assert.ok(start >= 0 && end > start);
  const ids = new Proxy({}, {get: (_, key) => String(key)});
  const context = vm.createContext({ZOO_MODAL_IDS: {nom: ids, order: ids}});
  vm.runInContext(source.slice(start, end), context);
  const fragment = parser()(fakeDocument(), context.nomHtml + context.orderHtml + context.toastHtml);
  assert.equal(fragment.children.length, 3);
});
