'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('review queue adapter preserves entries and deduplicates without browser globals', () => {
  const context = vm.createContext({JSON, Array});
  vm.runInContext(fs.readFileSync(require.resolve('../scripts/userscript/nom-review-store.js'), 'utf8'), context);
  let value = 'invalid';
  const store = context.createZooNomReviewStore({read: () => value, write: next => {value = next;}});
  assert.deepEqual(Array.from(store.read()), []);
  assert.equal(store.add({vi: 'bạn', context: 'tình bạn', ts: 1}), true);
  assert.equal(store.add({vi: 'bạn', context: 'khác', ts: 2}), false);
  assert.deepEqual(JSON.parse(value), [{vi: 'bạn', context: 'tình bạn', ts: 1}]);
  assert.equal(store.has('bạn'), true);
});
