'use strict';

// A manual, opt-in audit: scans the WHOLE real dictionary (vnedict2.json plus every
// hand-maintained user_nom_entries shard) for English glosses within the same headword that
// still look like near-duplicates after `groupEntries`' own folding -- e.g. the "chặn" entry
// once carried both "blocking" and "to block, stop" side by side, and "cho đến khi" once carried
// both "until" and "until when, until that time". Each of those was found and fixed by hand, one
// at a time; this test exists so the next one does not have to be found that way.
//
// It deliberately runs a LOOSER, independent redundancy check than
// `scripts/lib/dictionary-identity.js`'s own `isRedundantVariant` -- plain word-boundary
// containment in either position, with no repetition gate -- so it also surfaces cases the
// production heuristic is deliberately conservative about (single-word containment normally
// requires the word to repeat across at least two sibling synonyms; see that module's
// `isEdgeWordOf`) and also re-derives its own copy of the plural/-ly/-ing/-ed suffix table and
// word-by-word phrase comparison (`isSuffixedFormOf`/`isPhraseSuffixVariant` below) so a gap
// there (e.g. "base on" vs "based on", once missed because "-ed" was not yet a known suffix)
// shows up here even before `dictionary-identity.js` itself is taught the fix. Running this over
// the real dictionary today turns up well over a thousand pairs, and reading them shows most are
// genuine: a hand-maintained `explain` value that just restates an existing vnedict2.json gloss
// in different, unpredictable English (real synonymy, not a fixed spelling pattern, so
// `dictionary-identity.js` cannot safely auto-fold them without risking real false merges
// elsewhere). Fixing that content is a data-curation job for the `/add-chu-nom` workflow (per
// AGENTS.md, `user_nom_entries/` is never hand-edited outside it), not something this test can
// or should do by rewriting the algorithm further.
//
// So instead of asserting zero findings -- which would fail on that entire pre-existing backlog
// every single run -- this test snapshots today's findings into
// `dictionary-redundancy-known-findings.json` and only fails on findings that are NOT in that
// snapshot: a brand new pair introduced by a future edit. That is what "unexpected" means here.
// To accept the current findings as the new baseline (after reviewing them -- most are real,
// pending curation; a few, like "rõ", are deliberate and simply belong in the snapshot forever),
// run:
//
//   ZD_REVIEW_DICTIONARY=1 ZD_REVIEW_UPDATE_BASELINE=1 node --test test/dictionary-redundancy-review.test.js
//
// Otherwise, just review it:
//
//   ZD_REVIEW_DICTIONARY=1 node --test test/dictionary-redundancy-review.test.js

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const {groupEntries} = require('../scripts/lib/dictionary-identity');
const {readUserNomEntries, toDictionaryEntries} = require('../scripts/user-nom-entries');
const {readJson} = require('../scripts/lib/sources');
const repoPaths = require('../scripts/lib/paths');

const BASELINE_PATH = path.join(__dirname, 'dictionary-redundancy-known-findings.json');

function isAsciiText(str) {
  return /^[\x00-\x7f]*$/.test(str);
}

// Paren- and bracket-depth-aware, unlike a plain `split(',')` -- a comma inside a parenthetical
// note (e.g. "translation (of a book, etc.)") or a bracketed classifier note (e.g.
// "[CL for ears of corn, cabbages]") is not a synonym separator. Kept in sync with
// `scripts/lib/dictionary-identity.js`'s `synonymTokens` deliberately; this audit's whole
// premise is finding gaps in that module's *matching* rules, not its tokenizing.
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

// Deliberately looser than `scripts/lib/dictionary-identity.js`'s `stripToPrefix`/`dropParens`:
// folds every reading into one normalized form instead of trying each combination, since this
// check only needs to decide "worth a human look", not "safe to merge automatically".
function normalize(token) {
  return token
    .toLowerCase()
    .replace(/^to\s+/, '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Word-boundary containment at either position, with no repetition gate -- looser than
// production on purpose (see file header). A needle under 4 characters is excluded: short
// function words ("to", "in", "of", "by", "at", "on", "or", "no") are extremely common word
// fragments of otherwise-unrelated phrases ("to, for" / "in order to" both contain "to"), and
// without production's repetition-across-siblings gate they would drown every real finding in
// noise.
const MIN_LOOSE_NEEDLE_LENGTH = 4;

// Regular English suffixes a word can take without becoming a different gloss, plus the
// silent-"e" spelling for "-ing"/"-ed" ("base" -> "based", not "baseed"). Kept in sync with
// `scripts/lib/dictionary-identity.js`'s own table on purpose: this audit's job is to catch
// gaps in that module's *matching* rules (containment, phrase structure), not to reinvent which
// suffixes are "regular" English -- but it must not simply import that module's function,
// because the whole point of a second, independent implementation is to catch a typo or logic
// slip in the first one, not share it.
const RELATED_WORD_SUFFIXES = ['s', 'es', 'ly', 'ing', 'ed'];
const SILENT_E_SUFFIXES = ['ing', 'ed'];

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
// where the two words there are a suffix variant of each other -- e.g. "base on" / "based on".
// Plain substring containment (`looseContains` below) cannot see this: "base on" is not a
// literal substring of "based on" (the spelling itself changes mid-word), so a whole class of
// "same phrase, one word inflected" near-duplicates needs this word-by-word comparison instead.
function isPhraseSuffixVariant(a, b) {
  const wordsA = a.split(/\s+/).filter(Boolean);
  const wordsB = b.split(/\s+/).filter(Boolean);
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

// Semantically empty/placeholder verbs and personal pronouns: when an adverb ending in "-ly"
// directly follows one of these ("act suddenly", "I personally"), the adverb itself carries the
// phrase's whole meaning. Following a real content verb instead ("inform respectfully") it stays
// a genuine modifier of that verb, not a restatement of it -- kept in sync with
// `scripts/lib/dictionary-identity.js`'s own `isSuffixRiskyIn` deliberately, for the same reason
// its suffix table is kept in sync: this audit's job is to catch gaps in that module's matching
// rules, not to independently re-derive which words are "safe" to follow an adverb.
const GENERIC_WORDS_BEFORE_ADVERB = new Set([
  'act', 'do', 'be', 'get', 'become', 'feel', 'seem', 'sound', 'look',
  'i', 'you', 'he', 'she', 'it', 'we', 'they'
]);

function endsWithRiskyAdverb(haystack, adverb) {
  const words = haystack.split(/\s+/).filter(Boolean);
  const last = words[words.length - 1] || '';
  if (normalize(last) !== normalize(adverb)) {
    return false;
  }
  const precedingWord = words.length >= 2 ? normalize(words[words.length - 2]) : '';
  return !GENERIC_WORDS_BEFORE_ADVERB.has(precedingWord);
}

function looseContains(haystack, needle) {
  if (!needle || needle.length < MIN_LOOSE_NEEDLE_LENGTH || needle.length >= haystack.length) {
    return false;
  }
  if (needle.endsWith('ly') && endsWithRiskyAdverb(haystack, needle)) {
    return false;
  }
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(^|[^a-zA-Z0-9])${escaped}(es|s|ly|ing|ed)?($|[^a-zA-Z0-9])`, 'i');
  return pattern.test(haystack);
}

// A bracketed classifier/grammar note (e.g. "[CL for ears of corn, cabbages]") is metadata about
// how the headword is used, not a synonym gloss -- it can happen to mention the same word a real
// gloss uses ("corn"), but that is never a genuine restatement, so it must never satisfy or be
// satisfied by any coverage check.
function isClassifierNote(token) {
  return token.trim().startsWith('[');
}

function tokenMatches(tokenA, tokenB) {
  if (isClassifierNote(tokenA) || isClassifierNote(tokenB)) {
    return false;
  }
  return tokenA === tokenB
    || isSuffixedFormOf(tokenA, tokenB)
    || isSuffixedFormOf(tokenB, tokenA)
    || isPhraseSuffixVariant(tokenA, tokenB)
    || looseContains(tokenA, tokenB)
    || looseContains(tokenB, tokenA);
}

// True when EVERY token of `shortTokens` matches some token of `longTokens` -- i.e. `shortTokens`
// contributes nothing that `longTokens` does not already say. This is deliberately stricter than
// "some token pair overlaps": a pair like "sharp, biting, cutting" vs
// "feeling a sharp pain, feeling a biting cold" shares two of its three words with the other side
// but still isn't a duplicate -- "cutting" is real, additional content, so the shorter list is
// enriching the entry, not restating it. Requiring full coverage of one whole side is what tells
// "genuinely the same gloss, said differently" apart from "an overlapping but distinct list of
// synonyms", and is what keeps this audit's findings meaningful instead of flagging every pair of
// senses that merely shares a common word.
function isFullyCovered(shortTokens, longTokens) {
  return shortTokens.length > 0 && shortTokens.every((token) =>
    longTokens.some((other) => tokenMatches(token, other))
  );
}

function looseSynonymOverlap(defA, defB) {
  if (normalize(defA) === normalize(defB)) {
    return true;
  }
  const tokensA = synonymTokens(defA).map(normalize);
  const tokensB = synonymTokens(defB).map(normalize);
  return isFullyCovered(tokensA, tokensB) || isFullyCovered(tokensB, tokensA);
}

function posCompatible(a, b) {
  return a === b || a === '' || b === '';
}

function buildRealGroups() {
  const userEntries = readUserNomEntries(repoPaths.absolute.userNomEntries);
  const entries = readJson(repoPaths.absolute.dictionary).concat(toDictionaryEntries(userEntries));
  return groupEntries(entries);
}

function findLooseDuplicates(groups) {
  const findings = [];
  for (const group of groups) {
    const senses = group.en.filter((sense) => isAsciiText(sense.def));
    for (let i = 0; i < senses.length; i++) {
      for (let j = i + 1; j < senses.length; j++) {
        const a = senses[i];
        const b = senses[j];
        if (!posCompatible(a.pos, b.pos)) {
          continue;
        }
        if (!looseSynonymOverlap(a.def, b.def)) {
          continue;
        }
        findings.push({key: group.key, defA: a.def, defB: b.def});
      }
    }
  }
  return findings;
}

// Order-independent identity for a finding, so a baseline recorded as {defA, defB} still matches
// a re-run that happens to enumerate the same pair the other way round.
function findingIdentity({key, defA, defB}) {
  const [first, second] = [defA, defB].sort();
  return `${key}\u0000${first}\u0000${second}`;
}

function readBaseline() {
  if (!fs.existsSync(BASELINE_PATH)) {
    return [];
  }
  return JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
}

function writeBaseline(findings) {
  const sorted = [...findings].sort((a, b) => (findingIdentity(a) < findingIdentity(b) ? -1 : 1));
  fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(sorted, null, 2)}\n`);
}

test(
  'no headword carries a new near-duplicate English gloss beyond the reviewed baseline',
  {skip: process.env.ZD_REVIEW_DICTIONARY !== '1' && 'set ZD_REVIEW_DICTIONARY=1 to run this audit'},
  () => {
    const findings = findLooseDuplicates(buildRealGroups());

    if (process.env.ZD_REVIEW_UPDATE_BASELINE === '1') {
      writeBaseline(findings);
      return;
    }

    const knownIdentities = new Set(readBaseline().map(findingIdentity));
    const newFindings = findings.filter((finding) => !knownIdentities.has(findingIdentity(finding)));

    if (newFindings.length > 0) {
      const report = newFindings
        .map(({key, defA, defB}) => `  "${key}": "${defA}" ~ "${defB}"`)
        .join('\n');
      assert.fail(
        `${newFindings.length} new possible redundant gloss pair(s) not in the reviewed baseline:\n${report}\n\n` +
        'Either teach scripts/lib/dictionary-identity.js the pattern, or -- if reviewed and ' +
        'intentional or a pending curation item -- re-run with ZD_REVIEW_UPDATE_BASELINE=1 to ' +
        'accept it into the baseline.'
      );
    }
  }
);
