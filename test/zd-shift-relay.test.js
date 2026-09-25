'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {zdCreateShiftRelay} = require('../zd-extension/js/zd-words');

// A window tree whose postMessage delivers synchronously, like the message events of one page.
function fakeWindow(parent) {
  const listeners = [];
  const win = {
    frames: [],
    parent: parent || null,
    addEventListener(type, listener) { if (type === 'message') listeners.push(listener); },
    postMessage(data) { listeners.slice().forEach((listener) => listener({data})); }
  };
  win.parent = parent || win;
  if (parent) parent.frames.push(win);
  return win;
}

function instrumented(win) {
  const state = {toggles: 0};
  state.relay = zdCreateShiftRelay(win, () => { state.toggles++; });
  return state;
}

test('a Shift press in the top window reaches the instance inside the frame exactly once', () => {
  const top = fakeWindow();
  const frame = fakeWindow(top);
  const topState = instrumented(top);
  const frameState = instrumented(frame);

  topState.relay.press();

  assert.equal(topState.toggles, 1);
  assert.equal(frameState.toggles, 1);
});

test('a press in a nested frame reaches every other instance exactly once', () => {
  const top = fakeWindow();
  const a = fakeWindow(top);
  const b = fakeWindow(top);
  const nested = fakeWindow(a);
  const states = [top, a, b, nested].map(instrumented);

  states[3].relay.press();

  assert.deepEqual(states.map((s) => s.toggles), [1, 1, 1, 1]);
});

test('unrelated messages do not toggle', () => {
  const top = fakeWindow();
  const state = instrumented(top);
  top.postMessage({type: 'something-else', nonce: 'x'});
  top.postMessage('shift');
  top.postMessage(null);
  assert.equal(state.toggles, 0);
});
