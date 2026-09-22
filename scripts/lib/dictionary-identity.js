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

// A dictionary sense's def is often a comma-separated bundle of synonyms (e.g.
// "other, different person, people"), each a candidate atomic gloss in its own right.
function synonymTokens(def) {
  return def.split(',').map((token) => token.trim()).filter(Boolean);
}

// Strips a leading English infinitive marker ("to ") so "to smile" and "smile" compare equal --
// vnedict2.json glosses a verb as "to <verb>" while a hand-maintained explain column tends to
// give the bare word.
function stripToPrefix(word) {
  return word.replace(/^to\s+/i, '');
}

// True when `token` is a multi-word phrase rather than a single word. Phrase containment (see
// below) is trustworthy for multi-word needles unconditionally: a single short word like "go"
// is often the first word of an unrelated, longer phrase ("go away (imperative)"), so folding
// on single-word containment alone risks false positives that a multi-word phrase does not --
// see `allowSingleWordContainment` for the narrower case where it is still worth the risk.
function isMultiWord(token) {
  return /\s/.test(token.trim());
}

// Case-insensitive, word-boundary containment: true when `needle` occurs inside `haystack` as
// one or more whole words (bounded by non-alphanumeric characters or the string ends),
// optionally followed by a plural "s"/"es" suffix -- e.g. "on the side" is contained in
// "on the side of".
function containsAsPhrase(haystack, needle) {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(^|[^a-zA-Z0-9])${escaped}(es|s)?($|[^a-zA-Z0-9])`, 'i');
  return pattern.test(haystack);
}

// Like `containsAsPhrase`, but only matches at the very start of `haystack` -- e.g. "not" is a
// prefix of "not correct", but "clearly" is NOT a prefix of "understand clearly" (it is the last
// word, modifying "understand", not a standalone gloss). Restricting a single-word needle to the
// prefix position is what keeps that second case from being folded away: a word at the end of an
// unrelated longer phrase is far more likely to be a modifier of that phrase's own head word
// than a genuine restatement of it.
function containsAsPrefixWord(haystack, needle) {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^${escaped}(es|s)?($|[^a-zA-Z0-9])`, 'i');
  return pattern.test(haystack);
}

// Regular English suffixes that turn one word into a related one without changing its core
// meaning enough to count as a different gloss: plural "s"/"es" ("rumor"/"Rumors") and the
// adjective-to-adverb "ly" ("recent"/"Recently").
const RELATED_WORD_SUFFIXES = ['s', 'es', 'ly'];

// True when `root` plus a suffix from `RELATED_WORD_SUFFIXES` equals `variant`.
function isSuffixedFormOf(root, variant) {
  return RELATED_WORD_SUFFIXES.some((suffix) => `${root}${suffix}` === variant);
}

// True when two synonym tokens are effectively the same gloss: equal modulo case, a regular
// suffix relationship between the two (see `isSuffixedFormOf`), or one is a phrase wholly
// contained in the other -- each check runs after stripping a leading "to " infinitive marker
// from both sides. A multi-word needle is checked at any position (see `containsAsPhrase`; e.g.
// "on the side" in "on the side of"). A single-word needle is far riskier -- it is only checked
// when `allowSingleWordContainment` says the surrounding group already has enough other senses
// that dropping one generic word is unlikely to lose real meaning, and even then only at the
// prefix position (see `containsAsPrefixWord`), so "not" folds into "not correct" but "clearly"
// does not fold into "understand clearly" (there it is a modifier of "understand", not a
// restatement of "clearly, distinctly").
function isSynonymMatch(x, y, allowSingleWordContainment) {
  const nx = stripToPrefix(x.toLowerCase());
  const ny = stripToPrefix(y.toLowerCase());
  if (nx === ny || isSuffixedFormOf(nx, ny) || isSuffixedFormOf(ny, nx)) {
    return true;
  }
  if (isMultiWord(ny) && containsAsPhrase(nx, ny)) {
    return true;
  }
  if (isMultiWord(nx) && containsAsPhrase(ny, nx)) {
    return true;
  }
  if (!allowSingleWordContainment) {
    return false;
  }
  if (!isMultiWord(ny) && containsAsPrefixWord(nx, ny)) {
    return true;
  }
  return !isMultiWord(nx) && containsAsPrefixWord(ny, nx);
}

// True when some synonym token of `a` and some synonym token of `b` are the same gloss modulo
// case, a plural suffix, or phrase containment (see `isSynonymMatch`) -- e.g. "others" is
// redundant with "other, different person, people" because "other" is one of its bundled
// synonyms, and "on the side" is redundant with "on the side of, on the part of" because it is
// a prefix of the first bundled synonym. Restricted to plain ASCII text (see `isAsciiText`) so
// Chu Nom/CJK renderings are never folded.
//
// `allowSingleWordContainment` extends that containment check to single-word needles too (e.g.
// "not" folds into "not correct") -- callers only pass true once a group already has several
// other senses for the same headword, so a lone short word like "đi" -> "go" is never at risk of
// being swallowed by an unrelated "go away (imperative)" sense that happens to start with it.
function isRedundantVariant(a, b, allowSingleWordContainment) {
  if (!isAsciiText(a) || !isAsciiText(b)) {
    return false;
  }
  const tokensA = synonymTokens(a);
  const tokensB = synonymTokens(b);
  return tokensA.some((tokenA) =>
    tokensB.some((tokenB) => isSynonymMatch(tokenA, tokenB, allowSingleWordContainment))
  );
}

// Two senses are eligible to fold together when their pos tags agree, or either side simply
// has none recorded -- an empty pos never asserts "this is a different part of speech", so it
// must not block folding a bare hand-maintained gloss (pos "") into vnedict2.json's tagged one
// (e.g. "smile" folds into the existing "to smile" (pos "verb")). Two distinct non-empty tags
// (e.g. "n" vs "v") still keep their senses apart.
function posCompatible(a, b) {
  return a === b || a === '' || b === '';
}

// See `allowSingleWordContainment` on `isRedundantVariant`.
const MIN_SENSES_FOR_SINGLE_WORD_FOLD = 3;

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

      // A group with several senses already (e.g. a Nom rendering plus two or more distinct
      // English glosses) can afford to fold a lone generic word like "not" into a longer sense
      // that already contains it ("not correct") -- see `isRedundantVariant`'s
      // `allowSingleWordContainment` parameter for the "go"/"go away (imperative)" false
      // positive this stays off for otherwise.
      const allowSingleWordContainment = group.senseOrder.length >= MIN_SENSES_FOR_SINGLE_WORD_FOLD;

      // Fold plural/case variants of an already-kept, pos-compatible sense into a single entry,
      // keeping whichever text carries more bundled synonyms (see `synonymTokens`) -- e.g.
      // "other, different person, people" (3) beats "others" (1) even though it isn't the
      // longer string by some other measure, so a single matching token never lets a shorter
      // bundle evict a richer one. Ties (most commonly two single-token defs, e.g.
      // "rumor"/"Rumors") fall back to raw text length. Whichever pos tag is non-empty wins,
      // since an empty tag carries no information to keep.
      const variantIndex = group.senseOrder.findIndex(
        (sense) => posCompatible(sense.pos, pos)
          && isRedundantVariant(sense.def, def, allowSingleWordContainment)
      );
      if (variantIndex !== -1) {
        const existing = group.senseOrder[variantIndex];
        group.senseSeen.add(senseKey);
        const richnessDef = synonymTokens(def).length;
        const richnessExisting = synonymTokens(existing.def).length;
        const defWins = richnessDef !== richnessExisting
          ? richnessDef > richnessExisting
          : def.length > existing.def.length;
        const mergedDef = defWins ? def : existing.def;
        const mergedPos = existing.pos !== '' ? existing.pos : pos;
        group.senseOrder[variantIndex] = {def: mergedDef, pos: mergedPos, headword: existing.headword};
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
    const allowSingleWordContainment = actualList.length >= MIN_SENSES_FOR_SINGLE_WORD_FOLD;
    for (const {def, pos} of expectedList) {
      const senseKey = definitionKey(def, pos);
      const reachable = actualList.some((sense) =>
        definitionKey(sense.def, sense.pos) === senseKey
          || (posCompatible(sense.pos, pos) && isRedundantVariant(sense.def, def, allowSingleWordContainment))
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
