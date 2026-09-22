'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const {atomicWrite} = require('./lib/fsutil');
const {absolute} = require('./lib/paths');
const {normalizeTerm} = require('./lib/text');
const {definitionKey} = require('./lib/sources');
const {readUserNomEntries} = require('./user-nom-entries');
const {readUserNomOrder, buildNomOrderIndex, hoistPreferredRows} = require('./user-nom-order');
const {
  groupEntries,
  validateGroupedEntries,
  buildCollisionReport,
  formatCollisionDiagnostics
} = require('./lib/dictionary-identity');

// Bumped from 1 -> 2 with the move from one row per source headword to one grouped row per
// normalized lookup key (see openspec/changes/normalize-dictionary-entry-identity). The runtime
// coordinator treats a schema-version mismatch as "not usable," so browsers holding the old
// per-headword rows always get a full replace rather than a mix of old and new row shapes.
const METADATA_SCHEMA_VERSION = 2;

function validateEntry(entry, index) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new TypeError(`Dictionary entry ${index} must be an object`);
  }
  if (typeof entry.vn !== 'string' || !entry.vn) {
    throw new TypeError(`Dictionary entry ${index} must have a Vietnamese headword`);
  }
  if (!Array.isArray(entry.en)) {
    throw new TypeError(`Dictionary entry ${index} definitions must be an array`);
  }
  for (const [definitionIndex, definition] of entry.en.entries()) {
    if (!definition || typeof definition !== 'object'
        || typeof definition.def !== 'string'
        || typeof definition.pos !== 'string') {
      throw new TypeError(
        `Dictionary entry ${index} definition ${definitionIndex} must contain string def and pos`
      );
    }
  }
}

// The extension renders an entry's definitions in the order they are stored, and its
// Chu Nom renderings are definitions like any other -- so the display order the reader
// chose is applied here, to `en`, rather than to a candidate list the extension never
// builds. Every entry sharing a normalized headword is reordered; a headword with no
// entry at all is skipped, since adding terms is `user_nom_entries.jsonc`'s job.
function applyUserNomOrderToEntries(entries, orderEntries) {
  const index = buildNomOrderIndex(orderEntries);
  if (!index.size) {
    return 0;
  }

  let reordered = 0;
  for (const entry of entries) {
    const preferred = index.get(normalizeTerm(entry.vn));
    if (!preferred) {
      continue;
    }
    entry.en = hoistPreferredRows(
      entry.en || [],
      preferred,
      (definition) => definition.def,
      (value) => ({def: value, pos: ''})
    );
    reordered += 1;
  }
  return reordered;
}

// `user_nom_entries.jsonc` is the sole authority on whether a term already has a hand-made
// Chu Nom rendering, and both userscript builders already fold it into their embedded data.
// The extension reads this generated dictionary instead, so the same fold has to happen here
// or a hand-maintained entry is simply invisible in the extension popup.
//
// Renderings lead the entry, the way every other Chu Nom row in this dictionary does, and the
// explanations follow the glosses vnedict2.json already carried; the order file runs after
// this, so it still has the final say over which rendering comes first.
function mergeUserNomEntriesIntoEntries(entries, userEntries) {
  if (!userEntries.length) {
    return 0;
  }

  const byKey = new Map();
  for (const entry of entries) {
    const key = normalizeTerm(entry.vn);
    if (key) {
      const matches = byKey.get(key) || [];
      matches.push(entry);
      byKey.set(key, matches);
    }
  }

  let merged = 0;
  for (const userEntry of userEntries) {
    const matches = byKey.get(userEntry.key);

    if (!matches) {
      const created = {
        vn: userEntry.vi,
        en: [
          ...userEntry.nom.map((nom) => ({def: nom, pos: ''})),
          ...userEntry.explain.map((explain) => ({def: explain, pos: ''}))
        ]
      };
      entries.push(created);
      byKey.set(userEntry.key, [created]);
      merged += 1;
      continue;
    }

    for (const existing of matches) {
      existing.en = existing.en || [];
      const before = JSON.stringify(existing.en);
      const seen = new Set(existing.en.map((item) => definitionKey(item.def, item.pos)));
      const unseen = (values) => values
        .map((value) => ({def: value, pos: ''}))
        .filter((row) => {
          const key = definitionKey(row.def, row.pos);
          if (seen.has(key)) {
            return false;
          }
          seen.add(key);
          return true;
        });

      const nomRows = unseen(userEntry.nom);
      const explainRows = unseen(userEntry.explain);
      existing.en = hoistPreferredRows(
        [...nomRows, ...existing.en, ...explainRows],
        userEntry.nom,
        (definition) => definition.def,
        (value) => ({def: value, pos: ''})
      );
      if (JSON.stringify(existing.en) !== before) {
        merged += 1;
      }
    }
  }

  return merged;
}

// `entries` here are already grouped rows ({key, headwords, en}), produced by
// `scripts/lib/dictionary-identity.js`. Kept as a separate step from grouping so callers that
// already have grouped rows (tests, other tooling) can serialize them directly.
function serializeRuntimeDictionary(entries) {
  validateGroupedEntries(entries);
  return JSON.stringify(entries);
}

function buildMetadata(dictionaryBytes) {
  const entries = JSON.parse(dictionaryBytes);
  if (!Array.isArray(entries)) {
    throw new TypeError('Runtime dictionary bytes must encode an array');
  }
  return {
    schemaVersion: METADATA_SCHEMA_VERSION,
    revision: crypto.createHash('sha256').update(dictionaryBytes).digest('hex'),
    entryCount: entries.length
  };
}

// The dictionary and its metadata sidecar are read together by every consumer (the runtime
// coordinator, the shipped-identity verification), so a rebuild must publish them as one unit:
// if the metadata write fails after the dictionary write already landed, the dictionary is
// rolled back to whatever it held before this run, so the pair on disk is always either the
// previous complete pair or the new complete pair -- never a mix of the two.
function publishDictionaryAndMetadata(dictionaryPath, dictionaryBytes, metadataPath, metadataBytes, {write = atomicWrite} = {}) {
  const previousDictionary = fs.existsSync(dictionaryPath) ? fs.readFileSync(dictionaryPath) : null;
  write(dictionaryPath, dictionaryBytes);
  try {
    write(metadataPath, metadataBytes);
  } catch (error) {
    if (previousDictionary === null) {
      fs.rmSync(dictionaryPath, {force: true});
    } else {
      write(dictionaryPath, previousDictionary);
    }
    throw error;
  }
}

function buildRuntimeDictionary({
  sourcePath = absolute.dictionary,
  dictionaryPath = absolute.runtimeDictionary,
  metadataPath = absolute.runtimeDictionaryMetadata,
  collisionsPath = absolute.runtimeDictionaryCollisions,
  orderPath = absolute.userNomOrder,
  userNomPath = absolute.userNomEntries,
  write
} = {}) {
  const entries = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
  const merged = mergeUserNomEntriesIntoEntries(entries, readUserNomEntries(userNomPath));
  const reordered = applyUserNomOrderToEntries(entries, readUserNomOrder(orderPath));
  // Grouping (scripts/lib/dictionary-identity.js) runs last, once per build, after every
  // source row (base dictionary + hand-maintained Chu Nom + display order) has settled into
  // its final `{vn, en}` shape -- so a normalized-key collision is resolved exactly once, on
  // the fully-merged data, rather than per source.
  const groups = groupEntries(entries);
  const report = buildCollisionReport(groups);
  const dictionaryBytes = serializeRuntimeDictionary(groups);
  const metadata = buildMetadata(dictionaryBytes);
  publishDictionaryAndMetadata(
    dictionaryPath,
    dictionaryBytes,
    metadataPath,
    `${JSON.stringify(metadata, null, 2)}\n`,
    write ? {write} : undefined
  );
  (write || atomicWrite)(collisionsPath, `${JSON.stringify(report, null, 2)}\n`);
  return {dictionaryPath, metadataPath, collisionsPath, metadata, report, merged, reordered};
}

function main() {
  const result = buildRuntimeDictionary();
  console.log(`Built ${result.dictionaryPath}`);
  console.log(`Built ${result.metadataPath}`);
  console.log(`Built ${result.collisionsPath}`);
  console.log(`Revision ${result.metadata.revision} (${result.metadata.entryCount} entries)`);
  if (result.merged) {
    console.log(`Merged ${result.merged} hand-maintained Chu Nom entries`);
  }
  if (result.reordered) {
    console.log(`Applied Chu Nom display order to ${result.reordered} entries`);
  }
  if (result.report.collisionCount) {
    console.log(`${result.report.collisionCount} normalized-key collisions (key=headwordCount/senseCount):`);
    formatCollisionDiagnostics(result.report).forEach((line) => console.log(`  ${line}`));
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  METADATA_SCHEMA_VERSION,
  applyUserNomOrderToEntries,
  buildMetadata,
  buildRuntimeDictionary,
  mergeUserNomEntriesIntoEntries,
  publishDictionaryAndMetadata,
  serializeRuntimeDictionary,
  validateEntry
};

// Re-exported so callers that only need the grouping step (e.g. the popup-userscript builder,
// tests) do not have to import scripts/lib/dictionary-identity.js separately.
module.exports.groupEntries = groupEntries;
module.exports.buildCollisionReport = buildCollisionReport;
module.exports.formatCollisionDiagnostics = formatCollisionDiagnostics;
