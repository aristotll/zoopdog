'use strict';

// scripts/browser-perf.js needs a real Chromium for its measurements; what can be checked without
// one is the argument parsing and the arithmetic that turns runs into medians and ranges.

const assert = require('node:assert/strict');
const test = require('node:test');

const {parseArgs, summarize, summarizeRuns, formatSummary} = require('../scripts/browser-perf');

test('browser-perf argument parsing accepts positional files and flags', () => {
  assert.deepEqual(parseArgs([]), {popup: null, nom: null, runs: 3, only: null, json: false, require: false});
  const parsed = parseArgs(['a.user.js', 'b.user.js', '--runs', '5', '--json', '--only', 'popup']);
  assert.equal(parsed.popup, 'a.user.js');
  assert.equal(parsed.nom, 'b.user.js');
  assert.equal(parsed.runs, 5);
  assert.equal(parsed.json, true);
  assert.equal(parsed.only, 'popup');
  assert.equal(parseArgs(['--nom', 'x.js', '--popup', 'y.js']).nom, 'x.js');
  assert.throws(() => parseArgs(['--runs', '0']), /positive integer/);
  assert.throws(() => parseArgs(['--only', 'cjk']), /popup or nom/);
  assert.throws(() => parseArgs(['--bogus']), /unknown option/);
  assert.throws(() => parseArgs(['--popup']), /needs a value/);
});

test('browser-perf summaries report the median and the range, ignoring missing values', () => {
  assert.deepEqual(summarize([3, 1, 2]), {median: 2, min: 1, max: 3, runs: 3});
  assert.deepEqual(summarize([4, 2, 8, 6]), {median: 5, min: 2, max: 8, runs: 4});
  assert.deepEqual(summarize([5, null, NaN, undefined]), {median: 5, min: 5, max: 5, runs: 1});
  assert.equal(summarize([null]), null);

  const summary = summarizeRuns([{evalMs: 10, latencyMs: null}, {evalMs: 30, latencyMs: null}, {evalMs: 20, latencyMs: null}]);
  assert.equal(summary.evalMs.median, 20);
  assert.equal(summary.latencyMs, null);
  assert.deepEqual(formatSummary(summary), ['evalMs 20.0 (10.0-30.0)', 'latencyMs n/a']);
});
