#!/usr/bin/env node

const fs = require('fs');
const {
  readUserNomEntries,
  mergeUserNomEntriesIntoNomMap
} = require('./user-nom-entries');
const {cleanText, normalizeTerm} = require('./lib/text');
const {extractNomCandidates, isEmbeddableTerm} = require('./lib/cjk');
const {mdxEntries, readJson} = require('./lib/sources');
const repoPaths = require('./lib/paths');
const {readRuntime, renderRuntime} = require('./lib/userscript');

const sourcePath = repoPaths.absolute.dictionary;
const extractedMdxPath = repoPaths.absolute.mdxNom;
const userNomPath = repoPaths.absolute.userNomEntries;
const targetPath = repoPaths.absolute.nomUserscript;

function buildNomMap(entries) {
  const map = new Map();

  for (const entry of entries) {
    const term = normalizeTerm(entry.vn);

    if (!isEmbeddableTerm(term)) {
      continue;
    }

    const candidates = [];
    for (const item of entry.en || []) {
      candidates.push(...extractNomCandidates(item.def));
    }

    if (!candidates.length) {
      continue;
    }

    const previous = map.get(term) || [];
    map.set(term, Array.from(new Set([...previous, ...candidates])));
  }

  return Object.fromEntries(
    Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b, 'vi-VN'))
      .map(([term, candidates]) => [term, candidates.join(' / ')])
  );
}

function splitCandidateText(value) {
  return String(value || '')
    .split(/\s+\/\s+/)
    .map(cleanText)
    .filter(Boolean);
}

function mergeExtractedNomMap(nomMap, extractedPayload) {
  const extractedEntries = mdxEntries(extractedPayload);

  for (const [term, candidates] of Object.entries(extractedEntries)) {
    const normalizedTerm = normalizeTerm(term);

    if (!isEmbeddableTerm(normalizedTerm)) {
      continue;
    }

    const existing = splitCandidateText(nomMap[normalizedTerm]);
    const incoming = Array.isArray(candidates)
      ? candidates.map(cleanText).filter(Boolean)
      : splitCandidateText(candidates);

    if (!incoming.length) {
      continue;
    }

    nomMap[normalizedTerm] = Array.from(new Set([...existing, ...incoming])).join(' / ');
  }
}

function buildUserscript(nomMap) {
  return renderRuntime(readRuntime('nom-ruby.runtime.js'), {
    '{"__ZOOPDOG_NOM_MAP__": true}': JSON.stringify(nomMap),
    '__ZOOPDOG_ENTRY_COUNT__': Object.keys(nomMap).length
  });
}

function main() {
  const entries = readJson(sourcePath);
  const nomMap = buildNomMap(entries);

  if (fs.existsSync(extractedMdxPath)) {
    mergeExtractedNomMap(nomMap, readJson(extractedMdxPath));
  }

  const userNomEntries = readUserNomEntries(userNomPath);
  mergeUserNomEntriesIntoNomMap(nomMap, userNomEntries);

  fs.writeFileSync(targetPath, buildUserscript(nomMap), 'utf8');

  console.log(`Wrote ${targetPath}`);
  console.log(`Embedded ${Object.keys(nomMap).length} dictionary entries`);
  if (fs.existsSync(extractedMdxPath)) {
    console.log(`Merged extracted MDX data from ${extractedMdxPath}`);
  }
  if (userNomEntries.length) {
    console.log(`Merged ${userNomEntries.length} user Nom entries from ${userNomPath}`);
  }
}

module.exports = {
  isEmbeddableTerm,
  extractNomCandidates,
  buildNomMap,
  mergeExtractedNomMap,
  main
};

if (require.main === module) {
  main();
}
