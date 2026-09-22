#!/usr/bin/env node

const {cleanText, normalizeTerm} = require('./lib/text');
const {CJK_PATTERN: cjkPattern, extractNomCandidates} = require('./lib/cjk');
const {atomicWrite} = require('./lib/fsutil');
const {definitionKey, mdxEntries, readJson} = require('./lib/sources');
const repoPaths = require('./lib/paths');

const dictionaryPath = repoPaths.absolute.dictionary;
const mdxNomPath = repoPaths.absolute.mdxNom;

// This script treats every CJK run in a definition as an existing token, including runs
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

function main({
  dictionaryPath: targetDictionaryPath = dictionaryPath,
  mdxNomPath: targetMdxNomPath = mdxNomPath,
  write = atomicWrite
} = {}) {
  const dictionary = readJson(targetDictionaryPath);
  const mdxPayload = readJson(targetMdxNomPath);
  const mdxNomEntries = mdxEntries(mdxPayload);
  const byKey = new Map();

  for (const entry of dictionary) {
    const key = normalizeTerm(entry.vn);
    if (!key) {
      continue;
    }

    if (!byKey.has(key)) {
      byKey.set(key, []);
    }
    byKey.get(key).push(entry);
  }

  let updatedEntries = 0;
  let addedDefinitions = 0;
  let createdEntries = 0;
  let removedDuplicateDefinitions = 0;
  let skippedMalformed = 0;

  for (const entry of dictionary) {
    removedDuplicateDefinitions += dedupeDefinitions(entry);
  }

  for (const [term, candidates] of Object.entries(mdxNomEntries)) {
    const key = normalizeTerm(term);
    if (!Array.isArray(candidates)) {
      skippedMalformed++;
      continue;
    }
    const cleanCandidates = Array.from(new Set(candidates
      .map(cleanText)
      .filter(Boolean)));

    if (!key || !cleanCandidates.length) {
      continue;
    }

    const existingEntries = byKey.get(key);
    if (existingEntries && existingEntries.length) {
      for (const entry of existingEntries) {
        const added = insertNomDefinitions(entry, cleanCandidates);
        if (added) {
          updatedEntries++;
          addedDefinitions += added;
        }
      }
      continue;
    }

    const newEntry = {
      vn: cleanText(term),
      en: cleanCandidates.map((candidate) => ({def: candidate, pos: ''}))
    };
    dictionary.push(newEntry);
    byKey.set(key, [newEntry]);
    createdEntries++;
    addedDefinitions += cleanCandidates.length;
  }

  write(targetDictionaryPath, JSON.stringify(dictionary));

  console.log(`Updated ${targetDictionaryPath}`);
  console.log(`Updated existing entries: ${updatedEntries}`);
  console.log(`Created new entries: ${createdEntries}`);
  console.log(`Added definitions: ${addedDefinitions}`);
  console.log(`Removed duplicate definitions: ${removedDuplicateDefinitions}`);
  console.log(`Skipped malformed MDX entries: ${skippedMalformed}`);
  console.log(`Total dictionary entries: ${dictionary.length}`);

  return {
    updatedEntries,
    addedDefinitions,
    createdEntries,
    removedDuplicateDefinitions,
    skippedMalformed,
    totalEntries: dictionary.length
  };
}

module.exports = {
  cjkTokens,
  existingTokens,
  insertNomDefinitions,
  dedupeDefinitions,
  main
};

if (require.main === module) {
  main();
}
