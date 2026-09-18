'use strict';

// The per-term Chu Nom *display order* layer: `zd-extension/db_src/user_nom_order.jsonc`.
//
// Base and supplemental dictionary layers merge as a union. Hand-maintained entries lead
// those lower-priority candidates, while this separate file is the final explicit override
// for correcting display order -- NOM_MAP's consumers all take candidate 0.
//
// The variants a row lists are moved to the front of that term's merged list, in the order
// given, and everything else keeps its relative order behind them. A listed variant the
// dictionaries never produced is inserted at the front rather than silently ignored, so a
// row can pin as well as reorder and is never a no-op the author has no way to notice.
//
// `vi` is the upsert key, normalized exactly like every other term in this repository
// (`normalizeTerm`). The same file is read by the book-translator reader
// (`scripts/reader/nom_order.py`), which is where rows are usually authored.
//
// A row may also carry `"caseSensitive": true` -- for a surname like "Đỗ" (read 杜 in
// Hán Việt), whose lowercase spelling "đỗ" is an ordinary, unrelated word (read 逗).
// `normalizeTerm` casefolds, so a plain row for one would otherwise apply to the other too.
// Such a row is excluded from `buildNomOrderIndex` (the casefolded table every other row
// feeds) and kept in a second table instead, keyed by its *exact* spelling
// (`buildCaseSensitiveNomOrderIndex`) -- consumed only by the nom-ruby matching engine
// (`zd-extension/js/zd-nom-match.js`), which checks it per occurrence, after a match is
// already found, exactly the way `reader.nom.NomAnnotator.annotate` does. Its variants are
// still pinned into the shared candidate list (`pinCaseSensitiveVariantsIntoNomMap`) so the
// exact spelling stays matchable/creatable -- appended, never hoisted, since hoisting here
// would apply the surname's preference to every case of the word.
//
// The popup-dictionary and browser-extension builds have no per-occurrence text to check a
// casing against (their dictionaries are static, keyed only by the casefolded term), so a
// `caseSensitive` row's only effect there is exclusion from the casefolded hoist -- it is
// never allowed to reorder those consumers' shared entry for the word, but its own reordering
// does not reach them either.

const fs = require('fs');
const {cleanText, normalizeTerm, exactKey} = require('./lib/text');
const {extractNomCandidates} = require('./lib/cjk');
const {stripJsonComments} = require('./lib/jsonc-strip');

const CANDIDATE_SEPARATOR = ' / ';

function asTextArray(value) {
  const values = Array.isArray(value) ? value : [value];
  return values.map((item) => cleanText(item)).filter(Boolean);
}

function splitCandidateText(value) {
  return String(value || '')
    .split(/\s+\/\s+/)
    .map((item) => cleanText(item))
    .filter(Boolean);
}

function parseUserNomOrder(source, sourcePath) {
  const payload = JSON.parse(stripJsonComments(source));
  const rawEntries = Array.isArray(payload) ? payload : payload.entries;

  if (!Array.isArray(rawEntries)) {
    throw new Error(`${sourcePath} must contain an array, or an object with an entries array`);
  }

  return rawEntries.map((entry, index) => {
    const vi = cleanText(entry.vi || entry.vn || entry.word);
    const nom = asTextArray(entry.nom || entry.chuNom || entry.chunom || entry.order);

    if (!vi) {
      throw new Error(`${sourcePath} entry ${index + 1} is missing vi`);
    }

    if (!nom.length) {
      throw new Error(`${sourcePath} entry ${index + 1} is missing nom`);
    }

    return {vi, key: normalizeTerm(vi), exact: exactKey(vi), nom, caseSensitive: Boolean(entry.caseSensitive)};
  });
}

function readUserNomOrder(sourcePath) {
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    return [];
  }

  return parseUserNomOrder(fs.readFileSync(sourcePath, 'utf8'), sourcePath);
}

// Last row wins, matching the reader's own upsert writer: re-ordering a term twice must
// leave one opinion on file, not two that disagree. Excludes `caseSensitive` rows -- see the
// module docstring for why those must never reach the casefolded consumers this feeds.
function buildNomOrderIndex(entries) {
  const index = new Map();
  for (const entry of entries) {
    if (entry.caseSensitive) {
      continue;
    }
    index.set(entry.key, entry.nom);
  }
  return index;
}

// The `caseSensitive` counterpart: exact spelling -> preferred variants, last row wins for
// the same exact spelling. Never merged with `buildNomOrderIndex`'s table.
function buildCaseSensitiveNomOrderIndex(entries) {
  const index = new Map();
  for (const entry of entries) {
    if (!entry.caseSensitive) {
      continue;
    }
    index.set(entry.exact, entry.nom);
  }
  return index;
}

// Every `caseSensitive` row's variants, appended (never hoisted) onto `nomMap`'s shared entry
// for the word -- the "pin, don't ignore" half of the rule, kept separate from hoisting so a
// surname's preference can never reorder the shared entry that every other case of the word
// also renders from. Call before `buildCaseSensitiveNomMap`, which hoists against the result.
function pinCaseSensitiveVariantsIntoNomMap(nomMap, entries) {
  for (const [exact, preferred] of buildCaseSensitiveNomOrderIndex(entries)) {
    const key = normalizeTerm(exact);
    const existing = splitCandidateText(nomMap[key]);
    const missing = preferred.filter((value) => !existing.includes(value));
    if (missing.length) {
      nomMap[key] = [...existing, ...missing].join(CANDIDATE_SEPARATOR);
    }
  }
}

// Exact spelling -> its own fully-hoisted candidate string -- embedded into the nom-ruby
// userscript alongside `NOM_MAP` and checked by `zdCreateNomMatcher` once per occurrence,
// after a match is already found (see zd-nom-match.js). Reads `nomMap` rather than mutating
// it: call `pinCaseSensitiveVariantsIntoNomMap` first so a variant no dictionary ever listed
// is still in the group this hoists.
function buildCaseSensitiveNomMap(nomMap, entries) {
  const result = {};
  for (const [exact, preferred] of buildCaseSensitiveNomOrderIndex(entries)) {
    const key = normalizeTerm(exact);
    const hoisted = orderPreferredFirst(splitCandidateText(nomMap[key]), preferred, (value) => value);
    if (hoisted.length) {
      result[exact] = hoisted.join(CANDIDATE_SEPARATOR);
    }
  }
  return result;
}

// The one hoist rule, shared by every consumer. Stable: rows the preference list says
// nothing about keep the order they arrived in.
//
// A grouped dictionary cell can still be ranked by one of its members. `hoistPreferredRows`
// additionally synthesizes an exact row in front of such a group, because popup/extension
// consumers display the start of the row and therefore cannot express a local override that
// is trapped in the middle of "巴|芭|𠀧|爸". The grouped source row itself stays untouched.
function orderPreferredFirst(rows, preferred, getText) {
  if (!preferred || !preferred.length) {
    return rows.slice();
  }

  const rank = new Map(preferred.map((value, position) => [value, position]));
  const scored = rows.map((row, arrival) => {
    const text = cleanText(getText(row));
    const exact = rank.get(text);
    let best = Number.POSITIVE_INFINITY;
    if (exact !== undefined) {
      best = exact;
    } else {
      for (const candidate of extractNomCandidates(text)) {
        const position = rank.get(candidate);
        if (position !== undefined && preferred.length + position < best) {
          // Every exact preference outranks every grouped/contained match. This ensures an
          // existing exact row cannot remain behind a group that happens to contain it.
          best = preferred.length + position;
        }
      }
    }
    return {row, arrival, best};
  });

  scored.sort((a, b) => (a.best - b.best) || (a.arrival - b.arrival));
  return scored.map((item) => item.row);
}

// `orderPreferredFirst` plus the "pin as well as reorder" half of the rule: a preferred
// variant no row carries is synthesized by `makeRow` and hoisted with the rest, so a
// preference is never a silent no-op. Adding a whole *term* is still
// `user_nom_entries.jsonc`'s job -- callers skip terms they have no row group for.
function hoistPreferredRows(rows, preferred, getText, makeRow) {
  if (!preferred || !preferred.length) {
    return rows.slice();
  }

  // Only an exact row satisfies a preference. A candidate merely contained in a grouped
  // row needs its own leading row so every surface displays the requested value first.
  const present = new Set(rows.map((row) => cleanText(getText(row))));
  const missing = preferred.filter((value) => !present.has(value)).map(makeRow);
  return orderPreferredFirst([...missing, ...rows], preferred, getText);
}

function applyUserNomOrderToNomMap(nomMap, entries) {
  for (const [key, preferred] of buildNomOrderIndex(entries)) {
    const hoisted = hoistPreferredRows(
      splitCandidateText(nomMap[key]),
      preferred,
      (value) => value,
      (value) => value
    );

    if (hoisted.length) {
      nomMap[key] = hoisted.join(CANDIDATE_SEPARATOR);
    }
  }
}

// The definition-list consumers: the popupdict userscript's `[def, pos]` rows and the
// extension's `{def, pos}` rows. Each build script keeps its own container shape, so this
// takes accessors rather than a container -- `rowsFor` returning undefined means the term
// isn't in that dictionary at all, which is skipped rather than invented (adding a term is
// `user_nom_entries.jsonc`'s job).
function applyUserNomOrderToDefinitions(entries, {rowsFor, setRows, getText, makeRow}) {
  for (const [key, preferred] of buildNomOrderIndex(entries)) {
    const rows = rowsFor(key);
    if (!rows) {
      continue;
    }
    setRows(key, hoistPreferredRows(rows, preferred, getText, makeRow));
  }
}

module.exports = {
  CANDIDATE_SEPARATOR,
  parseUserNomOrder,
  readUserNomOrder,
  buildNomOrderIndex,
  buildCaseSensitiveNomOrderIndex,
  pinCaseSensitiveVariantsIntoNomMap,
  buildCaseSensitiveNomMap,
  orderPreferredFirst,
  hoistPreferredRows,
  applyUserNomOrderToNomMap,
  applyUserNomOrderToDefinitions,
  splitCandidateText
};
