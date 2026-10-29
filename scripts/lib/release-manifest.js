'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const {readUserscriptVersion} = require('./userscript');

function fileInfo(file) {
  const bytes = fs.readFileSync(file);
  return {sha256: crypto.createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length};
}

// Deterministic inventory of actual input and output bytes. Missing optional sources are explicit.
function createReleaseManifest({root, inputs, optional, assets, commit, nodeVersion, toolVersions}) {
  const inputFiles = {};
  function collect(relative) {
    const full = path.join(root, relative);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(full).sort()) collect(path.posix.join(relative, name));
    } else if (stat.isFile()) inputFiles[relative] = fileInfo(full);
  }
  inputs.forEach(collect);
  const optionalFiles = {};
  for (const relative of optional) {
    const full = path.join(root, relative);
    optionalFiles[relative] = fs.existsSync(full) ? fileInfo(full) : null;
  }
  const outputFiles = {};
  for (const relative of assets) {
    const full = path.join(root, relative);
    const info = fileInfo(full);
    if (relative.endsWith('.user.js')) {
      info.version = readUserscriptVersion(fs.readFileSync(full, 'utf8'));
      if (!info.version) throw new Error(`Missing userscript version in ${relative}`);
    }
    outputFiles[relative] = info;
  }
  return {schemaVersion: 1, commit, nodeVersion, toolVersions, inputRoots: inputs, inputs: inputFiles, optional: optionalFiles, assets: outputFiles};
}

function verifyReleaseManifest(root, manifest) {
  try {
    const actual = createReleaseManifest({root, inputs: manifest.inputRoots,
      optional: Object.keys(manifest.optional), assets: Object.keys(manifest.assets),
      commit: manifest.commit, nodeVersion: manifest.nodeVersion, toolVersions: manifest.toolVersions});
    if (JSON.stringify(actual) !== JSON.stringify(manifest)) throw new Error('contents differ');
  } catch (error) {
    throw new Error(`Release manifest validation failed: ${error.message}`);
  }
}

function releaseManifestOptions(root, assets = []) {
  return {
    root,
    inputs: ['scripts', 'zd-extension/db_src', 'zd-extension/js/zd-words.js',
      'zd-extension/js/zd-nom-match.js', 'package-lock.json'],
    optional: ['zd-extension/db_src/chunom_standard.json', 'zd-extension/db_src/fonts/NomNaTong-Regular.otf'],
    assets,
    commit: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim(),
    nodeVersion: process.version,
    toolVersions: {esbuild: require('esbuild/package.json').version, pug: require('pug/package.json').version,
      stylus: require('stylus/package.json').version, typescript: require('typescript/package.json').version}
  };
}

function assertReleaseInputsUnchanged(before, after) {
  for (const field of ['schemaVersion', 'commit', 'nodeVersion', 'toolVersions', 'inputRoots', 'inputs', 'optional']) {
    if (JSON.stringify(before[field]) !== JSON.stringify(after[field])) {
      throw new Error(`Release inputs changed during build (${field}); rebuild before publishing`);
    }
  }
}

module.exports = {createReleaseManifest, verifyReleaseManifest, releaseManifestOptions, assertReleaseInputsUnchanged};
