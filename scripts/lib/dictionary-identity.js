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
// "other, different person, people"), each a candidate atomic gloss in its own right. A comma
// INSIDE a parenthetical note (e.g. "translation (of a book, etc.)") is not a synonym separator
// though, so splitting on every comma blindly would tear that single gloss into two garbage
// fragments ("translation (of a book" / "etc.)") and silently break every comparison against
// it. Only commas at paren-depth 0 count as separators.
function synonymTokens(def) {
  const tokens = [];
  let depth = 0;
  let current = '';
  for (const ch of def) {
    if (ch === '(') {
      depth += 1;
    } else if (ch === ')') {
      depth = Math.max(0, depth - 1);
    }
    if (ch === ',' && depth === 0) {
      tokens.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  tokens.push(current.trim());
  return tokens.filter(Boolean);
}

// Strips a leading English infinitive marker ("to ") so "to smile" and "smile" compare equal --
// vnedict2.json glosses a verb as "to <verb>" while a hand-maintained explain column tends to
// give the bare word.
function stripToPrefix(word) {
  return word.replace(/^to\s+/i, '');
}

// Drops parenthesis characters (keeping their contents in place) and collapses the resulting
// whitespace, so "English (language)" and "English language" compare equal -- a parenthetical
// note is usually just a clarifying aside on the same headword, not a different gloss.
function stripParens(word) {
  return word.replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Drops an entire "(...)" span, so "user (person)" reduces to its head word "user" -- unlike
// `stripParens`, which keeps the parenthetical's content as an extra word. Both readings matter:
// "English (language)" should compare equal to "English language" (content kept), while
// "user (person)" should still compare equal to "Users" via the plural suffix on its bare head
// word (content dropped). `parenVariants` below tries both.
function dropParens(word) {
  return word.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
}

// Every way a token's parenthetical (if any) is worth reading for comparison purposes: with its
// content folded in ("user (person)" -> "user person") and with it dropped entirely
// ("user (person)" -> "user"). A token with no parens has just the one reading.
function parenVariants(word) {
  const kept = stripParens(word);
  const dropped = dropParens(word);
  return dropped === kept ? [kept] : [kept, dropped];
}

// True when `token` is a multi-word phrase rather than a single word. Phrase containment (see
// below) is trustworthy for multi-word needles unconditionally: a single short word like "go"
// is often the first word of an unrelated, longer phrase ("go away (imperative)"), so a lone
// single-word needle instead goes through the narrower, repetition-gated check in
// `isRedundantVariant`.
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

// Like `containsAsPhrase`, but only at the very start or the very end of `haystack` -- e.g.
// "not" is a prefix of "not correct" and a suffix of "there is not". Used only from
// `isEdgeWordOf`, which additionally requires the needle to repeat across several of the
// haystack bundle's sibling tokens (see `isRedundantVariant`) before trusting a single-word
// match at all.
function containsAsEdgeWord(haystack, needle) {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const prefixPattern = new RegExp(`^${escaped}(es|s)?($|[^a-zA-Z0-9])`, 'i');
  const suffixPattern = new RegExp(`(^|[^a-zA-Z0-9])${escaped}$`, 'i');
  return prefixPattern.test(haystack) || suffixPattern.test(haystack);
}

// Regular English suffixes that turn one word into a related one without changing its core
// meaning enough to count as a different gloss: plural "s"/"es" ("rumor"/"Rumors"), the
// adjective-to-adverb "ly" ("recent"/"Recently"), the verb-to-gerund "ing" ("block"/"blocking"),
// and the verb-to-past-participle "ed" ("arrest"/"Arrested").
const RELATED_WORD_SUFFIXES = ['s', 'es', 'ly', 'ing', 'ed'];

// Suffixes in `RELATED_WORD_SUFFIXES` that a verb ending in a silent "e" takes without that "e"
// -- "include" -> "including" (not "includeing"), "base" -> "based" (not "baseed").
const SILENT_E_SUFFIXES = ['ing', 'ed'];

// True when `root` plus a suffix from `RELATED_WORD_SUFFIXES` equals `variant`, including the
// silent-"e" spelling (see `SILENT_E_SUFFIXES`) that plain concatenation alone would miss.
function isSuffixedFormOf(root, variant) {
  if (RELATED_WORD_SUFFIXES.some((suffix) => `${root}${suffix}` === variant)) {
    return true;
  }
  if (!root.endsWith('e')) {
    return false;
  }
  const stem = root.slice(0, -1);
  return SILENT_E_SUFFIXES.some((suffix) => `${stem}${suffix}` === variant);
}

// Splits a phrase into its whitespace-separated words.
function wordsOf(phrase) {
  return phrase.split(/\s+/).filter(Boolean);
}

// True when `a` and `b` are the same multi-word phrase except for exactly one word position,
// where the two words there are a suffix variant of each other (see `isSuffixedFormOf`) -- e.g.
// "base on" / "based on" (word 0 differs by "-ed"; "on" matches). `isSuffixedFormOf` alone only
// compares two whole tokens, so it cannot see this: "base on" as a whole is not a suffixed form
// of "based on" as a whole, only its first word is.
function isPhraseSuffixVariant(a, b) {
  const wordsA = wordsOf(a);
  const wordsB = wordsOf(b);
  if (wordsA.length < 2 || wordsA.length !== wordsB.length) {
    return false;
  }
  let suffixedWordCount = 0;
  for (let i = 0; i < wordsA.length; i++) {
    if (wordsA[i] === wordsB[i]) {
      continue;
    }
    if (!isSuffixedFormOf(wordsA[i], wordsB[i]) && !isSuffixedFormOf(wordsB[i], wordsA[i])) {
      return false;
    }
    suffixedWordCount += 1;
  }
  return suffixedWordCount === 1;
}

// The actual per-reading comparison `isSynonymMatch` runs for every combination of `x`'s and
// `y`'s parenthetical readings (see `parenVariants`): equal outright, a regular suffix
// relationship between the two whole tokens (see `isSuffixedFormOf`) or between corresponding
// words of an otherwise-identical phrase (see `isPhraseSuffixVariant`), or a multi-word phrase
// wholly contained in the other at any position (see `containsAsPhrase`; e.g. "on the side" in
// "on the side of"). A single-word needle is deliberately NOT checked here at all -- see
// `isEdgeWordOf` for why it needs a stricter, repetition-gated check instead of plain
// containment.
function coreSynonymMatch(nx, ny) {
  if (nx === ny || isSuffixedFormOf(nx, ny) || isSuffixedFormOf(ny, nx)) {
    return true;
  }
  if (isPhraseSuffixVariant(nx, ny)) {
    return true;
  }
  if (isMultiWord(ny) && containsAsPhrase(nx, ny)) {
    return true;
  }
  return isMultiWord(nx) && containsAsPhrase(ny, nx);
}

// True when two synonym tokens are effectively the same gloss under any reading of their
// parentheses (see `parenVariants`) -- e.g. "English (language)" == "English language" (content
// kept) and "user (person)" == "Users" via the plural suffix on its bare head word "user"
// (content dropped) -- after stripping a leading "to " infinitive marker from both sides (see
// `coreSynonymMatch` for the comparison itself).
function isSynonymMatch(x, y) {
  const variantsX = parenVariants(stripToPrefix(x.toLowerCase()));
  const variantsY = parenVariants(stripToPrefix(y.toLowerCase()));
  return variantsX.some((nx) => variantsY.some((ny) => coreSynonymMatch(nx, ny)));
}

// True when `word` (a single word, already normalized) is a prefix or suffix word of at least
// two of `siblingTokens` (the other side's synonym-token list, normalized the same way) -- e.g.
// "not" is a suffix of both "there is not" and "there are not", and "until" is a prefix of both
// "until when" and "until that time". Requiring at least two hits is what distinguishes a
// candidate word that is genuinely the shared root of several bundled synonyms from one that
// merely happens to start or end a single, unrelated phrase -- "clearly" is a suffix of only one
// token in "to know well, understand clearly" (it modifies "understand" there, not a restatement
// of "clearly, distinctly"), and a lone unbundled def like "go away (imperative)" can never
// reach two sibling hits at all, so "go" does not fold into it.
function isEdgeWordOf(word, siblingTokens) {
  if (isMultiWord(word)) {
    return false;
  }
  let hits = 0;
  for (const sibling of siblingTokens) {
    if (containsAsEdgeWord(sibling, word)) {
      hits += 1;
      if (hits >= 2) {
        return true;
      }
    }
  }
  return false;
}

// True when some synonym token of `a` and some synonym token of `b` are the same gloss: modulo
// case, a plural suffix, or multi-word phrase containment (see `isSynonymMatch`) -- e.g. "others"
// is redundant with "other, different person, people" because "other" is one of its bundled
// synonyms, and "on the side" is redundant with "on the side of, on the part of" because it is a
// prefix of the first bundled synonym -- or because a single word from one side is a repeated
// edge word across the other side's own bundle (see `isEdgeWordOf`) -- e.g. "not" folds into
// "there is not, there are not", and "until" folds into "until when, until that time". Restricted
// to plain ASCII text (see `isAsciiText`) so Chu Nom/CJK renderings are never folded.
function isRedundantVariant(a, b) {
  if (!isAsciiText(a) || !isAsciiText(b)) {
    return false;
  }
  const tokensA = synonymTokens(a);
  const tokensB = synonymTokens(b);
  if (tokensA.some((tokenA) => tokensB.some((tokenB) => isSynonymMatch(tokenA, tokenB)))) {
    return true;
  }
  const normalize = (token) => stripToPrefix(token.toLowerCase());
  const normA = tokensA.map(normalize);
  const normB = tokensB.map(normalize);
  return normA.some((word) => isEdgeWordOf(word, normB))
    || normB.some((word) => isEdgeWordOf(word, normA));
}

// Two senses are eligible to fold together when their pos tags agree, or either side simply
// has none recorded -- an empty pos never asserts "this is a different part of speech", so it
// must not block folding a bare hand-maintained gloss (pos "") into vnedict2.json's tagged one
// (e.g. "smile" folds into the existing "to smile" (pos "verb")). Two distinct non-empty tags
// (e.g. "n" vs "v") still keep their senses apart.
function posCompatible(a, b) {
  return a === b || a === '' || b === '';
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

      // Fold plural/case variants of an already-kept, pos-compatible sense into a single entry,
      // keeping whichever text carries more bundled synonyms (see `synonymTokens`) -- e.g.
      // "other, different person, people" (3) beats "others" (1) even though it isn't the
      // longer string by some other measure, so a single matching token never lets a shorter
      // bundle evict a richer one. Ties (most commonly two single-token defs, e.g.
      // "rumor"/"Rumors") fall back to raw text length. Whichever pos tag is non-empty wins,
      // since an empty tag carries no information to keep.
      const variantIndex = group.senseOrder.findIndex(
        (sense) => posCompatible(sense.pos, pos) && isRedundantVariant(sense.def, def)
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
    for (const {def, pos} of expectedList) {
      const senseKey = definitionKey(def, pos);
      const reachable = actualList.some((sense) =>
        definitionKey(sense.def, sense.pos) === senseKey
          || (posCompatible(sense.pos, pos) && isRedundantVariant(sense.def, def))
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
