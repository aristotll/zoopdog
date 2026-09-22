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
//     en: [{def, pos, headword?}]  // ordered, deduped senses; `headword` is present only when
//                                  // it differs from `headwords[0]` (the primary display
//                                  // form), so a single-headword group carries no redundant
//                                  // association at all. Case/plural variants of the same sense
//                                  // (e.g. "rumor" and "Rumors") are folded into the longer one.
//   }
const GROUPED_SCHEMA_VERSION = 1;

const {cleanText, normalizeTerm} = require('./text');
const {definitionKey} = require('./sources');

// Plain ASCII text only -- excludes Chu Nom/CJK renderings and any gloss that carries a Han
// synonym alongside it (e.g. "修練 (修练)"). Every character in every such string counts as a
// "boundary" for the containment check below, which would otherwise treat one Nom candidate as
// a redundant "variant" of another merely because their characters overlap, silently dropping a
// hand-maintained rendering that a downstream consumer expects to find verbatim.
function isAsciiText(str) {
  return /^[\x00-\x7f]*$/.test(str);
}

// Case-insensitive, word-boundary containment: true when `needle` occurs inside `haystack`
// bounded by non-alphanumeric characters (or the string ends), optionally followed by a plural
// "s"/"es" suffix -- e.g. "rumor" is contained in "Rumors", but "ba" is not contained in "Cuba"
// and "an" is not contained in "Iran".
function containsAsWordOrPlural(haystack, needle) {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(^|[^a-zA-Z0-9])${escaped}(es|s)?($|[^a-zA-Z0-9])`, 'i');
  return pattern.test(haystack);
}

// True when `a` and `b` are the same definition modulo case, or one is a plural/word-boundary
// variant containing the other (see `containsAsWordOrPlural`). Restricted to plain ASCII text
// (see `isAsciiText`) so Chu Nom/CJK renderings are never folded.
function isRedundantVariant(a, b) {
  if (!isAsciiText(a) || !isAsciiText(b)) {
    return false;
  }
  if (a.toLowerCase() === b.toLowerCase()) {
    return true;
  }
  return containsAsWordOrPlural(a, b) || containsAsWordOrPlural(b, a);
}

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

      // Fold plural/case variants of an already-kept sense (same pos) into a single entry,
      // keeping whichever text is longer -- e.g. "rumor" and "Rumors" collapse to "Rumors".
      const variantIndex = group.senseOrder.findIndex(
        (sense) => sense.pos === pos && isRedundantVariant(sense.def, def)
      );
      if (variantIndex !== -1) {
        const existing = group.senseOrder[variantIndex];
        group.senseSeen.add(senseKey);
        if (def.length > existing.def.length) {
          group.senseOrder[variantIndex] = {def, pos, headword};
        }
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
// normalized key must still be reachable from that key's grouped senses, either by identity or
// because a kept sense is a case/plural variant that subsumes it (see `isRedundantVariant`) --
// that intentional folding is what keeps generated userscripts smaller.
function verifyLossless(sourceEntries, groups) {
  const expected = new Map();
  for (const entry of sourceEntries) {
    const key = normalizeTerm(entry.vn);
    if (!key) continue;
    const list = expected.get(key) || [];
    for (const definition of entry.en) {
      list.push({def: cleanText(definition.def), pos: cleanText(definition.pos)});
    }
    expected.set(key, list);
  }

  const actualByKey = new Map(groups.map((group) => [group.key, group.en]));

  for (const [key, expectedList] of expected) {
    const actualList = actualByKey.get(key) || [];
    for (const {def, pos} of expectedList) {
      const senseKey = definitionKey(def, pos);
      const reachable = actualList.some((sense) =>
        sense.pos === pos
          && (definitionKey(sense.def, sense.pos) === senseKey || isRedundantVariant(sense.def, def))
      );
      if (!reachable) {
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
