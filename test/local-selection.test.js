'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('selection helper normalizes punctuation, format marks and decomposed Vietnamese', () => {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(require.resolve('../scripts/userscript/local-selection.js'), 'utf8'), context);
  const tools = context.createZooSelectionTools({document: {}, scanLimit: 10});
  assert.equal(tools.trim('  “ti\u0300nh\u200b bạn!”  '), 'tình bạn');
});

test('selection helper bounds traversal of open shadow roots', () => {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(require.resolve('../scripts/userscript/local-selection.js'), 'utf8'), context);
  const tools = context.createZooSelectionTools({document: {}, scanLimit: 2});
  const root = {nodeType: 1, children: [{nodeType: 1, children: [], shadowRoot: {children: []}}]};
  assert.equal(tools.collectRoots(root).length, 1);
  assert.equal(tools.composed({}, root), null);
});

test('link annotation lookup follows the caret and requires an enclosing link', () => {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(require.resolve('../scripts/userscript/local-selection.js'), 'utf8'), context);
  const link = {}, ruby = {closest: selector => selector === 'a[href]' ? link : null};
  const element = {closest: selector => selector === 'ruby.zoopdog-nom-ruby' ? ruby : null};
  const tools = context.createZooSelectionTools({document: {}, scanLimit: 10, caretFromPoint: () => ({node: {nodeType: 3, parentElement: element}})});
  assert.equal(tools.annotationInLinkAt(2, 3), ruby);
  ruby.closest = () => null;
  assert.equal(tools.annotationInLinkAt(2, 3), null);
});

test('selection helper handles reverse drags and equal-offset word selection', () => {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(require.resolve('../scripts/userscript/local-selection.js'), 'utf8'), context);
  const selected = [];
  const node = {};
  const document = {createRange() {
    return {collapsed: true, setStart(_node, offset) { this.start = offset; },
      setEnd(_node, offset) { this.collapsed = offset <= this.start; },
      selectNodeContents(value) { this.node = value; this.collapsed = false; }};
  }};
  const tools = context.createZooSelectionTools({document, scanLimit: 10,
    caretFromPoint: point => ({node, offset: point.x}),
    getSelection: () => ({removeAllRanges() {}, addRange(range) { selected.push(range); }})});
  tools.selectBetweenPoints({x: 2, y: 0}, {x: 0, y: 0});
  assert.equal(selected.length, 1);
  assert.equal(selected[0].start, 0);
  tools.selectBetweenPoints({x: 1, y: 0}, {x: 1, y: 0});
  assert.equal(selected[1].node, node);
});
