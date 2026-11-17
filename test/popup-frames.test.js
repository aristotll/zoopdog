'use strict';

// Frames too small to ever show a popup (tracking pixels, ad slots) wire nothing but the Shift
// relay, which also forwards a press through them; they start fully if they are resized later.

const assert = require('node:assert/strict');
const test = require('node:test');

const {createPopupHarness} = require('./support/popup-harness');

const RELAY = {type: 'zoopdog-shift-relay', nonce: 'press-1'};
const nonces = (messages) => messages.map((message) => message.nonce);

for (const localMode of [false, true]) {
  const label = localMode ? 'local build' : 'public build';

  test(`${label}: the top window and a normal frame are wired as before`, () => {
    const top = createPopupHarness({localMode});
    const frame = createPopupHarness({localMode, frame: {width: 600, height: 400}});

    for (const harness of [top, frame]) {
      assert.equal(harness.calls.addStyle > 0, true, 'the popup style is added');
      for (const type of ['pointermove', 'pointerup', 'keydown', 'message', 'mouseout', 'scroll', 'resize']) {
        assert.equal(harness.windowListenerCount(type) > 0, true, `${type} is wired`);
      }
      assert.ok(harness.documentListenerTypes().includes('selectionchange'), 'selection wiring is present');
      harness.pointerMove(5, 5);
      assert.equal(harness.lastHover, 'shown');
    }
    assert.deepEqual(frame.windowListenerTypes(), top.windowListenerTypes());
    assert.deepEqual(frame.documentListenerTypes(), top.documentListenerTypes());
  });

  for (const [width, height] of [[1, 1], [0, 0], [49, 300], [300, 49]]) {
    test(`${label}: a ${width}x${height} frame wires only the Shift relay`, () => {
      const harness = createPopupHarness({localMode, frame: {width, height}});

      assert.equal(harness.calls.addStyle, 0, 'no style is injected');
      assert.deepEqual(harness.windowListenerTypes(), ['keydown', 'message', 'resize']);
      assert.deepEqual(harness.documentListenerTypes(), [], 'no selection bar or review wiring');
      assert.equal(harness.popupElement(), undefined);
      assert.equal(harness.parsed.length, 0, 'the dictionary is never parsed');
    });
  }

  test(`${label}: a tiny frame still relays Shift to its parent and children`, () => {
    const harness = createPopupHarness({localMode, frame: {width: 1, height: 1}});
    const child = {messages: [], postMessage(message) { this.messages.push(message); }};
    harness.context.frames = [child];

    harness.dispatch('message', {data: RELAY});
    assert.deepEqual(nonces(child.messages), ['press-1'], 'forwarded down to the nested frame');
    assert.deepEqual(nonces(harness.parentMessages), ['press-1'], 'and up to the parent');

    harness.dispatch('message', {data: RELAY});
    assert.equal(child.messages.length, 1, 'a message coming around again is not relayed twice');

    harness.dispatch('keydown', {which: 16, repeat: false});
    assert.equal(child.messages.length, 2, 'a Shift pressed in the tiny frame itself is relayed too');
  });

  test(`${label}: a frame that becomes usable starts once, with a single relay`, () => {
    const harness = createPopupHarness({localMode, frame: {width: 1, height: 1}});

    harness.resize(30, 30);
    assert.equal(harness.calls.addStyle, 0, 'still too small');
    assert.equal(harness.windowListenerCount('pointermove'), 0);

    harness.resize(300, 250);
    const started = harness.calls.addStyle;
    assert.equal(started > 0, true);
    assert.equal(harness.windowListenerCount('pointermove'), 1);
    assert.ok(harness.documentListenerTypes().includes('selectionchange'));
    assert.equal(harness.windowListenerCount('keydown'), 1, 'the relay is not wired a second time');
    assert.equal(harness.windowListenerCount('message'), 1);
    harness.pointerMove(5, 5);
    assert.equal(harness.lastHover, 'shown');

    const resizeHandlers = harness.windowListenerCount('resize');
    harness.resize(400, 300);
    harness.resize(1, 1);
    harness.resize(500, 400);
    assert.equal(harness.calls.addStyle, started, 'initialised at most once');
    assert.equal(harness.windowListenerCount('pointermove'), 1);
    assert.equal(harness.windowListenerCount('resize'), resizeHandlers);
  });
}
