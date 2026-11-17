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
