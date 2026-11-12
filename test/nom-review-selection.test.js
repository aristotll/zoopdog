'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require('node:path').join(__dirname, '../scripts/userscript/popupdict.runtime.js'), 'utf8');
function harness() {
  const elements = [];
  function element() {
    const e = {style: {display: 'none'}, children: [], listeners: {}, attributes: {},
      addEventListener(n, f) { this.listeners[n] = f; },
      appendChild(c) { this.children.push(c); },
      setAttribute(n, v) { this.attributes[n] = v; },
      getBoundingClientRect() { return {width: 240, height: 64}; }};
    Object.defineProperty(e, 'textContent', {set(v) { this.text = v; this.children = []; }, get() { return this.text; }});
    elements.push(e); return e;
  }
  let cleared = 0;
  const context = {document: {createElement: element, body: element()},
    window: {innerWidth: 320, innerHeight: 480, getSelection() { return {removeAllRanges() { cleared++; }}; }, setTimeout() {}},
    Date, NodeFilter: {SHOW_ALL: 0xffffffff}, ZOO_NOM_REVIEW_CONTEXT_MAX: 500,
    zooIsNomReviewQueued() { return false; }, zooQueueNomReview() {}};
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('  var ZOO_NOM_REVIEW_SELECTION_MAX_CHARS'), source.indexOf('  function zooHandleNomReviewSelectionChange()')), context);
  return {context, elements, cleared: () => cleared};
}
const click = {preventDefault() {}, stopPropagation() {}};
test('review controls stay stable, collapse, expand, and explicitly clear selection on close', () => {
  const h = harness(), c = h.context;
  c.zooShowNomReviewSelectionBar({left: 300, top: 470, bottom: 490}, 'không ghét', null);
  const bar = c.zooNomReviewSelectionBarEl;
  const save = bar.children[0];
  c.zooShowNomReviewSelectionBar({left: 300, top: 470, bottom: 490}, 'không ghét', null);
  assert.equal(bar.children[0], save);
  assert.ok(parseFloat(bar.style.left) <= 72);
  assert.ok(parseFloat(bar.style.top) <= 408);
  bar.children[1].listeners.click(click);
  assert.equal(bar.attributes['data-collapsed'], 'true');
  bar.children[1].listeners.click(click);
  assert.equal(bar.attributes['data-collapsed'], 'false');
  bar.children[2].listeners.click(click);
  assert.equal(bar.style.display, 'none');
  assert.equal(h.cleared(), 1);
  assert.equal(c.zooNomReviewDismissedText, 'không ghét');
});
test('large same-node selection is rejected without reading its text', () => {
  const {context: c} = harness();
  const node = {nodeType: 3, get data() { throw Error('must not materialize'); }};
  assert.equal(c.zooNomReviewSelectionTooLong({startContainer: node, endContainer: node, startOffset: 0, endOffset: 1000000}, 120), true);
});
test('selection traversal bounds element nodes as well as text nodes', () => {
  const {context: c} = harness();
  const node = {nodeType: 1, childNodes: []};
  let visits = 0;
  c.document.createTreeWalker = () => ({nextNode() { visits++; return {nodeType: 1}; }});
  assert.equal(c.zooNomReviewSelectionTooLong({startContainer: node, endContainer: {}, commonAncestorContainer: node, startOffset: 0, intersectsNode() { return true; }}, 120), true);
  assert.ok(visits <= 200);
});
