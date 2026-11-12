'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const core = require('../zd-extension/js/zd-pron-core').createPronunciationCore(
  require('../zd-extension/js/zd-pron-data'), require('../zd-extension/js/realwords').allPossibleRealWords);

test('website adapters handle whitespace and recover for valid input', () => {
  const input = {value: '', addEventListener() {}};
  const elements = Object.fromEntries(['hanoi', 'quangnam', 'saigon'].map(d => [d, {
    innerHTML: '', children: [], get firstChild() { return this.children[0]; },
    removeChild() { this.children.shift(); }, appendChild(child) { this.children.push(child); }
  }]));
  const document = {
    getElementsByClassName(name) { return name === 'pron' ? Object.values(elements) : []; },
    getElementById() { return input; },
    querySelector(selector) { return elements[selector.match(/dialect=(\w+)/)[1]]; },
    createElement() { return {innerHTML: '', classList: {add() {}}}; }
  };
  const context = vm.createContext({document, window: {}, dialects: ['hanoi', 'quangnam', 'saigon'],
    pronunciationGuide: core.pronunciationGuide, getMultiWordHomophones: core.getMultiWordHomophones,
    drawTonesAndGradients() {}, zdBrowserRuntime: {runWhenReady() {}}});
  vm.runInContext(fs.readFileSync(require.resolve('../js/zd-pron.js'), 'utf8'), context);
  for (const value of ['', '   ', '\t\n', '!!!', '0', '😀']) {
    input.value = value;
    assert.doesNotThrow(() => vm.runInContext('pronounceMe(); homophoneMe()', context));
  }
  input.value = 'ba';
  assert.doesNotThrow(() => vm.runInContext('pronounceMe(); homophoneMe()', context));
  assert.ok(elements.hanoi.children.length > 0);
});
