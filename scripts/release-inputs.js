#!/usr/bin/env node
'use strict';
const path = require('node:path');
const fs = require('node:fs');
const {atomicWrite} = require('./lib/fsutil');
const {createReleaseManifest, releaseManifestOptions} = require('./lib/release-manifest');
const {rootDir} = require('./lib/paths');

function captureReleaseInputs(root = rootDir) {
  const file = path.join(root, 'dist', 'zoopdog-release-inputs.json');
  fs.mkdirSync(path.dirname(file), {recursive: true});
  const snapshot = createReleaseManifest(releaseManifestOptions(root));
  atomicWrite(file, `${JSON.stringify(snapshot, null, 2)}\n`);
  return file;
}
module.exports = {captureReleaseInputs};
if (require.main === module) {
  try { console.log(`Captured release inputs: ${captureReleaseInputs()}`); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
