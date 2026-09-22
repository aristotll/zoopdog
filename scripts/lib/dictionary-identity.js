'use strict';

// Shared dictionary-entry identity: the single place that turns validated `{vn, en}` source
// rows into grouped logical entries keyed by a normalized identity. Both
// `scripts/build-extension-vnedict-json.js` and `scripts/build-popupdict-userscript.js` import
// this module so a normalized headword collision (e.g. `Ba Lê` / `ba lê`) is resolved exactly
// once, the same way, for every consumer.
//
// Grouped entry shape (see openspec/changes/normalize-dictionary-entry-identity/design.md):
//   {
//     key: string,          // normalized lookup identity (NFC, vi-VN lowercase, collapsed ws)
//     headwords: string[],  // ordered, deduped display variants, first source occurrence wins
//     en: [{def, pos, headword?}]  // ordered, lossless, deduped senses; `headword` is present
//                                  // only when it differs from `headwords[0]` (the primary
//                                  // display form), so a single-headword group carries no
//                                  // redundant association at all.
//   }
const GROUPED_SCHEMA_VERSION = 1;

const {cleanText, normalizeTerm} = require('./text');
const {definitionKey} = require('./sources');

function assertSourceEntries(entries) {
  if (!Array.isArray(entries)) {
    throw new TypeError('Dictionary source rows must be an array');
  }
  entries.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new TypeError(`Dictionary source row ${index} must be an object`);
    }
    if (typeof entry.vn !== 'string') {
      throw new TypeError(`Dictionary source row ${index} must have a string "vn" headword`);
    }
    if (!Array.isArray(entry.en)) {
      throw new TypeError(`Dictionary source row ${index} must have an "en" array`);
    }
    entry.en.forEach((definition, definitionIndex) => {
      if (!definition || typeof definition !== 'object'
          || typeof definition.def !== 'string'
          || typeof definition.pos !== 'string') {
        throw new TypeError(
          `Dictionary source row ${index} definition ${definitionIndex} must have string def/pos`
        );
      }
    });
  });
}

// Pure grouping transform. Never mutates its input, never touches the filesystem.
function groupEntries(sourceEntries) {
  assertSourceEntries(sourceEntries);

  const order = [];
  const byKey = new Map();

  for (const entry of sourceEntries) {
    const key = normalizeTerm(entry.vn);
    if (!key) {
      continue;
    }
    const headword = cleanText(entry.vn);

    let group = byKey.get(key);
    if (!group) {
      group = {
        key,
        headwordOrder: [],
        headwordSeen: new Set(),
        senseOrder: [],
        senseSeen: new Set()
      };
      byKey.set(key, group);
      order.push(key);
    }

    if (!group.headwordSeen.has(headword)) {
      group.headwordSeen.add(headword);
      group.headwordOrder.push(headword);
    }

    for (const definition of entry.en) {
      const def = cleanText(definition.def);
      const pos = cleanText(definition.pos);
      const senseKey = definitionKey(def, pos);
      if (group.senseSeen.has(senseKey)) {
        continue;
      }
      group.senseSeen.add(senseKey);
      group.senseOrder.push({def, pos, headword});
    }
  }

  const groups = order.map((key) => {
    const group = byKey.get(key);
    const headwords = group.headwordOrder;
    const primary = headwords[0];
    const en = group.senseOrder.map((sense) => {
      if (headwords.length > 1 && sense.headword !== primary) {
        return {def: sense.def, pos: sense.pos, headword: sense.headword};
      }
      return {def: sense.def, pos: sense.pos};
    });
    return {key, headwords, en};
  });

  verifyLossless(sourceEntries, groups);

  return groups;
}

// Defence in depth: every distinct (def, pos) pair reachable from the source rows for a given
// normalized key must still be reachable, by identity, from that key's grouped senses.
function verifyLossless(sourceEntries, groups) {
  const expected = new Map();
  for (const entry of sourceEntries) {
    const key = normalizeTerm(entry.vn);
    if (!key) continue;
    const set = expected.get(key) || new Set();
    for (const definition of entry.en) {
      set.add(definitionKey(cleanText(definition.def), cleanText(definition.pos)));
    }
    expected.set(key, set);
  }

  const actual = new Map(groups.map((group) => [
    group.key,
    new Set(group.en.map((sense) => definitionKey(sense.def, sense.pos)))
  ]));

  for (const [key, expectedSet] of expected) {
    const actualSet = actual.get(key) || new Set();
    for (const senseKey of expectedSet) {
      if (!actualSet.has(senseKey)) {
        throw new Error(`Lossy grouping detected for key "${key}": missing sense ${senseKey}`);
      }
    }
  }
}

function validateGroupedEntry(entry, index) {
  const valid = entry
    && typeof entry === 'object'
    && !Array.isArray(entry)
    && typeof entry.key === 'string'
    && entry.key.length > 0
    && Array.isArray(entry.headwords)
    && entry.headwords.length > 0
    && entry.headwords.every((headword) => typeof headword === 'string' && headword.length > 0)
    && Array.isArray(entry.en)
    && entry.en.every((sense) => sense
      && typeof sense === 'object'
      && typeof sense.def === 'string'
      && typeof sense.pos === 'string'
      && (sense.headword === undefined || typeof sense.headword === 'string')
      && Object.keys(sense).every((prop) => prop === 'def' || prop === 'pos' || prop === 'headword'));
  if (!valid) {
    throw new TypeError(`Grouped dictionary entry ${index} does not match the grouped schema`);
  }
  return entry;
}

function validateGroupedEntries(entries) {
  if (!Array.isArray(entries)) {
    throw new TypeError('Grouped dictionary rows must be an array');
  }
  entries.forEach(validateGroupedEntry);
  return entries;
}

// Compact, deterministic collision diagnostics: counts only, no definitions dumped. Order is
// by normalized key so output (and therefore the report's bytes) is stable across reruns.
function buildCollisionReport(groups) {
  const collisions = groups
    .filter((group) => group.headwords.length > 1)
    .map((group) => ({
      key: group.key,
      headwordCount: group.headwords.length,
      senseCount: group.en.length
    }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  return {
    schemaVersion: GROUPED_SCHEMA_VERSION,
    totalKeys: groups.length,
    collisionCount: collisions.length,
    collisions
  };
}

// One `key=headwordCount/senseCount` line per collision, sorted -- never the definitions
// themselves, so this is safe to print by default.
function formatCollisionDiagnostics(report) {
  return report.collisions.map((collision) => `${collision.key}=${collision.headwordCount}/${collision.senseCount}`);
}

module.exports = {
  GROUPED_SCHEMA_VERSION,
  groupEntries,
  validateGroupedEntry,
  validateGroupedEntries,
  buildCollisionReport,
  formatCollisionDiagnostics
};
