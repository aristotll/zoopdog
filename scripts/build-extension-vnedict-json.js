'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const {atomicWrite} = require('./lib/fsutil');
const {absolute} = require('./lib/paths');

const METADATA_SCHEMA_VERSION = 1;

function validateEntry(entry, index) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new TypeError(`Dictionary entry ${index} must be an object`);
  }
  if (typeof entry.vn !== 'string' || !entry.vn) {
    throw new TypeError(`Dictionary entry ${index} must have a Vietnamese headword`);
  }
  if (!Array.isArray(entry.en)) {
    throw new TypeError(`Dictionary entry ${index} definitions must be an array`);
  }
  for (const [definitionIndex, definition] of entry.en.entries()) {
    if (!definition || typeof definition !== 'object'
        || typeof definition.def !== 'string'
        || typeof definition.pos !== 'string') {
      throw new TypeError(
        `Dictionary entry ${index} definition ${definitionIndex} must contain string def and pos`
      );
    }
  }
}

function serializeRuntimeDictionary(entries) {
  if (!Array.isArray(entries)) {
    throw new TypeError('Runtime dictionary source must be an array');
  }
  entries.forEach(validateEntry);
  return JSON.stringify(entries);
}

function buildMetadata(dictionaryBytes) {
  const entries = JSON.parse(dictionaryBytes);
  if (!Array.isArray(entries)) {
    throw new TypeError('Runtime dictionary bytes must encode an array');
  }
  return {
    schemaVersion: METADATA_SCHEMA_VERSION,
    revision: crypto.createHash('sha256').update(dictionaryBytes).digest('hex'),
    entryCount: entries.length
  };
}

function buildRuntimeDictionary({
  sourcePath = absolute.dictionary,
  dictionaryPath = absolute.runtimeDictionary,
  metadataPath = absolute.runtimeDictionaryMetadata
} = {}) {
  const entries = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
  const dictionaryBytes = serializeRuntimeDictionary(entries);
  const metadata = buildMetadata(dictionaryBytes);
  atomicWrite(dictionaryPath, dictionaryBytes);
  atomicWrite(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
  return {dictionaryPath, metadataPath, metadata};
}

function main() {
  const result = buildRuntimeDictionary();
  console.log(`Built ${result.dictionaryPath}`);
  console.log(`Built ${result.metadataPath}`);
  console.log(`Revision ${result.metadata.revision} (${result.metadata.entryCount} entries)`);
}

if (require.main === module) {
  main();
}

module.exports = {
  METADATA_SCHEMA_VERSION,
  buildMetadata,
  buildRuntimeDictionary,
  serializeRuntimeDictionary,
  validateEntry
};
