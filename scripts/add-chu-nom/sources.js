'use strict';

const fs = require('node:fs');
const {readUserNomEntries} = require('../user-nom-entries');
const {cleanText, foldAccents, normalizeTerm, stableUnique} = require('../lib/text');
const {extractNomCandidates} = require('../lib/cjk');
const {mdxEntries, readJson} = require('../lib/sources');
const repoPaths = require('../lib/paths');
const {WorkflowError} = require('./errors');

// The planner's historical extraction shape: parentheticals stripped, no separator split,
// and no CJK guard. Kept as an explicit option set rather than a second implementation.
function planNomCandidates(value) {
  return extractNomCandidates(value, {requireCjk: false, separators: null});
}

function levenshtein(left, right) {
  const a = Array.from(String(left));
  const b = Array.from(String(right));
  const row = Array.from({length: b.length + 1}, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const previous = row[j];
      row[j] = Math.min(
        row[j] + 1,
        row[j - 1] + 1,
        diagonal + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
      diagonal = previous;
    }
  }
  return row[b.length];
}

function addIndexedEntry(index, vi, nom, explain, source) {
  const key = normalizeTerm(vi);
  if (!key) {
    return;
  }
  if (!index.has(key)) {
    index.set(key, {key, vi: cleanText(vi), nom: [], explain: [], sources: []});
  }
  const entry = index.get(key);
  entry.nom = stableUnique([...entry.nom, ...nom]);
  entry.explain = stableUnique([...entry.explain, ...explain]);
  if (!entry.sources.includes(source)) {
    entry.sources.push(source);
  }
}

function loadLocalSources(repoRoot) {
  const userPath = repoPaths.resolveIn(repoRoot, 'userNomEntries');
  const dictionaryPath = repoPaths.resolveIn(repoRoot, 'dictionary');
  const mdxPath = repoPaths.resolveIn(repoRoot, 'mdxNom');
  if (!fs.existsSync(dictionaryPath)) {
    throw new WorkflowError('dictionary_source_missing', `Missing dictionary source: ${dictionaryPath}`);
  }

  const userEntries = readUserNomEntries(userPath);
  const userKeys = new Set(userEntries.map((entry) => entry.key));
  const index = new Map();
  const dictionary = readJson(dictionaryPath);

  for (const entry of userEntries) {
    addIndexedEntry(index, entry.vi, entry.nom, entry.explain, 'user_nom_entries');
  }

  for (const entry of dictionary) {
    const nom = [];
    const explain = [];
    for (const definition of entry.en || []) {
      const text = cleanText(definition.def);
      const candidates = planNomCandidates(text);
      if (candidates.length) {
        nom.push(...candidates);
      } else if (text) {
        explain.push(text);
      }
    }
    addIndexedEntry(index, entry.vn, nom, explain, 'vnedict2');
  }

  if (fs.existsSync(mdxPath)) {
    const payload = readJson(mdxPath);
    for (const [term, values] of Object.entries(mdxEntries(payload))) {
      const candidates = Array.isArray(values) ? values : [values];
      addIndexedEntry(index, term, candidates.flatMap(planNomCandidates), [], 'mdx_nom');
    }
  }

  const folded = new Map();
  for (const key of index.keys()) {
    const foldedKey = foldAccents(key);
    if (!folded.has(foldedKey)) {
      folded.set(foldedKey, []);
    }
    folded.get(foldedKey).push(key);
  }
  for (const keys of folded.values()) {
    keys.sort();
  }

  return {
    index,
    folded,
    userKeys,
    sourcePaths: [userPath, dictionaryPath, mdxPath]
  };
}

function resolveSpelling(value, sources) {
  const key = normalizeTerm(value);
  if (sources.index.has(key)) {
    return {key, vi: cleanText(value), choices: []};
  }

  const foldedKey = foldAccents(value);
  const foldedMatches = sources.folded.get(foldedKey) || [];
  if (foldedMatches.length === 1) {
    const resolvedKey = foldedMatches[0];
    return {key: resolvedKey, vi: sources.index.get(resolvedKey).vi, choices: []};
  }
  if (foldedMatches.length > 1) {
    return {
      key,
      vi: cleanText(value),
      choices: foldedMatches.map((match) => sources.index.get(match).vi)
    };
  }

  const wordCount = foldedKey.split(/\s+/).length;
  const threshold = Math.max(1, Math.min(2, Math.floor(Array.from(foldedKey).length / 5)));
  const suggestions = [];
  for (const candidate of sources.index.keys()) {
    const foldedCandidate = foldAccents(candidate);
    if (foldedCandidate.split(/\s+/).length !== wordCount) {
      continue;
    }
    const distance = levenshtein(foldedKey, foldedCandidate);
    if (distance <= threshold) {
      suggestions.push({candidate, distance});
    }
  }
  suggestions.sort((a, b) => a.distance - b.distance || (a.candidate < b.candidate ? -1 : 1));
  return {
    key,
    vi: cleanText(value),
    choices: suggestions.map(({candidate}) => sources.index.get(candidate).vi)
  };
}

function composeNom(tokens, index, start = 0, memo = new Map()) {
  if (start === tokens.length) {
    return [''];
  }
  if (memo.has(start)) return memo.get(start);
  const variants = [];
  for (let end = tokens.length; end > start; end--) {
    const key = normalizeTerm(tokens.slice(start, end).join(' '));
    const entry = index.get(key);
    if (!entry || entry.nom.length !== 1) {
      continue;
    }
    for (const remainder of composeNom(tokens, index, end, memo)) {
      variants.push(`${entry.nom[0]}${remainder}`);
    }
  }
  const result = stableUnique(variants);
  memo.set(start, result);
  return result;
}

module.exports = {
  levenshtein,
  planNomCandidates,
  addIndexedEntry,
  loadLocalSources,
  resolveSpelling,
  composeNom
};
