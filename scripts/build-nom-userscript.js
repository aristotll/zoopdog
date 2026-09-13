#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const {
  readUserNomEntries,
  mergeUserNomEntriesIntoNomMap
} = require('./user-nom-entries');
const {readUserNomOrder, applyUserNomOrderToNomMap} = require('./user-nom-order');
const {cleanText, normalizeTerm} = require('./lib/text');
const {extractNomCandidates, isEmbeddableTerm} = require('./lib/cjk');
const {mdxEntries, readJson} = require('./lib/sources');
const repoPaths = require('./lib/paths');
const {
  readRuntime,
  renderRuntime,
  PENDING_VERSION,
  writeVersionedUserscript
} = require('./lib/userscript');

const sourcePath = repoPaths.absolute.dictionary;
const extractedMdxPath = repoPaths.absolute.mdxNom;
const userNomPath = repoPaths.absolute.userNomEntries;
const userNomOrderPath = repoPaths.absolute.userNomOrder;
const nomMatchEnginePath = path.join(repoPaths.rootDir, 'zd-extension/js/zd-nom-match.js');

// The -local variant is identical in every way except its update contract: it points at its
// own file on this machine (for Violentmonkey's "track local file") instead of the github raw
// URL, so rebuilding it never collides with the auto-updating github-hosted copy. It is never
// committed -- see .gitignore.
const VARIANTS = [
  {targetKey: 'nomUserscript', nameSuffix: ''},
  {targetKey: 'nomLocalUserscript', nameSuffix: ' (Local)'}
];

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

function buildUserscript(nomMap, variant) {
  const updateUrl = variant.targetKey === 'nomLocalUserscript'
    ? repoPaths.localFileUrl(variant.targetKey)
    : repoPaths.rawUrl(variant.targetKey);

  return renderRuntime(readRuntime('nom-ruby.runtime.js'), {
    '__ZOOPDOG_NOM_MATCH_ENGINE__': fs.readFileSync(nomMatchEnginePath, 'utf8'),
    '{"__ZOOPDOG_NOM_MAP__": true}': JSON.stringify(nomMap),
    '__ZOOPDOG_ENTRY_COUNT__': Object.keys(nomMap).length,
    '__ZOOPDOG_NAME_SUFFIX__': variant.nameSuffix,
    '__ZOOPDOG_UPDATE_URL__': updateUrl,
    '__ZOOPDOG_DOWNLOAD_URL__': updateUrl,
    // The real stamp is decided on write, by comparing this draft with the committed file.
    '__ZOOPDOG_VERSION__': PENDING_VERSION
  });
}

// The full merge pipeline -- base dictionary, extracted MDX data, hand-maintained entries,
// then display order -- in one place so the userscript builder and Node-side tooling
// (scripts/nom-inspect.js and its tests) can never see two different Chu Nom maps for the
// same repository state.
function buildFullNomMap() {
  const entries = readJson(sourcePath);
  const nomMap = buildNomMap(entries);

  if (fs.existsSync(extractedMdxPath)) {
    mergeExtractedNomMap(nomMap, readJson(extractedMdxPath));
  }

  const userNomEntries = readUserNomEntries(userNomPath);
  mergeUserNomEntriesIntoNomMap(nomMap, userNomEntries);

  // Last, after every layer that can *add* a candidate: this one only reorders what they
  // produced, and the userscript renders candidate 0 as the ruby.
  const userNomOrder = readUserNomOrder(userNomOrderPath);
  applyUserNomOrderToNomMap(nomMap, userNomOrder);

  return {nomMap, userNomEntries, userNomOrder};
}

function main(argv = process.argv.slice(2)) {
  const localOnly = argv.includes('--local-only');
  const variants = localOnly
    ? VARIANTS.filter((variant) => variant.targetKey === 'nomLocalUserscript')
    : VARIANTS;
  const {nomMap, userNomEntries, userNomOrder} = buildFullNomMap();

  for (const variant of variants) {
    const targetPath = repoPaths.absolute[variant.targetKey];
    const {version, changed} = writeVersionedUserscript(targetPath, buildUserscript(nomMap, variant));

    console.log(`Wrote ${targetPath}`);
    console.log(`Version ${version}${changed ? ' (content changed)' : ' (unchanged)'}`);
  }

  console.log(`Embedded ${Object.keys(nomMap).length} dictionary entries`);
  if (fs.existsSync(extractedMdxPath)) {
    console.log(`Merged extracted MDX data from ${extractedMdxPath}`);
  }
  if (userNomEntries.length) {
    console.log(`Merged ${userNomEntries.length} user Nom entries from ${userNomPath}`);
  }
  if (userNomOrder.length) {
    console.log(`Applied ${userNomOrder.length} display-order rows from ${userNomOrderPath}`);
  }
}

module.exports = {
  isEmbeddableTerm,
  extractNomCandidates,
  buildNomMap,
  mergeExtractedNomMap,
  buildFullNomMap,
  main
};

if (require.main === module) {
  main(process.argv.slice(2));
}
