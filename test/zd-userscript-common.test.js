'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../scripts/userscript/zd-userscript-common.js'), 'utf8');

// Timers that only queue, so a test decides when a poll fires and sees every delay it was armed with.
function fakeTimers() {
  const pending = [];
  const log = {armed: [], cleared: []};
  let nextId = 1;
  return {
    pending,
    log,
    setTimeout(callback, ms) {
      const timer = {id: nextId++, callback, ms};
      pending.push(timer);
      log.armed.push(ms);
      return timer.id;
    },
    clearTimeout(handle) {
      log.cleared.push(handle);
      const at = pending.findIndex((timer) => timer.id === handle);
      if (at !== -1) pending.splice(at, 1);
    },
    delays: () => pending.map((timer) => timer.ms),
    fire() {
      const timer = pending.shift();
      timer.callback();
    }
  };
}

function load() {
  const context = vm.createContext({});
  vm.runInContext(source, context);
  return context.zdCreateBackoffPoll;
}

function makePoll(overrides = {}) {
  const timers = fakeTimers();
  const results = [];
  let runs = 0;
  const poll = load()({
    intervalMs: 500,
    maxMs: 5000,
    run: () => { runs++; return results.length ? results.shift() : false; },
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    ...overrides
  });
  return {poll, timers, results, runs: () => runs};
}

test('nothing is scheduled until start, and start arms the short interval', () => {
  const {poll, timers, runs} = makePoll();
  assert.deepEqual(timers.delays(), []);
  poll.start();
  assert.deepEqual(timers.delays(), [500]);
  assert.equal(runs(), 0);
});

test('an idle poll doubles its delay up to the cap and stays there', () => {
  const {poll, timers} = makePoll();
  poll.start();
  const seen = [];
  for (let i = 0; i < 6; i++) {
    timers.fire();
    seen.push(...timers.delays());
  }
  assert.deepEqual(seen, [1000, 2000, 4000, 5000, 5000, 5000]);
});

test('a poll that found work snaps back to the short interval', () => {
  const {poll, timers, results} = makePoll();
  poll.start();
  timers.fire();
  timers.fire();
  assert.deepEqual(timers.delays(), [2000]);
  results.push(true);
  timers.fire();
  assert.deepEqual(timers.delays(), [500]);
});

test('wake restarts only a backed-off poll, replacing its pending timer', () => {
  const {poll, timers} = makePoll();
  poll.wake();
  assert.deepEqual(timers.delays(), [], 'a poll that was never started is not woken');
  poll.start();
  poll.wake();
  assert.deepEqual(timers.log.armed, [500], 'already at the short interval: left alone');
  timers.fire();
  timers.fire();
  assert.deepEqual(timers.delays(), [2000]);
  poll.wake();
  assert.deepEqual(timers.delays(), [500], 'the long wait was replaced, not added to');
});

test('a steady stream of wakes cannot postpone a poll that is at the short interval', () => {
  const {poll, timers} = makePoll();
  poll.start();
  const armed = timers.log.armed.length;
  for (let i = 0; i < 10; i++) poll.wake();
  assert.equal(timers.log.armed.length, armed);
  assert.equal(timers.log.cleared.length, 1, 'only the clear that start itself issues on a null handle');
});

test('stop cancels the pending poll and wake does not revive it; start does', () => {
  const {poll, timers} = makePoll();
  poll.start();
  timers.fire();
  poll.stop();
  assert.deepEqual(timers.delays(), []);
  poll.wake();
  assert.deepEqual(timers.delays(), []);
  poll.start();
  assert.deepEqual(timers.delays(), [500], 'start resets the back-off as well');
});

test('start while a poll is pending replaces it rather than adding a second one', () => {
  const {poll, timers} = makePoll();
  poll.start();
  poll.start();
  assert.deepEqual(timers.delays(), [500]);
});

test('isActive is asked after each run: false ends the polling without another timer', () => {
  let active = true;
  const {poll, timers, runs} = makePoll({isActive: () => active});
  poll.start();
  timers.fire();
  assert.equal(timers.delays().length, 1);
  active = false;
  timers.fire();
  assert.equal(runs(), 2, 'the poll that fired still ran');
  assert.deepEqual(timers.delays(), []);
  poll.wake();
  assert.deepEqual(timers.delays(), [], 'a finished poll is not woken');
  active = true;
  poll.start();
  assert.deepEqual(timers.delays(), [500]);
});

test('without isActive the poll keeps going whatever run answers', () => {
  const {poll, timers} = makePoll();
  poll.start();
  for (let i = 0; i < 20; i++) timers.fire();
  assert.equal(timers.delays().length, 1);
});

test('a throwing run ends the chain like the inline loops did, and start recovers it', () => {
  let calls = 0;
  const {poll, timers} = makePoll({run: () => { calls++; throw new Error('scan failed'); }});
  poll.start();
  assert.throws(() => timers.fire(), /scan failed/);
  assert.deepEqual(timers.delays(), []);
  poll.start();
  assert.deepEqual(timers.delays(), [500]);
  assert.equal(calls, 1);
});

test('the timer functions are used exactly as given, never looked up on a global', () => {
  const calls = [];
  const poll = load()({
    intervalMs: 10,
    maxMs: 20,
    run: () => false,
    setTimeout: (callback, ms) => { calls.push(['set', ms]); return 'handle'; },
    clearTimeout: (handle) => { calls.push(['clear', handle]); }
  });
  poll.start();
  poll.stop();
  assert.deepEqual(calls, [['clear', null], ['set', 10], ['clear', 'handle']]);
});
