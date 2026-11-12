#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {absolute} = require('./lib/paths');
const {publishDictionaryAndMetadata} = require('./build-extension-vnedict-json');
const {validateDictionaryPair} = require('./release-userscripts');
const {validateMetadata} = require('../zd-extension/js/zd-dictionary-runtime');

// Publish into an existing local static-host directory. Revision files are never removed: an
// in-flight browser or cache may still hold an older pointer. This does not deploy remotely.
function publishRuntimeDictionary(sourceDirectory, targetDirectory, options = {}) {
  const source = path.resolve(sourceDirectory), target = path.resolve(targetDirectory);
  if (!fs.statSync(target).isDirectory()) throw new Error('Target must be an existing directory');
  const metadataBytes = fs.readFileSync(path.join(source, 'vnedict.meta.json'));
  const bytes = fs.readFileSync(path.join(source, 'vnedict.json'));
  const metadata = validateDictionaryPair(bytes, metadataBytes);
  if (!metadata.payload) throw new Error('Source metadata must name an immutable payload');
  const sourcePayload = fs.readFileSync(path.join(source, metadata.payload));
  if (!sourcePayload.equals(bytes)) throw new Error('Source immutable payload differs from dictionary');

  const targetMetadata = path.join(target, 'vnedict.meta.json');
  if (fs.existsSync(targetMetadata)) {
    const oldMetadataBytes = fs.readFileSync(targetMetadata);
    const oldMetadata = validateMetadata(JSON.parse(oldMetadataBytes));
    const oldPayload = oldMetadata.payload || 'vnedict.json';
    validateDictionaryPair(fs.readFileSync(path.join(target, oldPayload)), oldMetadataBytes);
  }
  publishDictionaryAndMetadata(path.join(target, 'vnedict.json'), bytes, targetMetadata, metadataBytes, options);
  return metadata;
}

module.exports = {publishRuntimeDictionary};
if (require.main === module) {
  try {
    const target = process.argv[2];
    if (!target || process.argv.length !== 3) throw new Error('Usage: node scripts/publish-runtime-dictionary.js EXISTING_TARGET_DIRECTORY');
    const metadata = publishRuntimeDictionary(path.dirname(absolute.runtimeDictionary), target);
    console.log(`Published dictionary ${metadata.revision} to ${path.resolve(target)}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
