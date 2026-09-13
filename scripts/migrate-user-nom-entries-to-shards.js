#!/usr/bin/env node

'use strict';

// One-time migration: `zd-extension/db_src/user_nom_entries.jsonc` (a single JSON array of
// {vi, nom, explain}) -> `zd-extension/db_src/user_nom_entries/` (128 CSV shard files). See
// openspec/changes/shard-user-nom-entries-csv. Not part of the ongoing toolchain -- run once,
// then deleted along with the old file it reads.
const fs = require('node:fs');
const path = require('node:path');
const {stripJsonComments} = require('./lib/jsonc-strip');
const {cleanText} = require('./lib/text');
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

function entrySetKey(entry) {
  return JSON.stringify([entry.vi, [...entry.nom].sort(), [...entry.explain].sort()]);
}

function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const oldPath = path.join(repoRoot, 'zd-extension/db_src/user_nom_entries.jsonc');
  const shardRoot = repoPaths.absolute.userNomEntries;

  const oldEntries = readOldEntries(oldPath);

  const byShardPath = new Map();
  for (const relative of allShardPaths()) {
    byShardPath.set(relative, []);
  }
  for (const entry of oldEntries) {
    const relative = shardPathFor(entry.vi);
    byShardPath.get(relative).push(entry);
  }

  for (const [relative, entries] of byShardPath) {
    atomicWrite(path.join(shardRoot, relative), serializeShardCsv(entries));
  }

  // Verify: re-reading every shard reproduces the exact same entry set (order-independent) as
  // what was read from the old file, before this script reports success.
  const rereadEntries = [];
  for (const relative of allShardPaths()) {
    rereadEntries.push(...parseShardCsv(fs.readFileSync(path.join(shardRoot, relative), 'utf8')));
  }
  const before = new Set(oldEntries.map(entrySetKey));
  const after = new Set(rereadEntries.map(entrySetKey));
  const missing = [...before].filter((key) => !after.has(key));
  const unexpected = [...after].filter((key) => !before.has(key));
  if (missing.length || unexpected.length) {
    throw new Error(
      `Migration verification failed: ${missing.length} entries missing after migration, ` +
      `${unexpected.length} unexpected entries introduced. Nothing further was written.`
    );
  }

  const touchedShards = [...byShardPath.entries()].filter(([, entries]) => entries.length).length;
  console.log(`Migrated ${oldEntries.length} entries into ${touchedShards} non-empty shards ` +
    `(of ${allShardPaths().length} total) under ${path.relative(repoRoot, shardRoot)}.`);
  console.log(`Verified: re-read entry set matches the original ${oldEntries.length}-entry file exactly.`);
}

if (require.main === module) {
  main();
}

module.exports = {readOldEntries, entrySetKey, main};
