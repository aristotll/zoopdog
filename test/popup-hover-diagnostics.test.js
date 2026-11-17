'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {createPopupHarness} = require('./support/popup-harness');

test('a hover miss records only the short outcome code unless zoopdogDebug is on', () => {
  const quiet = createPopupHarness({dictionary: {}});
  quiet.pointerMove(5, 5);
  assert.equal(quiet.lastHover, 'nolookup');
  // One caret lookup for the hover itself; the diagnostic must not add a second one.
  quiet.state.caretMiss = true;
  const before = quiet.calls.caret;
  quiet.pointerMove(6, 6);
  assert.equal(quiet.lastHover, 'noword');
  assert.equal(quiet.calls.caret - before, 1);
});

test('zoopdogDebug=1 restores the detailed data-last-hover strings', () => {
  const loud = createPopupHarness({dictionary: {}, debug: true});
  loud.pointerMove(5, 5);
  assert.match(loud.lastHover, /^nolookup word="bạn" ctx="bạn bè" keys=0$/);
  loud.state.caretMiss = true;
  const before = loud.calls.caret;
  loud.pointerMove(6, 6);
  assert.match(loud.lastHover, /^noword origin=false caret=null pt=6,6 hasCPFP=false$/);
  assert.equal(loud.calls.caret - before, 2);
});

test('the dictionary stays unparsed until the first lookup, then is parsed exactly once', () => {
  const dictionary = {'bạn': [[['bạn'], [['friend', '']]]], 'bè': [[['bè'], [['pal', '']]]]};
  const text = JSON.stringify(dictionary);
  const harness = createPopupHarness({dictionary});
  assert.ok(!harness.parsed.includes(text), 'loading the userscript must not parse the dictionary');

  harness.pointerMove(5, 5);
  assert.equal(harness.lastHover, 'shown');
  assert.equal(harness.parsed.filter((parsed) => parsed === text).length, 1);

  harness.pointerMove(6, 6); // same word: no lookup at all
  harness.state.caretMiss = true;
  harness.pointerMove(7, 7);
  assert.equal(harness.parsed.filter((parsed) => parsed === text).length, 1);
});

test('a hover that finds no word never parses the dictionary', () => {
  const dictionary = {'bạn': [[['bạn'], [['friend', '']]]]};
  const harness = createPopupHarness({dictionary});
  harness.state.caretMiss = true;
  harness.pointerMove(5, 5);
  assert.equal(harness.lastHover, 'noword');
  assert.ok(!harness.parsed.includes(JSON.stringify(dictionary)));
});

test('the canvas and popup are created on the first hover, not at load, and only once', () => {
  const harness = createPopupHarness();
  const ids = () => harness.paragraph.parentNode.children.map((child) => child.id).filter(Boolean);
  assert.deepEqual(ids(), []);

  harness.pointerMove(5, 5);
  assert.deepEqual(ids(), ['zoopdog-userscript-canvas', 'zoopdog-userscript-popup']);
  assert.equal(harness.lastHover, 'shown');

  harness.pointerMove(6, 6);
  assert.deepEqual(ids(), ['zoopdog-userscript-canvas', 'zoopdog-userscript-popup']);
});
