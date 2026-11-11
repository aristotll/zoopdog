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
