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

// Changed deliberately with the idle pre-warm: the hover itself still never parses the dictionary
// when it finds no word, but the first pointer activity now queues one idle parse (below), so
// "never" only holds until that idle callback runs.
test('a hover that finds no word does not parse the dictionary itself', () => {
  const dictionary = {'bạn': [[['bạn'], [['friend', '']]]]};
  const harness = createPopupHarness({dictionary});
  harness.state.caretMiss = true;
  harness.pointerMove(5, 5);
  assert.equal(harness.lastHover, 'noword');
  assert.ok(!harness.parsed.includes(JSON.stringify(dictionary)));
});

test('the first pointer activity queues one idle parse; nothing is parsed or queued at load', () => {
  const dictionary = {'bạn': [[['bạn'], [['friend', '']]]]};
  const text = JSON.stringify(dictionary);
  const parses = (harness) => harness.parsed.filter((parsed) => parsed === text).length;
  const harness = createPopupHarness({dictionary, idleCallbacks: true});
  assert.equal(harness.idle.length, 0, 'nothing is scheduled before any pointer activity');
  assert.equal(parses(harness), 0);

  harness.state.caretMiss = true;
  harness.pointerMove(5, 5);
  harness.pointerMove(6, 6);
  harness.dispatch('pointerdown', {type: 'pointerdown', pointerType: 'mouse', target: harness.paragraph});
  assert.equal(harness.idle.length, 1, 'one pre-warm however much activity follows');
  assert.equal(harness.idle[0].options.timeout, 2000);
  assert.equal(parses(harness), 0, 'queued, not run: the hover that found no word parsed nothing');

  assert.equal(harness.flushIdle(), 1);
  assert.equal(parses(harness), 1, 'the idle callback parses the dictionary once');
  harness.pointerMove(7, 7);
  assert.equal(harness.idle.length, 0, 'nothing is scheduled a second time');
  assert.equal(parses(harness), 1);
});

test('a lookup that runs before the idle pre-warm parses once and makes the pre-warm a no-op', () => {
  const dictionary = {'bạn': [[['bạn'], [['friend', '']]]]};
  const text = JSON.stringify(dictionary);
  const harness = createPopupHarness({dictionary, idleCallbacks: true});
  harness.pointerMove(5, 5);
  assert.equal(harness.lastHover, 'shown');
  assert.equal(harness.parsed.filter((parsed) => parsed === text).length, 1, 'the hover parsed it');
  assert.equal(harness.idle.length, 1);
  harness.flushIdle();
  assert.equal(harness.parsed.filter((parsed) => parsed === text).length, 1, 'the pre-warm did not parse again');
});

test('without requestIdleCallback the pre-warm is one 200 ms timeout', () => {
  const dictionary = {'bạn': [[['bạn'], [['friend', '']]]]};
  const text = JSON.stringify(dictionary);
  const harness = createPopupHarness({dictionary});
  const prewarms = () => harness.timeouts.filter((entry) => entry.ms === 200).length;
  assert.equal(prewarms(), 0, 'nothing at load');
  harness.state.caretMiss = true;
  harness.pointerMove(5, 5);
  harness.pointerMove(6, 6);
  assert.equal(prewarms(), 1);
  assert.ok(!harness.parsed.includes(text));
  assert.equal(harness.flushTimeouts(200), 1);
  assert.equal(harness.parsed.filter((parsed) => parsed === text).length, 1);
});

test('a frame that sees no pointer activity never schedules or parses, whatever else happens', () => {
  const dictionary = {'bạn': [[['bạn'], [['friend', '']]]]};
  const harness = createPopupHarness({dictionary, idleCallbacks: true});
  harness.dispatch('keydown', {type: 'keydown', which: 16, key: 'Shift', repeat: false});
  harness.dispatch('scroll', {type: 'scroll', target: harness.paragraph});
  harness.resize(700, 500);
  assert.equal(harness.idle.length, 0);
  assert.equal(harness.timeouts.filter((entry) => entry.ms === 200).length, 0);
  assert.ok(!harness.parsed.includes(JSON.stringify(dictionary)));
});

test('the mousemove / touchstart fallback listeners also queue the pre-warm, once', () => {
  const moved = createPopupHarness({idleCallbacks: true, pointerEvents: false});
  moved.pointerMove(5, 5);
  moved.pointerMove(6, 6);
  assert.equal(moved.idle.length, 1);

  const touched = createPopupHarness({idleCallbacks: true, pointerEvents: false});
  touched.dispatch('touchstart', {type: 'touchstart'});
  touched.dispatch('touchstart', {type: 'touchstart'});
  assert.equal(touched.idle.length, 1);
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

test('pointermove events are coalesced into one lookup per animation frame', () => {
  const harness = createPopupHarness({animationFrames: true});
  for (let i = 0; i < 50; i++) harness.pointerMove(5 + i, 5);
  assert.equal(harness.calls.caret, 0, 'nothing is looked up until the frame runs');
  assert.equal(harness.flushFrames(), 1, 'one frame callback however many moves arrived');
  assert.equal(harness.calls.caret, 1);
  assert.equal(harness.lastHover, 'shown');

  harness.pointerMove(9, 9);
  harness.pointerMove(10, 10);
  assert.equal(harness.flushFrames(), 1);
  assert.equal(harness.calls.caret, 2, 'the next frame looks up once more');
});

test('the coalesced lookup uses the latest point and a copy of the event fields', () => {
  const harness = createPopupHarness({animationFrames: true, dictionary: {}});
  harness.state.caretMiss = true;
  const points = [];
  const original = harness.context.document.caretRangeFromPoint;
  harness.context.document.caretRangeFromPoint = (x, y) => { points.push([x, y]); return original(x, y); };
  const first = harness.pointerMove(1, 1);
  harness.pointerMove(2, 2);
  first.clientX = 99; // a mutated, reused event object must not leak into the later lookup
  harness.flushFrames();
  assert.deepEqual(points, [[2, 2]]);
});

test('a click cancels a pending hover instead of replaying it afterwards', () => {
  const harness = createPopupHarness({animationFrames: true});
  harness.pointerMove(5, 5);
  harness.dispatch('pointerup', {type: 'pointerup', pointerType: 'mouse', clientX: 5, clientY: 5, target: harness.paragraph});
  const afterClick = harness.calls.caret;
  assert.equal(afterClick, 1, 'pointerup is handled synchronously');
  harness.flushFrames();
  assert.equal(harness.calls.caret, afterClick, 'the stale pending move is dropped');
});

test('without requestAnimationFrame the move is looked up synchronously', () => {
  const harness = createPopupHarness();
  harness.pointerMove(5, 5);
  harness.pointerMove(6, 6);
  assert.equal(harness.calls.caret, 2);
});

test('the mousemove fallback is coalesced the same way', () => {
  const harness = createPopupHarness({animationFrames: true, pointerEvents: false});
  for (let i = 0; i < 20; i++) harness.pointerMove(5 + i, 5);
  assert.equal(harness.calls.caret, 0);
  harness.flushFrames();
  assert.equal(harness.calls.caret, 1);
});

test('the website mousemove handler coalesces moves per animation frame', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'popupdict.js'), 'utf8');
  const handler = source.slice(source.indexOf("textField.addEventListener('mousemove'"), source.indexOf('async function hoverAtPoint'));
  // The listener itself does no lookup work: it only records the latest point and requests a
  // frame, falling back to an immediate lookup when requestAnimationFrame is unavailable.
  assert.match(handler, /requestAnimationFrame/);
  assert.match(handler, /if \(pendingFrame\) return/);
  assert.match(handler, /typeof window\.requestAnimationFrame !== 'function'/);
  assert.doesNotMatch(handler, /getWordAndContext|elementFromPoint/);
});

test('a Shift press before any hover does not build the popup UI', () => {
  const harness = createPopupHarness();
  const ids = () => harness.paragraph.parentNode.children.map((child) => child.id).filter(Boolean);
  harness.dispatch('keydown', {type: 'keydown', which: 16, key: 'Shift', repeat: false});
  assert.deepEqual(ids(), [], 'typing a capital letter must not create the canvas and popup');
});
