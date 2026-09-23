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
// INSIDE a parenthetical note (e.g. "translation (of a book, etc.)") or a bracketed classifier
// note (e.g. "[CL for ears of corn, cabbages]") is not a synonym separator though, so splitting
// on every comma blindly would tear that single note into two garbage fragments and silently
// break every comparison against it -- worse, a fragment like "[CL for ears of corn" then looks
// like it contains the real, unrelated sense "corn" as a plain word, which previously caused a
// standalone "corn" sense to be wrongly folded away entirely. Only commas outside both `()` and
// `[]` count as separators.
function synonymTokens(def) {
  const tokens = [];
  let parenDepth = 0;
  let bracketDepth = 0;
  let current = '';
  for (const ch of def) {
    if (ch === '(') {
      parenDepth += 1;
    } else if (ch === ')') {
      parenDepth = Math.max(0, parenDepth - 1);
    } else if (ch === '[') {
      bracketDepth += 1;
    } else if (ch === ']') {
      bracketDepth = Math.max(0, bracketDepth - 1);
    }
    if (ch === ',' && parenDepth === 0 && bracketDepth === 0) {
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

// Strips trailing sentence punctuation ("."/"!"/"?") so "happened." compares equal to "happen" --
// a hand-maintained explain value is sometimes phrased as a full sentence, and every containment
// and suffix check in this module anchors on the exact end of the string (`$`), so a stray period
// silently defeats them all otherwise.
function stripTrailingPunctuation(word) {
  return word.replace(/[.!?]+\s*$/, '').trim();
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

// Splits a phrase into its whitespace-separated words.
// Splits a phrase into its whitespace-separated words. Deliberately NOT hyphen-aware: a
// hyphenated compound is one word for `isMultiWord`'s purposes, and `containsAsPrefixWord`/
// `containsAsSuffixWord` below additionally try its hyphen-parts on their own (see
// `hyphenPartsOf`) without this function itself tearing every "left-handed" into "left" + "handed"
// -- doing that here breaks whole-compound matches like "left-handed" against "Left-handed".
function wordsOf(phrase) {
  return phrase.split(/\s+/).filter(Boolean);
}

// Splits a single word on internal hyphens -- "ratio-score" -> ["ratio", "score"] -- so a needle
// like "Ratio" can still recognize itself as the first half of a hyphenated compound, without
// requiring the whole compound to match.
function hyphenPartsOf(word) {
  return word.split('-').filter(Boolean);
}

// True when `word` and `boundaryWord` (the first or last word of some phrase) are the same word
// modulo case, or one is a regular suffixed form of the other (see `isSuffixedFormOf`) -- so
// "call" recognizes "calling" as its own edge word, not just literal "call"/"calls".
function isSameEdgeWord(word, boundaryWord) {
  return word === boundaryWord
    || isSuffixedFormOf(word, boundaryWord)
    || isSuffixedFormOf(boundaryWord, word);
}

// True when `needle` matches `boundaryWord` outright (see `isSameEdgeWord`), or `boundaryWord`
// is a hyphenated compound whose first or last half matches `needle` -- e.g. "Ratio" recognizes
// itself as the leading half of "ratio-score" without requiring the whole compound to match,
// while a needle that matches the WHOLE compound (e.g. "left-handed" against "Left-handed")
// still works via the plain `isSameEdgeWord` check first, so a genuinely single compound word is
// never forced apart just because it happens to contain a hyphen.
function isSameEdgeWordOrHyphenPart(needle, boundaryWord) {
  if (isSameEdgeWord(needle, boundaryWord)) {
    return true;
  }
  const parts = hyphenPartsOf(boundaryWord);
  if (parts.length < 2) {
    return false;
  }
  return isSameEdgeWord(needle, parts[0]) || isSameEdgeWord(needle, parts[parts.length - 1]);
}

// True when `needle` is the very first word of `haystack`, or a suffixed/hyphen-part form of it
// (see `isSameEdgeWordOrHyphenPart`) -- e.g. "until" prefixes "until when". A word that OPENS a
// phrase is almost always that phrase's head concept regardless of the phrase's grammar (a verb
// phrase like "rescue from danger" is headed by its leading verb; so is a phrase like
// "until when"), so `isEdgeWordOf` below trusts a single prefix hit outright, unlike a suffix hit
// (see `containsAsSuffixWord`).
function containsAsPrefixWord(haystack, needle) {
  return isSameEdgeWordOrHyphenPart(needle, wordsOf(haystack)[0] || '');
}

// True when `needle` is the very last word of `haystack`, or a suffixed/hyphen-part form of it
// (see `isSameEdgeWordOrHyphenPart`) -- e.g. "not" is a suffix of "there is not", "call"
// recognizes "calling" as a suffix of "a voice calling", and "Ratio" recognizes itself inside
// "rate, ratio-score". A word that CLOSES a phrase is ambiguous: for a noun phrase (modifier +
// head noun, e.g. "street corner") the last word is the head and safe to match, but for a verb
// phrase (verb + adverb, e.g. "understand clearly") it is usually a modifier of the word before
// it, not a restatement -- there is no cheap way to tell those two shapes apart from the string
// alone, so `isEdgeWordOf` only trusts a suffix hit once it repeats across at least two of the
// other side's alternate glosses (strong independent corroboration that the word really is the
// shared core, not one phrase's specific modifier).
function containsAsSuffixWord(haystack, needle) {
  const words = wordsOf(haystack);
  return isSameEdgeWordOrHyphenPart(needle, words[words.length - 1] || '');
}

// True when `needle` occurs as a whole word inside `haystack` but NOT at the very start or end
// -- e.g. "middleman" inside "to act as a middleman or go-between". A word buried in the middle
// of an unrelated phrase is the weakest position of the three (neither the phrase's likely head
// nor even its most prominent modifier), so `isEdgeWordOf` always requires it to repeat across
// two sibling glosses, regardless of whether the word itself is on the risky list.
function containsAsMiddleWord(haystack, needle) {
  const words = wordsOf(haystack);
  return words
    .slice(1, -1)
    .some((word) => isSameEdgeWordOrHyphenPart(needle, word));
}

// Regular English suffixes that turn one word into a related one without changing its core
// meaning enough to count as a different gloss: plural "s"/"es" ("rumor"/"Rumors"), the
// adjective-to-adverb "ly" ("recent"/"Recently"), the verb-to-gerund "ing" ("block"/"blocking"),
// the verb-to-past-participle "ed" ("arrest"/"Arrested"), and the "'s" contraction/possessive
// ("what"/"what's").
const RELATED_WORD_SUFFIXES = ['s', 'es', 'ly', 'ing', 'ed', "'s"];

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
  const variantsX = parenVariants(stripTrailingPunctuation(stripToPrefix(x.toLowerCase())));
  const variantsY = parenVariants(stripTrailingPunctuation(stripToPrefix(y.toLowerCase())));
  return variantsX.some((nx) => variantsY.some((ny) => coreSynonymMatch(nx, ny)));
}

// Suffix words that stay gated to two independent sibling hits even though most words are
// trusted at one (see `isEdgeWordOf`): adverbs (the "-ly" test) and common prepositions/particles
// that form phrasal verbs, where the trailing word changes the whole phrase's meaning rather than
// restating its head -- "pass by" is not "by", "cross over" is not "over", the way "street
// corner" really is a kind of "corner". Both are single-hit false positives found by running the
// dictionary-redundancy-review audit against the real dictionary and reading what it flagged.
const RISKY_SUFFIX_WORDS = new Set([
  'by', 'up', 'in', 'out', 'on', 'off', 'over', 'away', 'through', 'along', 'about'
]);

function isRiskySuffixWord(word) {
  return word.endsWith('ly') || RISKY_SUFFIX_WORDS.has(word);
}

// Semantically empty/placeholder verbs: when one directly precedes a suffix adverb ("act
// suddenly"), the adverb itself carries the phrase's whole meaning, unlike a real content verb
// ("understand clearly", "inform respectfully"), which stays the core while the adverb merely
// describes how it is done.
const GENERIC_VERBS_BEFORE_ADVERB = new Set(['act', 'do', 'be', 'get', 'become', 'feel', 'seem', 'sound', 'look']);

// Personal pronouns: "I personally", "he genuinely" is a bare pronoun-plus-adverb mini-clause
// (typically short for "I personally [feel/think]", the verb left implicit) rather than a real
// verb being modified, so the adverb is the phrase's core meaning here too.
const PRONOUNS_BEFORE_ADVERB = new Set(['i', 'you', 'he', 'she', 'it', 'we', 'they']);

function isSuffixRiskyIn(word, sibling) {
  if (!word.endsWith('ly')) {
    return RISKY_SUFFIX_WORDS.has(word);
  }
  const words = wordsOf(sibling);
  const precedingWord = words.length >= 2 ? words[words.length - 2] : '';
  return !GENERIC_VERBS_BEFORE_ADVERB.has(precedingWord) && !PRONOUNS_BEFORE_ADVERB.has(precedingWord);
}

// True when `word` (a single word, already normalized) is trustworthy as a stand-in for one of
// `siblingTokens` (the other side's synonym-token list, normalized the same way): it opens at
// least one of them (see `containsAsPrefixWord`; a single hit is enough -- "rescue" heads
// "rescue from danger", "until" heads "until when"), or it closes at least one of them and that
// occurrence is not itself risky (see `containsAsSuffixWord`/`isSuffixRiskyIn`; "Servant" safely
// closes "trusted servant" on a single hit, and "suddenly" safely closes "to act suddenly"
// because "act" is a placeholder verb, but a risky occurrence like "clearly" closing "understand
// clearly" (a real content verb) or "by" closing "pass by" (a phrasal verb) needs two independent
// hits instead). A lone unbundled def can never reach two sibling suffix hits at all, so a
// coincidental last-word match on a single, unrelated phrase never folds a risky word either way.
function isEdgeWordOf(word, siblingTokens) {
  if (isMultiWord(word)) {
    return false;
  }
  if (siblingTokens.some((sibling) => containsAsPrefixWord(sibling, word))) {
    return true;
  }
  let riskySuffixHits = 0;
  let middleHits = 0;
  for (const sibling of siblingTokens) {
    if (containsAsSuffixWord(sibling, word)) {
      if (!isSuffixRiskyIn(word, sibling)) {
        return true;
      }
      riskySuffixHits += 1;
      if (riskySuffixHits >= 2) {
        return true;
      }
      continue;
    }
    // A word buried in the middle of a phrase (see `containsAsMiddleWord`) is weaker evidence
    // than either edge, so a risky word (see `isRiskySuffixWord`) still needs two corroborating
    // siblings there too -- e.g. "middleman" inside "to act as a middleman or go-between" would
    // need a second bundled synonym that also contains it as a plain word before this counts it
    // as the shared core. A non-risky word is trusted at one hit, the same as at the edges: "get
    // close to" and "close, tight" share the plain word "close" regardless of where in the phrase
    // it happens to sit.
    if (containsAsMiddleWord(sibling, word)) {
      middleHits += 1;
      if (middleHits >= (isRiskySuffixWord(word) ? 2 : 1)) {
        return true;
      }
    }
  }
  return false;
}

// Drops a parenthetical entirely (see `dropParens`) rather than trying both readings the way
// `parenVariants` does: the prefix/suffix/middle-word checks that consume this need a single bare
// head word to test ("appeal" from "appeal (legal)"), and treating the parenthetical's content as
// extra trailing words here would make the whole token look multi-word and disqualify it from
// single-word matching entirely, even when the head word alone is a perfectly good match.
function normalizeForEdge(token) {
  return dropParens(stripTrailingPunctuation(stripToPrefix(token.toLowerCase())));
}

// True when `word` (a single normalized word) is trustworthy as a stand-in for `hostToken`
// (exactly one other token, already normalized) on its own -- no repetition available, so a
// risky word (see `isRiskySuffixWord`) is never trusted here even once. Used only by
// `isFullyCoveredBundle`, where the corroboration comes from every OTHER word of the candidate
// bundle independently finding a home too, not from this one word repeating.
function isEdgeWordOfSingleToken(word, hostToken) {
  if (isMultiWord(word)) {
    return false;
  }
  if (containsAsPrefixWord(hostToken, word)) {
    return true;
  }
  if (containsAsSuffixWord(hostToken, word)) {
    return !isSuffixRiskyIn(word, hostToken);
  }
  if (isRiskySuffixWord(word)) {
    return false;
  }
  return containsAsMiddleWord(hostToken, word);
}

// True when `token` (original casing) is accounted for somewhere in `hostTokens` (original
// casing): either as a whole synonym match (see `isSynonymMatch`) or, if `token` is a single
// word, as a trusted single-occurrence edge/middle word of some host token (see
// `isEdgeWordOfSingleToken`).
function isTokenCoveredByBundle(token, hostTokens) {
  if (hostTokens.some((host) => isSynonymMatch(token, host))) {
    return true;
  }
  const normToken = normalizeForEdge(token);
  if (isMultiWord(normToken)) {
    return false;
  }
  return hostTokens.some((host) => isEdgeWordOfSingleToken(normToken, normalizeForEdge(host)));
}

// True when EVERY token of `candidateTokens` (at least two of them) is covered by some token of
// `hostTokens` (see `isTokenCoveredByBundle`) -- e.g. "sharp, biting, cutting" is not fully
// covered by "feeling a sharp pain, feeling a biting cold" (nothing there covers "cutting", so
// this correctly stays false: that candidate bundle is adding real content, not just restating),
// but a candidate bundle where every single word finds a home is redundant as a whole even
// though no individual word repeats twice -- each word covering a *different* host token is
// itself the corroboration that isolated single-word matching alone cannot see.
function isFullyCoveredBundle(candidateTokens, hostTokens) {
  return candidateTokens.length >= 2
    && candidateTokens.every((token) => isTokenCoveredByBundle(token, hostTokens));
}

// True when some synonym token of `a` and some synonym token of `b` are the same gloss: modulo
// case, a plural suffix, or multi-word phrase containment (see `isSynonymMatch`) -- e.g. "others"
// is redundant with "other, different person, people" because "other" is one of its bundled
// synonyms, and "on the side" is redundant with "on the side of, on the part of" because it is a
// prefix of the first bundled synonym -- or because a single word from one side is a repeated
// edge word across the other side's own bundle (see `isEdgeWordOf`) -- e.g. "not" folds into
// "there is not, there are not", and "until" folds into "until when, until that time" -- or
// because every token on one side, taken together, is covered by the other side even without any
// single word repeating (see `isFullyCoveredBundle`). Restricted to plain ASCII text (see
// `isAsciiText`) so Chu Nom/CJK renderings are never folded.
function isRedundantVariant(a, b) {
  if (!isAsciiText(a) || !isAsciiText(b)) {
    return false;
  }
  const tokensA = synonymTokens(a);
  const tokensB = synonymTokens(b);
  if (tokensA.some((tokenA) => tokensB.some((tokenB) => isSynonymMatch(tokenA, tokenB)))) {
    return true;
  }
  if (isFullyCoveredBundle(tokensA, tokensB) || isFullyCoveredBundle(tokensB, tokensA)) {
    return true;
  }
  const normA = tokensA.map(normalizeForEdge);
  const normB = tokensB.map(normalizeForEdge);
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

      // Fold plural/case variants of every already-kept, pos-compatible sense this candidate is
      // redundant with -- not just the first one found. A candidate can independently match two
      // separate existing senses (e.g. "to furnish, supply, provide" matches both the earlier,
      // unrelated-looking "supply (in a market)" via "supply" and the earlier, exact "provide"
      // sense via "provide"); folding only into the first match would silently leave the second
      // one behind as an orphaned duplicate.
      const matchIndices = [];
      group.senseOrder.forEach((sense, index) => {
        if (posCompatible(sense.pos, pos) && isRedundantVariant(sense.def, def)) {
          matchIndices.push(index);
        }
      });
      if (matchIndices.length > 0) {
        group.senseSeen.add(senseKey);
        // Across the candidate and every matched existing sense, keep whichever text carries
        // more bundled synonyms (see `synonymTokens`) -- e.g. "other, different person, people"
        // (3) beats "others" (1) even though it isn't the longer string by some other measure,
        // so a single matching token never lets a shorter bundle evict a richer one. Ties (most
        // commonly two single-token defs, e.g. "rumor"/"Rumors") fall back to raw text length.
        // Whichever pos tag is non-empty wins, since an empty tag carries no information to keep.
        let winnerDef = def;
        let winnerPos = pos;
        for (const index of matchIndices) {
          const existing = group.senseOrder[index];
          const richnessWinner = synonymTokens(winnerDef).length;
          const richnessExisting = synonymTokens(existing.def).length;
          const winnerWins = richnessWinner !== richnessExisting
            ? richnessWinner > richnessExisting
            : winnerDef.length > existing.def.length;
          if (!winnerWins) {
            winnerDef = existing.def;
          }
          if (winnerPos === '' && existing.pos !== '') {
            winnerPos = existing.pos;
          }
        }
        // The winner is only guaranteed redundant with whichever sense(s) it came from -- two
        // existing senses can each independently match the CANDIDATE (e.g. "không phải"'s "not"
        // matches both "there is not, there are not" and, separately, "not correct") without
        // being redundant with EACH OTHER. Collapsing every matched index into one slot
        // regardless would silently merge two genuinely distinct senses just because a bridging
        // candidate happened to touch both. Only an index the final winner still covers is safe
        // to remove; the rest are left exactly as they were, and only the candidate is dropped.
        const removableIndices = matchIndices.filter((index) => {
          const existingDef = group.senseOrder[index].def;
          return existingDef === winnerDef || isRedundantVariant(winnerDef, existingDef);
        });
        const firstIndex = removableIndices[0];
        const keptHeadword = group.senseOrder[firstIndex].headword;
        group.senseOrder[firstIndex] = {def: winnerDef, pos: winnerPos, headword: keptHeadword};
        // Remove every OTHER removable sense (descending order so earlier indices stay valid).
        for (let i = removableIndices.length - 1; i >= 1; i--) {
          group.senseOrder.splice(removableIndices[i], 1);
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
