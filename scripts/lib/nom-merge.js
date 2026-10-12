'use strict';

// The one implementation of "fold a term -> Nom forms map into dictionary entries", shared by the mdx merge script
// (scripts/merge-mdx-nom-into-vnedict2.js) and the chunom layer (scripts/chunom-standard-layer.js), plus the normalized-key index of
// entries those and the extension's user-entry merge all need. Entries are `{vn, en: [{def, pos}]}`.

const {cleanText, normalizeTerm} = require('./text');
const {CJK_PATTERN: cjkPattern, extractNomCandidates} = require('./cjk');
const {definitionKey} = require('./sources');

// This merge treats every CJK run in a definition as an existing token, including runs
// inside parentheticals and without separator splitting.
function cjkTokens(value) {
  return extractNomCandidates(value, {
    requireCjk: false,
    stripParentheticals: false,
    separators: null
  });
}

function existingTokens(entry) {
  const tokens = new Set();
  for (const item of entry.en || []) {
    for (const token of cjkTokens(item.def)) {
      tokens.add(token);
    }
  }
  return tokens;
}

// Inserts the candidates an entry lacks after its leading Nom definitions (before the glosses); returns how many were added.
function insertNomDefinitions(entry, candidates) {
  entry.en = entry.en || [];

  const seenTokens = existingTokens(entry);
  const seenDefinitions = new Set(entry.en.map((item) => cleanText(item.def)));
  const additions = [];

  for (const candidate of candidates) {
    const cleanCandidate = cleanText(candidate);
    if (!cleanCandidate || seenTokens.has(cleanCandidate) || seenDefinitions.has(cleanCandidate)) {
      continue;
    }

    additions.push({def: cleanCandidate, pos: ''});
    seenTokens.add(cleanCandidate);
    seenDefinitions.add(cleanCandidate);
  }

  if (!additions.length) {
    return 0;
  }

  let insertAt = 0;
  while (insertAt < entry.en.length && cjkPattern.test(cleanText(entry.en[insertAt].def))) {
    insertAt++;
  }

  entry.en.splice(insertAt, 0, ...additions);
  return additions.length;
}

function dedupeDefinitions(entry) {
  const seen = new Set();
  const originalLength = (entry.en || []).length;

  entry.en = (entry.en || []).filter((item) => {
    const key = definitionKey(item.def, item.pos);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });

  return originalLength - entry.en.length;
}

// Map<normalized headword, entry[]>, skipping an entry whose headword normalizes to nothing.
function indexEntriesByKey(entries) {
  const byKey = new Map();
  for (const entry of entries) {
    const key = normalizeTerm(entry.vn);
    if (!key) {
      continue;
    }
    if (!byKey.has(key)) {
      byKey.set(key, []);
    }
    byKey.get(key).push(entry);
  }
  return byKey;
}

// Folds `termToForms` (term -> Nom forms) into `entries`, in place. A term an entry already has gets the forms it lacks (behind its own
// Nom forms, see `insertNomDefinitions`); a new term becomes an entry with its forms followed by `extraDefsFor(term)` (glosses, if any).
// A non-array value counts as malformed; a term with an empty key, or no forms left after cleaning, is skipped (never an entry).
function mergeNomFormsIntoEntries(entries, termToForms, {index = indexEntriesByKey(entries), extraDefsFor} = {}) {
  let updatedEntries = 0;
  let addedDefinitions = 0;
  let createdEntries = 0;
  let skippedMalformed = 0;

  for (const [term, forms] of Object.entries(termToForms)) {
    const key = normalizeTerm(term);
    if (!Array.isArray(forms)) {
      skippedMalformed++;
      continue;
    }
    const candidates = Array.from(new Set(forms.map(cleanText).filter(Boolean)));
    if (!key || !candidates.length) {
      continue;
    }

    const existing = index.get(key);
    if (existing && existing.length) {
      for (const entry of existing) {
        const added = insertNomDefinitions(entry, candidates);
        if (added) {
          updatedEntries++;
          addedDefinitions += added;
        }
      }
      continue;
    }

    const extras = (extraDefsFor && extraDefsFor(term)) || [];
    const entry = {
      vn: cleanText(term),
      en: candidates.map((def) => ({def, pos: ''})).concat(extras.map((def) => ({def, pos: ''})))
    };
    entries.push(entry);
    index.set(key, [entry]);
    createdEntries++;
    addedDefinitions += candidates.length;
  }

  return {updatedEntries, addedDefinitions, createdEntries, skippedMalformed};
}

module.exports = {
  cjkTokens,
  existingTokens,
  insertNomDefinitions,
  dedupeDefinitions,
  indexEntriesByKey,
  mergeNomFormsIntoEntries
};
