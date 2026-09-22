'use strict';

// Permanent `make verify` coverage for the `user_nom_entries/` shard store's own invariants --
// not the read/write API (covered in test/scripts-lib.test.js), but
// whether the *committed files themselves* still satisfy the rules the store depends on. A hand
// edit to a shard (wrong sort order, an entry filed under the wrong shard, output that didn't go
// through the codec) would otherwise sit undetected until it silently broke a lookup or a future
// upsert's diff. See openspec/changes/shard-user-nom-entries-csv's open question: this is that
// "fast-follow" landed as part of the same change instead of deferred.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoPaths = require('../scripts/lib/paths');
const {normalizeTerm} = require('../scripts/lib/text');
const {allShardPaths, shardPathFor} = require('../scripts/lib/shard-path');
const {parseShardCsv, serializeShardCsv} = require('../scripts/lib/nom-entries-csv');

const shardRoot = repoPaths.absolute.userNomEntries;

test('every committed shard is byte-identical to re-deriving it from its own parsed entries', () => {
  for (const relative of allShardPaths()) {
    const target = path.join(shardRoot, relative);
    const committed = fs.readFileSync(target, 'utf8');
    const rederived = serializeShardCsv(parseShardCsv(committed));
    assert.equal(
      rederived,
      committed,
      `${relative} is not what re-serializing its own entries produces -- ` +
      'check sort order, `|`-joining, and quoting match the codec exactly (no hand edits).'
    );
  }
});

test('every entry lives in the shard its own vi actually hashes to', () => {
  const misplaced = [];
  for (const relative of allShardPaths()) {
    const target = path.join(shardRoot, relative);
    for (const entry of parseShardCsv(fs.readFileSync(target, 'utf8'))) {
      const expected = shardPathFor(entry.vi);
      if (expected !== relative) {
        misplaced.push(`"${entry.vi}" found in ${relative}, hashes to ${expected}`);
      }
    }
  }
  assert.deepEqual(misplaced, []);
});

test('no shard holds two rows for the same normalized term', () => {
  const duplicates = [];
  for (const relative of allShardPaths()) {
    const target = path.join(shardRoot, relative);
    const seen = new Map();
    for (const entry of parseShardCsv(fs.readFileSync(target, 'utf8'))) {
      const key = normalizeTerm(entry.vi);
      if (seen.has(key)) {
        duplicates.push(`${relative}: "${seen.get(key)}" and "${entry.vi}" both key "${key}"`);
      }
      seen.set(key, entry.vi);
    }
  }
  assert.deepEqual(duplicates, []);
});
