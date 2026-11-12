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

test('malformed CSV is rejected with position and valid quoted Unicode round-trips', () => {
  for (const row of ['ba,巴,"\nbốn,四,\n', 'ba,巴,ab"c\n', 'ba,巴,"x"z\n', 'ba,巴\n', 'ba,巴,x,y\n']) {
    assert.throws(() => parseShardCsv('vi,nom,explain\n' + row), /line \d+.*column \d+/i, row);
  }
  const entries = [{vi: 'bốn', nom: ['四'], explain: ['một, "hai"\nba']}];
  assert.deepEqual(parseShardCsv(serializeShardCsv(entries)), entries);
});

test('upsert validates every affected shard before writing any', () => {
  const os = require('node:os');
  const {upsertEntries} = require('../scripts/lib/nom-entries-store');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nom-shards-invalid-'));
  try {
    const first = 'ba';
    const second = ['bốn', 'chó', 'cá'].find(word => shardPathFor(word) !== shardPathFor(first));
    const firstFile = path.join(root, shardPathFor(first));
    const secondFile = path.join(root, shardPathFor(second));
    const artifact = path.join(root, 'existing-artifact.json');
    fs.mkdirSync(path.dirname(firstFile), {recursive: true});
    fs.mkdirSync(path.dirname(secondFile), {recursive: true});
    fs.writeFileSync(firstFile, 'vi,nom,explain\n');
    const invalid = 'vi,nom,explain\nx,字,"unclosed';
    fs.writeFileSync(secondFile, invalid);
    fs.writeFileSync(artifact, 'unchanged artifact');
    assert.throws(() => upsertEntries(root, [{vi: first, nom: ['巴']}, {vi: second, nom: ['四']}]), error => error.message.includes(secondFile));
    assert.equal(fs.readFileSync(firstFile, 'utf8'), 'vi,nom,explain\n');
    assert.equal(fs.readFileSync(secondFile, 'utf8'), invalid);
    assert.equal(fs.readFileSync(artifact, 'utf8'), 'unchanged artifact');
  } finally { fs.rmSync(root, {recursive: true, force: true}); }
});
