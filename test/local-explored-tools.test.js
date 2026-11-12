'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../scripts/userscript/local-explored-tools.js'), 'utf8');

function node() {
  const listeners = {};
  return {
    style: {}, hidden: false, children: [], className: '', title: '', textContent: '',
    appendChild(child) { this.children.push(child); },
    addEventListener(type, fn) { (listeners[type] || (listeners[type] = [])).push(fn); },
    fire(type, event) { (listeners[type] || []).forEach((fn) => fn(event || {})); }
  };
}

function setup(overrides) {
  const doc = Object.assign(node(), {
    body: node(), defaultView: {innerWidth: 1000},
    createElement: node
  });
  const calls = [];
  const deps = Object.assign({
    doc,
    eligible: () => true,
    refresh: (anchor) => calls.push(['refresh', anchor.name]),
    blacklist: (anchor) => calls.push(['blacklist', anchor.name])
  }, overrides);
  const context = vm.createContext({setTimeout, clearTimeout});
  vm.runInContext(source, context);
  context.ZOO_EXPLORED_TOOLS_HIDE_MS = 5;
  const tools = context.zooExploredToolsCreate(deps);
  tools.attach();
  const link = (name, rect) => ({name, getBoundingClientRect: () => rect || {top: 40, right: 900, left: 100}});
  const over = (anchor) => doc.fire('mouseover', {target: {closest: () => anchor}});
  return {doc, calls, tools, link, over, pill: () => doc.body.children[0]};
}

test('hovering an eligible link shows one pill at its top-right corner, with refresh and blacklist', () => {
  const t = setup();
  assert.equal(t.pill(), undefined, 'nothing is built before the first hover');
  t.over(t.link('a'));
  const pill = t.pill();
  assert.equal(pill.hidden, false);
  assert.equal(pill.style.top, '40px');
  assert.equal(pill.style.left, '836px');
  assert.deepEqual(pill.children.map((b) => b.textContent), ['↻', '⛔']);
  t.over(t.link('b', {top: 300, right: 5000, left: 0}));
  assert.equal(t.doc.body.children.length, 1, 'the same pill is reused');
  assert.equal(pill.style.left, '936px', 'kept inside the viewport');
});

test('the buttons route to the injected handlers for the hovered link, and do not follow the link', () => {
  const t = setup();
  const anchor = t.link('a');
  t.over(anchor);
  let prevented = 0, stopped = 0;
  const click = {preventDefault() { prevented++; }, stopPropagation() { stopped++; }};
  t.pill().children[0].fire('click', click);
  t.pill().children[1].fire('click', click);
  assert.deepEqual(t.calls, [['refresh', 'a'], ['blacklist', 'a']]);
  assert.equal(prevented, 2);
  assert.equal(stopped, 2);
});

test('an ineligible (already coloured) link shows no pill and a hovered-away pill hides after a delay', async () => {
  let eligible = false;
  const t = setup({eligible: () => eligible});
  t.over(t.link('coloured'));
  assert.equal(t.pill(), undefined);
  eligible = true;
  t.over(t.link('plain'));
  assert.equal(t.pill().hidden, false);
  t.doc.fire('mouseover', {target: {closest: () => null}});     // pointer left every link
  assert.equal(t.pill().hidden, false);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(t.pill().hidden, true);
  t.over(t.link('plain'));
  t.pill().fire('mouseenter');                                    // pointer moved onto the pill: stays
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(t.pill().hidden, false);
  t.doc.fire('scroll');
  assert.equal(t.pill().hidden, true);
});

test('decorate puts refresh and blacklist after a result title, once, and routes them to that result', () => {
  const t = setup();
  const heading = Object.assign(node(), {querySelector(selector) { return this.children.find((c) => selector.endsWith(c.className)) || null; }});
  const anchor = {name: 'result', querySelector: () => heading};
  assert.equal(t.tools.decorate(anchor), true);
  assert.equal(t.tools.decorate(anchor), false, 'idempotent: repaints do not stack buttons');
  const box = heading.children[0];
  assert.equal(box.className, 'zd-explored-inline');
  assert.deepEqual(box.children.map((b) => b.textContent), ['↻', '⛔']);
  const click = {preventDefault() {}, stopPropagation() {}};
  box.children[0].fire('click', click);
  box.children[1].fire('click', click);
  assert.deepEqual(t.calls, [['refresh', 'result'], ['blacklist', 'result']]);
  assert.equal(t.tools.decorate({querySelector: () => null}), false, 'a headingless link gets none (the hover pill covers it)');
});
