'use strict';

// The sharded `user_nom_entries/` store: 128 CSV shard files under a root directory, addressed by
// `shard-path.js`. This is the one place that knows the store is sharded at all -- everything
// else (readers, upsert callers, the userscript builders) goes through
// `readAllEntries`/`upsertEntries` and gets back the same `{vi, nom, explain}` shape a single-file
// store would have returned. See openspec/changes/shard-user-nom-entries-csv/design.md.
const fs = require('node:fs');
const path = require('node:path');
const {atomicWrite} = require('./fsutil');
const {normalizeTerm, stableUnique, cleanText} = require('./text');
const {allShardPaths, shardPathFor} = require('./shard-path');
const {parseShardCsv, serializeShardCsv} = require('./nom-entries-csv');

/**
 * One row of a shard CSV, as `parseShardCsv` returns it: the Vietnamese term, its Chu Nom renderings
 * and its explanations.
 * @typedef {{vi: string, nom: string[], explain: string[]}} NomShardEntry
 */
/**
 * A shard row as `readAllEntries` returns it, with its normalized lookup key added.
 * @typedef {NomShardEntry & {key: string}} NomStoreEntry
 */
/**
 * An entry handed to `upsertEntries`/`groupIncoming`: lists may be absent, `replace` opts in to
 * overwriting the stored renderings instead of merging into them.
 * @typedef {{vi: string, nom?: string[], explain?: string[], replace?: boolean}} IncomingNomEntry
 */
/**
 * An incoming entry after `groupIncoming` folded duplicates of the same normalized key together.
 * @typedef {{vi: string, nom: string[], explain: string[], replace: boolean}} GroupedNomEntry
 */

class MissingShardError extends Error {
  /** @param {string} rootDir @param {string} relativeShardPath */
  constructor(rootDir, relativeShardPath) {
    super(`Missing user Nom entry shard: ${path.join(rootDir, relativeShardPath)}`);
    this.name = 'MissingShardError';
    this.rootDir = rootDir;
    this.shardPath = relativeShardPath;
  }
}

// Ensures the store's 128-file invariant (design.md Decision 2): every shard is expected to
// exist, even empty. Used both by readers (fail loudly instead of treating "missing" as "empty")
// and by the migration script (to know what to create).
/** @param {string} rootDir */
function assertAllShardsExist(rootDir) {
  for (const relativeShardPath of allShardPaths()) {
    if (!fs.existsSync(path.join(rootDir, relativeShardPath))) {
      throw new MissingShardError(rootDir, relativeShardPath);
    }
  }
}

/** @param {string} rootDir @param {string} relativeShardPath @returns {NomShardEntry[]} */
function readShard(rootDir, relativeShardPath) {
  const target = path.join(rootDir, relativeShardPath);
  if (!fs.existsSync(target)) {
    throw new MissingShardError(rootDir, relativeShardPath);
  }
  try {
    return parseShardCsv(fs.readFileSync(target, 'utf8'));
  } catch (error) {
    const failure = /** @type {Error} */ (error);
    failure.message = `${target}: ${failure.message}`;
    throw failure;
  }
}

// Reads every shard and returns the flat `{vi, key, nom, explain}[]` shape existing callers
// (`readUserNomEntries`'s prior JSONC-backed return value) already expect.
/** @param {string} rootDir @returns {NomStoreEntry[]} */
function readAllEntries(rootDir) {
  /** @type {NomStoreEntry[]} */
  const entries = [];
  for (const relativeShardPath of allShardPaths()) {
    for (const entry of readShard(rootDir, relativeShardPath)) {
      entries.push({...entry, key: normalizeTerm(entry.vi)});
    }
  }
  return entries;
}

// Writes only the shard `relativeShardPath` currently touches, and only if its content actually
// changed -- an unnecessary rewrite would bump the shard's mtime for no reason, which matters to
// `book-translator`'s `LiveNomIndex` (a changed mtime with unchanged content still looks like
// "reparse this shard").
/** @param {string} rootDir @param {string} relativeShardPath @param {NomShardEntry[]} entries */
function writeShardIfChanged(rootDir, relativeShardPath, entries) {
  const target = path.join(rootDir, relativeShardPath);
  const next = serializeShardCsv(entries);
  const previous = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;
  if (previous === next) {
    return false;
  }
  atomicWrite(target, next);
  return true;
}

// Merges one incoming entry into an existing shard row: additive (union nom/explain) unless
// `replace` is set, matching the semantics `upsertUserEntriesJsonc` already documented -- a
// reviewer approving candidates never saw the file's current values, so replacing outright would
// silently drop Nom variants they never had a chance to restate; `replace: true` is the explicit
// opt-in for correcting a wrong rendering.
/**
 * @param {NomShardEntry | undefined} existing
 * @param {GroupedNomEntry} incoming
 * @returns {NomShardEntry}
 */
function mergeEntry(existing, incoming) {
  if (!existing) {
    return {vi: incoming.vi, nom: stableUnique(incoming.nom), explain: stableUnique(incoming.explain)};
  }
  if (incoming.replace) {
    return {vi: incoming.vi, nom: stableUnique(incoming.nom), explain: stableUnique(incoming.explain)};
  }
  return {
    vi: incoming.vi,
    nom: stableUnique([...existing.nom, ...incoming.nom]),
    explain: stableUnique([...existing.explain, ...incoming.explain])
  };
}

/** @param {{vi: string, nom: string[], explain: string[]}} a @param {{vi: string, nom: string[], explain: string[]}} b */
function isSameEntry(a, b) {
  return cleanText(a.vi) === cleanText(b.vi) &&
    JSON.stringify(a.nom) === JSON.stringify(b.nom) &&
    JSON.stringify(a.explain) === JSON.stringify(b.explain);
}

// Groups incoming entries by normalized key, folding duplicates within the same call together
// the same way `upsertUserEntriesJsonc` did (later items extend earlier ones; `replace` is sticky
// once any duplicate sets it).
/** @param {IncomingNomEntry[]} incomingEntries @returns {Map<string, GroupedNomEntry>} */
function groupIncoming(incomingEntries) {
  /** @type {Map<string, GroupedNomEntry>} */
  const grouped = new Map();
  for (const entry of incomingEntries) {
    const key = normalizeTerm(entry.vi);
    const nom = stableUnique((entry.nom || []).map((/** @type {string} */ value) => cleanText(value)));
    const explain = stableUnique((entry.explain || []).map((/** @type {string} */ value) => cleanText(value)));
    if (!grouped.has(key)) {
      grouped.set(key, {vi: entry.vi, nom, explain, replace: Boolean(entry.replace)});
      continue;
    }
    const existing = /** @type {GroupedNomEntry} */ (grouped.get(key));
    grouped.set(key, {
      vi: existing.vi,
      nom: stableUnique([...existing.nom, ...nom]),
      explain: stableUnique([...existing.explain, ...explain]),
      replace: Boolean(existing.replace || entry.replace)
    });
  }
  return grouped;
}

// Upserts `incomingEntries` into the store, touching only the shards those entries hash to.
// Returns which shard paths were actually written (content changed) versus left alone -- the
// property the "no need to update the large file" goal (and the reader server's mtime-based
// reload) both depend on.
/**
 * @param {string} rootDir
 * @param {IncomingNomEntry[]} incomingEntries
 * @returns {{written: string[], unchanged: string[]}}
 */
function upsertEntries(rootDir, incomingEntries) {
  const grouped = groupIncoming(incomingEntries);
  /** @type {Map<string, GroupedNomEntry[]>} */
  const byShardPath = new Map();
  for (const entry of grouped.values()) {
    const relativeShardPath = shardPathFor(entry.vi);
    if (!byShardPath.has(relativeShardPath)) byShardPath.set(relativeShardPath, []);
    /** @type {GroupedNomEntry[]} */ (byShardPath.get(relativeShardPath)).push(entry);
  }

  /** @type {string[]} */
  const written = [];
  /** @type {string[]} */
  const unchanged = [];
  /** @type {[string, NomShardEntry[]][]} */
  const prepared = [];
  for (const [relativeShardPath, incomingForShard] of byShardPath) {
    const shardEntries = readShard(rootDir, relativeShardPath);
    const byKey = new Map(shardEntries.map((entry) => [normalizeTerm(entry.vi), entry]));
    for (const incoming of incomingForShard) {
      const key = normalizeTerm(incoming.vi);
      const merged = mergeEntry(byKey.get(key), incoming);
      byKey.set(key, merged);
    }
    const entries = Array.from(byKey.values());
    serializeShardCsv(entries); // Validate all pending writes before publishing any shard.
    prepared.push([relativeShardPath, entries]);
  }
  for (const [relativeShardPath, entries] of prepared) {
    const changed = writeShardIfChanged(rootDir, relativeShardPath, entries);
    (changed ? written : unchanged).push(relativeShardPath);
  }
  return {written, unchanged};
}

module.exports = {
  MissingShardError,
  assertAllShardsExist,
  readShard,
  readAllEntries,
  writeShardIfChanged,
  mergeEntry,
  isSameEntry,
  groupIncoming,
  upsertEntries
};
