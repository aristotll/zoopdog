#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const dictionaryPath = path.join(rootDir, 'zd-extension/db_src/vnedict2.json');
const mdxNomPath = path.join(rootDir, 'zd-extension/db_src/mdx_nom.json');

const cjkPattern = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u{20000}-\u{323AF}]/u;
const cjkSequencePattern = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u{20000}-\u{323AF}]+/gu;

function cleanText(value) {
  return String(value || '')
    .replace(/^\uFEFF/, '')
    .normalize('NFC')
    .trim();
}

function normalizeTerm(value) {
  return cleanText(value)
    .toLocaleLowerCase('vi-VN')
    .replace(/\s+/g, ' ');
}

function cjkTokens(value) {
  return cleanText(value).match(cjkSequencePattern) || [];
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
    const key = `${cleanText(item.def)}\u0000${cleanText(item.pos)}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });

  return originalLength - entry.en.length;
}

const dictionary = JSON.parse(fs.readFileSync(dictionaryPath, 'utf8'));
const mdxPayload = JSON.parse(fs.readFileSync(mdxNomPath, 'utf8'));
const mdxEntries = mdxPayload.entries || mdxPayload;
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

for (const entry of dictionary) {
  removedDuplicateDefinitions += dedupeDefinitions(entry);
}

for (const [term, candidates] of Object.entries(mdxEntries)) {
  const key = normalizeTerm(term);
  const cleanCandidates = Array.from(new Set((Array.isArray(candidates) ? candidates : [])
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

fs.writeFileSync(dictionaryPath, JSON.stringify(dictionary), 'utf8');

console.log(`Updated ${dictionaryPath}`);
console.log(`Updated existing entries: ${updatedEntries}`);
console.log(`Created new entries: ${createdEntries}`);
console.log(`Added definitions: ${addedDefinitions}`);
console.log(`Removed duplicate definitions: ${removedDuplicateDefinitions}`);
console.log(`Total dictionary entries: ${dictionary.length}`);
