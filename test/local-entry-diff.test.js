'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

test('injected diff renderer draws untrusted text, empty segments, and scroll position', () => {
  function element(tag) {
    return {tag, children: [], className: '', hidden: false, scrollTop: 42, offsetTop: 40,
      appendChild(child) { this.children.push(child); }, setAttribute() {},
      set textContent(value) { this.text = value; this.children = []; },
      get textContent() { return this.text; }, get childElementCount() { return this.children.length; }};
  }
  const doc = {createElement: element, createTextNode: text => ({textContent: text})};
  const source = fs.readFileSync(path.join(__dirname, '../scripts/userscript/local-entry-diff.js'), 'utf8');
  const context = vm.createContext({});
  vm.runInContext(source, context);
  const render = context.createZooEntryDiffRenderer(doc);
  const list = element('ul'), modal = {scrollTop: 0};
  list.closest = () => modal;
  assert.equal(render(list, {changed: 1, rows: [
    {kind: 'key', field: 'VI', value: '<img>'},
    {kind: 'change', field: 'Nôm', old: [{changed: true, text: '<b>x</b>'}], new: []}
  ]}), 1);
  assert.equal(list.children[0].children[1].children[1].textContent, '<img>');
  assert.equal(list.children[1].children[1].children[1].children[0].textContent, '<b>x</b>');
  assert.equal(list.children[1].children[2].children[1].children[0].textContent, '(empty)');
  assert.equal(modal.scrollTop, 28);
  assert.equal(render(list, {changed: 0, rows: []}), 0);
  assert.equal(list.hidden, true);
  assert.equal(list.scrollTop, 0);
});

test('builder includes the renderer before the local runtime and excludes it from the public build', () => {
  const {readRuntimeSources} = require('../scripts/build-popupdict-userscript');
  const local = readRuntimeSources(true), publicSource = readRuntimeSources(false);
  const moduleIndex = local.indexOf('function createZooEntryDiffRenderer(');
  const useIndex = local.indexOf('var zooRenderEntryDiff = createZooEntryDiffRenderer(document)');
  assert.ok(moduleIndex >= 0 && useIndex > moduleIndex);
  assert.equal(publicSource.includes('function createZooEntryDiffRenderer('), false);
});
