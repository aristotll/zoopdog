#!/usr/bin/env node

'use strict';

// One-time migration: `zd-extension/db_src/user_nom_entries.jsonc` (a single JSON array of
// {vi, nom, explain}) -> `zd-extension/db_src/user_nom_entries/` (128 CSV shard files). See
// openspec/changes/shard-user-nom-entries-csv. Not part of the ongoing toolchain -- run once,
// then deleted along with the old file it reads.
const fs = require('node:fs');
const path = require('node:path');
const {stripJsonComments} = require('./lib/jsonc-strip');
const {cleanText, normalizeTerm, stableUnique} = require('./lib/text');
const {allShardPaths, shardPathFor} = require('./lib/shard-path');
const {serializeShardCsv, parseShardCsv} = require('./lib/nom-entries-csv');
const {atomicWrite} = require('./lib/fsutil');
const repoPaths = require('./lib/paths');

function asTextArray(value) {
  const values = Array.isArray(value) ? value : [value];
  return values.map((item) => cleanText(item)).filter(Boolean);
}

function readOldEntries(sourcePath) {
  const payload = JSON.parse(stripJsonComments(fs.readFileSync(sourcePath, 'utf8')));
  const rawEntries = Array.isArray(payload) ? payload : payload.entries;
  if (!Array.isArray(rawEntries)) {
    throw new Error(`${sourcePath} must contain an array, or an object with an entries array`);
  }
  return rawEntries.map((entry, index) => {
    const vi = cleanText(entry.vi || entry.vn || entry.word);
    const nom = asTextArray(entry.nom || entry.chuNom || entry.chunom);
    const explain = asTextArray(entry.explain || entry.explains || entry.explanation || entry.definitions);
    if (!vi) throw new Error(`${sourcePath} entry ${index + 1} is missing vi`);
    if (!nom.length) throw new Error(`${sourcePath} entry ${index + 1} is missing nom`);
    return {vi, nom, explain};
  });
}

// The old single-file store never enforced "one row per term" -- book-translator's own
// pre-sharding `append_user_nom_entry` always appended a new row rather than editing one in
// place, so the same normalized term could (and, in this data, does: 10 pairs as of writing)
// accumulate more than one row over time. The new shard store's whole premise is exactly one
// row per term, so migrating must merge these the same way `nom-entries-store.js`'s own upsert
// does -- additive union, never dropping a variant either row carried -- rather than writing
// duplicate rows into the same shard (every duplicate-keyed row hashes to the same shard by
// construction, since the shard key *is* the normalized term).
function mergeDuplicates(entries) {
  const byKey = new Map();
  for (const entry of entries) {
    const key = normalizeTerm(entry.vi);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, {vi: entry.vi, nom: [...entry.nom], explain: [...entry.explain]});
      continue;
    }
    existing.nom = stableUnique([...existing.nom, ...entry.nom]);
    existing.explain = stableUnique([...existing.explain, ...entry.explain]);
  }
  return [...byKey.values()];
}

function entrySetKey(entry) {
  return JSON.stringify([normalizeTerm(entry.vi), [...entry.nom].sort(), [...entry.explain].sort()]);
}

function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const oldPath = path.join(repoRoot, 'zd-extension/db_src/user_nom_entries.jsonc');
  const shardRoot = repoPaths.absolute.userNomEntries;

  const oldEntries = readOldEntries(oldPath);
  const mergedEntries = mergeDuplicates(oldEntries);
  const duplicateKeyCount = oldEntries.length - mergedEntries.length;

  const byShardPath = new Map();
  for (const relative of allShardPaths()) {
    byShardPath.set(relative, []);
  }
  for (const entry of mergedEntries) {
    const relative = shardPathFor(entry.vi);
    byShardPath.get(relative).push(entry);
  }

  for (const [relative, entries] of byShardPath) {
    atomicWrite(path.join(shardRoot, relative), serializeShardCsv(entries));
  }

  // Verify: re-reading every shard reproduces the exact same *merged* entry set
  // (order-independent, and merging is idempotent so re-deriving from the merged set is the
  // correct comparison here, not the raw pre-merge rows) before this script reports success.
  const rereadEntries = [];
  for (const relative of allShardPaths()) {
    rereadEntries.push(...parseShardCsv(fs.readFileSync(path.join(shardRoot, relative), 'utf8')));
  }
  const before = new Set(mergedEntries.map(entrySetKey));
  const after = new Set(rereadEntries.map(entrySetKey));
  const missing = [...before].filter((key) => !after.has(key));
  const unexpected = [...after].filter((key) => !before.has(key));
  if (missing.length || unexpected.length || rereadEntries.length !== mergedEntries.length) {
    throw new Error(
      `Migration verification failed: ${missing.length} entries missing after migration, ` +
      `${unexpected.length} unexpected entries introduced. Nothing further was written.`
    );
  }

  const touchedShards = [...byShardPath.entries()].filter(([, entries]) => entries.length).length;
  console.log(`Migrated ${oldEntries.length} entries (${duplicateKeyCount} duplicate-keyed rows ` +
    `merged) into ${mergedEntries.length} rows across ${touchedShards} non-empty shards ` +
    `(of ${allShardPaths().length} total) under ${path.relative(repoRoot, shardRoot)}.`);
  console.log('Verified: re-read entry set matches the merged set exactly.');
}

if (require.main === module) {
  main();
}

module.exports = {readOldEntries, mergeDuplicates, entrySetKey, main};
