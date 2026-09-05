'use strict';

// The per-term Chu Nom *display order* layer: `zd-extension/db_src/user_nom_order.jsonc`.
//
// Every other dictionary layer in this repository merges as a union that only ever
// *extends* a term's candidate list (`mergeUserNomEntriesIntoNomMap`,
// `mergeExtractedNomMap`), so whichever rendering the base dictionary happened to list
// first stays the one displayed -- NOM_MAP's consumers all take candidate 0. That is the
// right rule for adding knowledge and the wrong one for correcting a preference: "ba"
// leads with 巴 (a phonetic borrowing) where 𠀧 (the ordinary Nom numeral) is wanted, and
// no amount of adding entries can move it.
//
// So this is a separate, final layer with hoist semantics rather than a flag on
// `user_nom_entries.jsonc`, whose extend-never-replace rule is deliberate and relied on:
// the variants a row lists are moved to the front of that term's merged list, in the order
// given, and everything else keeps its relative order behind them. A listed variant the
// dictionaries never produced is inserted at the front rather than silently ignored, so a
// row can pin as well as reorder and is never a no-op the author has no way to notice.
//
// `vi` is the upsert key, normalized exactly like every other term in this repository
// (`normalizeTerm`). The same file is read by the book-translator reader
// (`scripts/reader/nom_order.py`), which is where rows are usually authored.

const fs = require('fs');
const {cleanText, normalizeTerm} = require('./lib/text');
const {extractNomCandidates} = require('./lib/cjk');
const {stripJsonComments} = require('./user-nom-entries');

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

    return {vi, key: normalizeTerm(vi), nom};
  });
}

function readUserNomOrder(sourcePath) {
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    return [];
  }

  return parseUserNomOrder(fs.readFileSync(sourcePath, 'utf8'), sourcePath);
}

// Last row wins, matching the reader's own upsert writer: re-ordering a term twice must
// leave one opinion on file, not two that disagree.
function buildNomOrderIndex(entries) {
  const index = new Map();
  for (const entry of entries) {
    index.set(entry.key, entry.nom);
  }
  return index;
}

// The one hoist rule, shared by every consumer. Stable: rows the preference list says
// nothing about keep the order they arrived in.
function orderPreferredFirst(rows, preferred, getText) {
  if (!preferred || !preferred.length) {
    return rows.slice();
  }

  const rank = new Map(preferred.map((value, position) => [value, position]));
  const scored = rows.map((row, arrival) => {
    let best = Number.POSITIVE_INFINITY;
    for (const candidate of extractNomCandidates(getText(row))) {
      const position = rank.get(candidate);
      if (position !== undefined && position < best) {
        best = position;
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

  const present = new Set(rows.flatMap((row) => extractNomCandidates(getText(row))));
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
  orderPreferredFirst,
  hoistPreferredRows,
  applyUserNomOrderToNomMap,
  applyUserNomOrderToDefinitions,
  splitCandidateText
};
