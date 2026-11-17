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

test('typing is debounced to one render per 100 ms pause', () => {
  let inputListener;
  const input = {value: 'ba', addEventListener(type, listener) { if (type === 'input') inputListener = listener; }};
  const timers = [];
  let renders = 0;
  const element = {
    innerHTML: '', children: [], get firstChild() { return this.children[0]; },
    removeChild() { this.children.shift(); }, appendChild(child) { this.children.push(child); }
  };
  const document = {
    getElementsByClassName(name) { return name === 'pron' ? [element] : []; },
    getElementById() { return input; },
    querySelector() { return element; },
    createElement() { return {innerHTML: '', classList: {add() {}}}; }
  };
  const context = vm.createContext({document, window: {}, dialects: ['hanoi'],
    pronunciationGuide(...args) { renders += 1; return core.pronunciationGuide(...args); },
    getMultiWordHomophones: core.getMultiWordHomophones,
    drawTonesAndGradients() {}, zdBrowserRuntime: {runWhenReady() {}},
    setTimeout(fn, ms) { timers.push({fn, ms, live: true}); return timers.length - 1; },
    clearTimeout(id) { if (timers[id]) timers[id].live = false; }});
  vm.runInContext(fs.readFileSync(require.resolve('../js/zd-pron.js'), 'utf8'), context);

  for (let i = 0; i < 5; i++) inputListener();
  assert.equal(renders, 0, 'no render while keystrokes keep arriving');
  const live = timers.filter((timer) => timer.live);
  assert.equal(live.length, 1);
  assert.equal(live[0].ms, 100);
  live[0].fn();
  assert.ok(renders > 0, 'the last keystroke renders once the pause elapses');
});
