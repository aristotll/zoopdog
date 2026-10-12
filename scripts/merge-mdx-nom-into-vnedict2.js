#!/usr/bin/env node

const {atomicWrite} = require('./lib/fsutil');
const {mdxEntries, readJson} = require('./lib/sources');
const {
  cjkTokens,
  existingTokens,
  insertNomDefinitions,
  dedupeDefinitions,
  indexEntriesByKey,
  mergeNomFormsIntoEntries
} = require('./lib/nom-merge');
const repoPaths = require('./lib/paths');

const dictionaryPath = repoPaths.absolute.dictionary;
const mdxNomPath = repoPaths.absolute.mdxNom;

function main({
  dictionaryPath: targetDictionaryPath = dictionaryPath,
  mdxNomPath: targetMdxNomPath = mdxNomPath,
  write = atomicWrite
} = {}) {
  const dictionary = readJson(targetDictionaryPath);
  const mdxPayload = readJson(targetMdxNomPath);
  const mdxNomEntries = mdxEntries(mdxPayload);
  const index = indexEntriesByKey(dictionary);

  // The pre-pass dedupe is this write-back tool's own intent (the chunom layer, which never writes, does not run it).
  let removedDuplicateDefinitions = 0;
  for (const entry of dictionary) {
    removedDuplicateDefinitions += dedupeDefinitions(entry);
  }

  const {updatedEntries, addedDefinitions, createdEntries, skippedMalformed} = mergeNomFormsIntoEntries(
    dictionary,
    mdxNomEntries,
    {index}
  );

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

// The helpers live in scripts/lib/nom-merge.js; re-exported for the existing importers.
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
