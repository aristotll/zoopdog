'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../scripts/userscript/overlay-labels.js'), 'utf8');

test('scroll relayout retains unchanged label text and ignores stale fallback timers', () => {
  const frames = [], timers = [], labels = [];
  let writes = 0;
  const doc = {
    createElement() {
      const el = {style: {}, isConnected: false, setAttribute() {}, appendChild(child) { labels.push(child); },
        attachShadow() { return {appendChild(child) { if (child.className === 'l') labels.push(child); }}; }};
      Object.defineProperty(el, 'textContent', {get() { return this._text; }, set(value) { this._text = value; if (this.className === 'l') writes++; }});
      return el;
    },
    documentElement: {appendChild(el) { el.isConnected = true; }},
    createRange() { return {setStart() {}, setEnd() {}, getClientRects() { return [{left: 10, width: 20, top: 30, bottom: 50}]; }}; }
  };
  const win = {innerWidth: 500, innerHeight: 500, requestAnimationFrame(fn) { frames.push(fn); },
    setTimeout(fn) { timers.push(fn); }, getComputedStyle() { return {fontSize: '16px', color: 'black'}; }};
  const create = vm.runInNewContext(source + '\nzdCreateOverlay');
  const overlay = create(doc, win);
  const parent = {getBoundingClientRect() { return {width: 100, height: 30, top: 20, bottom: 50, left: 0, right: 100}; }};
  const node = {isConnected: true, nodeValue: 'bạn', parentElement: parent};
  overlay.set(node, 'bạn', [{start: 0, end: 3, layers: [{pieces: [{text: '伴'}]}]}]);
  frames.shift()();
  assert.equal(writes, 1);
  overlay.schedule();
  timers.shift()(); // fallback for the already completed first frame
  assert.equal(writes, 1, 'an old timer must not run the new layout');
  frames.shift()();
  assert.equal(writes, 1, 'scrolling must not replace unchanged label text');
  assert.equal(labels[0].style.transform, 'translate(20px,29px) translate(-50%,-100%)');
});

test('document-anchored labels retain their document position during page scroll', () => {
  const frames = [], labels = [];
  let pageY = 0;
  const doc = {
    createElement() {
      return {style: {}, isConnected: false, setAttribute() {}, attachShadow() {
        return {appendChild(child) { if (child.className === 'l') labels.push(child); }};
      }};
    },
    documentElement: {appendChild(el) { el.isConnected = true; }},
    createRange() { return {setStart() {}, setEnd() {}, getClientRects() {
      return [{left: 10, width: 20, top: 130 - pageY, bottom: 150 - pageY}];
    }}; }
  };
  const win = {innerWidth: 500, innerHeight: 500, scrollX: 0, scrollY: 0,
    requestAnimationFrame(fn) { frames.push(fn); }, setTimeout() {},
    getComputedStyle() { return {fontSize: '16px', color: 'black'}; }};
  const create = vm.runInNewContext(source + '\nzdCreateOverlay');
  const overlay = create(doc, win, {documentAnchored: true});
  const parent = {getBoundingClientRect() { return {width: 100, height: 30, top: 120 - pageY, bottom: 150 - pageY, left: 0, right: 100}; }};
  const node = {isConnected: true, nodeValue: 'bạn', parentElement: parent};
  overlay.set(node, 'bạn', [{start: 0, end: 3, layers: [{pieces: [{text: '伴'}]}]}]);
  frames.shift()();
  const before = labels[0].style.transform;
  pageY = win.scrollY = 50;
  overlay.schedule();
  frames.shift()();
  assert.equal(labels[0].style.transform, before, 'the browser should scroll text and label together');
});

// Five text nodes: two crowded words that force a lifted label, one far below the viewport, one
// whose parent is `visibility:hidden`, and one near the bottom edge. Counts what a layout pass costs.
function layoutScenario() {
  const frames = [], labels = [], counts = {createRange: 0, getComputedStyle: 0, styleWrites: 0, textWrites: 0};
  const countingStyle = () => new Proxy({}, {set(target, key, value) { counts.styleWrites++; target[key] = value; return true; }});
  const doc = {
    createElement() {
      const el = {style: countingStyle(), isConnected: false, setAttribute() {}, appendChild(child) { labels.push(child); },
        attachShadow() { return {appendChild(child) { if (child.className === 'l') labels.push(child); }}; }};
      Object.defineProperty(el, 'textContent', {get() { return this._text; }, set(value) { this._text = value; if (this.className === 'l') counts.textWrites++; }});
      return el;
    },
    documentElement: {appendChild(el) { el.isConnected = true; }},
    createRange() {
      counts.createRange++;
      let node, from, to;
      return {setStart(n, offset) { node = n; from = offset; }, setEnd(n, offset) { to = offset; },
        getClientRects() { return [node.rects(from, to)]; }};
    }
  };
  const win = {innerWidth: 500, innerHeight: 500, requestAnimationFrame(fn) { frames.push(fn); }, setTimeout() {},
    getComputedStyle(parent) {
      counts.getComputedStyle++;
      return parent.cs || {fontSize: '16px', color: 'black', visibility: 'visible', display: 'block'};
    }};
  const overlay = vm.runInNewContext(source + '\nzdCreateOverlay')(doc, win, {});
  const makeNode = (top, text, cs) => ({
    isConnected: true, nodeValue: text,
    parentElement: {cs, getBoundingClientRect() { return {width: 200, height: 30, top, bottom: top + 30, left: 0, right: 200}; }},
    rects: (from, to) => ({left: 10 + from * 8, width: (to - from) * 8, top: top + 5, bottom: top + 25})
  });
  const record = (start, end, text, under) => ({start, end,
    layers: [{under: !!under, scale: 0.65, color: '#B6638F', weight: '600', pieces: [{text}]}]});
  const nodes = [
    makeNode(100, 'bạn của tình cảm'), makeNode(110, 'của bạn'), makeNode(2000, 'xa lắm'),
    makeNode(300, 'ẩn', {fontSize: '16px', color: 'red', visibility: 'hidden', display: 'block'}), makeNode(480, 'cuối')];
  overlay.set(nodes[0], nodes[0].nodeValue, [record(0, 3, '伴'), record(4, 7, '𧵑'), record(8, 16, '情感', true)]);
  overlay.set(nodes[1], nodes[1].nodeValue, [record(0, 3, '𧵑'), record(4, 7, '伴')]);
  overlay.set(nodes[2], nodes[2].nodeValue, [record(0, 2, '遠')]);
  overlay.set(nodes[3], nodes[3].nodeValue, [record(0, 2, '隱')]);
  overlay.set(nodes[4], nodes[4].nodeValue, [record(0, 4, '末')]);
  const snapshot = () => labels.filter((el) => el.className === 'l').map((el) => [el._text, el.style.transform, el.style.display]);
  const pass = () => { overlay.schedule(); frames.shift()(); const before = {...counts}; return before; };
  return {counts, snapshot, pass, labels, nodes};
}

test('a layout pass draws the same labels and measures only what is on screen', () => {
  const scenario = layoutScenario();
  const first = scenario.pass();
  const t = (x, y) => `translate(${x}px,${y}px) translate(-50%,-100%)`;
  assert.deepEqual(scenario.snapshot(), [
    ['伴', t(22, 104), ''], ['𧵑', t(54, 104), ''], ['情感', t(106, 137), ''],
    ['𧵑', t(22, 90), ''], ['伴', t(54, 90), ''], ['末', t(26, 484), '']]);
  assert.equal(first.createRange, 1, 'one Range serves the whole pass');
  assert.equal(first.getComputedStyle, 4, 'the parent 2000px down is never styled');
});

test('a second identical layout pass writes nothing and reuses its Range', () => {
  const scenario = layoutScenario();
  const first = scenario.pass();
  const labelsBefore = scenario.snapshot();
  const second = scenario.pass();
  assert.deepEqual(scenario.snapshot(), labelsBefore);
  assert.ok(first.styleWrites > 30);
  assert.equal(second.styleWrites, first.styleWrites, 'no style property is rewritten');
  assert.equal(second.textWrites, first.textWrites, 'no label text is rewritten');
  assert.equal(second.createRange - first.createRange, 1);
});

test('only what changed is written: a moved label its transform, an unused one display once', () => {
  const scenario = layoutScenario();
  scenario.pass();
  const base = scenario.counts.styleWrites;

  scenario.nodes[4].rects = (from, to) => ({left: 40 + from * 8, width: (to - from) * 8, top: 485, bottom: 505});
  scenario.pass();
  assert.equal(scenario.counts.styleWrites, base + 1, 'only the transform of the moved label');

  scenario.nodes[4].isConnected = false;
  scenario.pass();
  assert.equal(scenario.counts.styleWrites, base + 2, 'the label that lost its word is hidden');
  scenario.pass();
  assert.equal(scenario.counts.styleWrites, base + 2, 'and not hidden again');
  assert.equal(scenario.snapshot().filter(([, , display]) => display === 'none').length, 1);
});
