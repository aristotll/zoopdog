'use strict';

// chunom.org's "standard characters" list (https://chunom.org/pages/standard-list/?max=2000, a tab-separated
// text): the rows of the Chu Nom Project's standard characters by frequency, and their compounds.
//
//   #  Unicode  Freq.  Text  QN  English
//   1. U+27D51  1      𧵑    của of; to belong to; properties, belongings      <- a character: it has a Unicode column
//   2.          9999999 𧵑終  của chung public property                         <- a compound: no Unicode, Freq 9999999
//
// This module is the one definition of how that file becomes data for the dictionary layers. See docs/chunom-standard.md.

const {cleanText, normalizeTerm} = require('./text');
const {CJK_PATTERN} = require('./cjk');

const STANDARD_LIST_URL = 'https://chunom.org/pages/standard-list/?max=2000';

// One tab-separated row -> {rank, code, frequency, nom, term, english, isCharacter}; null for the header, a blank line or a
// row with no Nom text or no reading. The `口` nhay mark that decorates a phonetic loan stays part of the Nom text.
function parseStandardRow(line) {
  const cells = line.split('\t');
  if (cells.length < 5 || /^#/.test(cells[0])) {
    return null;
  }
  const [rank, code, frequency, nomText, reading, english = ''] = cells;
  const nom = cleanText(nomText);
  const term = normalizeTerm(reading);
  if (!nom || !term || !CJK_PATTERN.test(nom)) {
    return null;
  }
  return {
    rank: parseInt(rank, 10),
    code: cleanText(code),
    frequency: parseInt(frequency, 10),
    nom,
    term,
    reading: cleanText(reading),
    english: cleanText(english),
    isCharacter: /^U\+[0-9A-F]+$/i.test(cleanText(code))
  };
}

function parseStandardList(text) {
  return String(text).split(/\r?\n/).map(parseStandardRow).filter(Boolean);
}

function pushUnique(list, value) {
  if (!list.includes(value)) {
    list.push(value);
  }
}

// The payload `chunom_standard.json` holds, in the shape of `mdx_nom.json` (`entries`: term -> Nom variants) so the
// generic readers (`lib/sources.mdxEntries`) read it, plus what the list adds: an English gloss per term and the standard
// character(s) of each reading.
//   entries   every term (character readings and compounds) -> its Nom forms, in the list's order (frequency first)
//   meanings  term -> English glosses (each distinct gloss once)
//   standard  Quoc ngu reading -> the standard character(s), by frequency: only the rows of the list that are characters
function buildPayload(rows, {source = STANDARD_LIST_URL} = {}) {
  const entries = {};
  const meanings = {};
  const standard = {};
  for (const row of rows) {
    pushUnique(entries[row.term] = entries[row.term] || [], row.nom);
    if (row.english) {
      pushUnique(meanings[row.term] = meanings[row.term] || [], row.english);
    }
    if (row.isCharacter) {
      pushUnique(standard[row.term] = standard[row.term] || [], row.nom);
    }
  }
  return {
    source,
    generatedBy: 'scripts/import-chunom-standard.js',
    rowCount: rows.length,
    characterCount: rows.filter((row) => row.isCharacter).length,
    entryCount: Object.keys(entries).length,
    entries,
    meanings,
    standard
  };
}

module.exports = {
  STANDARD_LIST_URL,
  parseStandardRow,
  parseStandardList,
  buildPayload
};
