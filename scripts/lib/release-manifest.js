'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const {readUserscriptVersion} = require('./userscript');

/**
 * One inventoried file: content hash and size; `version` is only set on built `*.user.js` assets.
 * @typedef {{sha256: string, bytes: number, version?: string | null}} ManifestFileInfo
 */

/**
 * The release manifest: inputs and assets by repo-relative path, optional sources as `null` when
 * absent, and the toolchain that produced them.
 * @typedef {object} ReleaseManifest
 * @property {number} schemaVersion
 * @property {string} commit
 * @property {string} nodeVersion
 * @property {Record<string, string>} toolVersions
 * @property {string[]} inputRoots
 * @property {Record<string, ManifestFileInfo>} inputs
 * @property {Record<string, ManifestFileInfo | null>} optional
 * @property {Record<string, ManifestFileInfo>} assets
 */

/**
 * @typedef {object} ReleaseManifestOptions
 * @property {string} root
 * @property {string[]} inputs
 * @property {string[]} optional
 * @property {string[]} assets
 * @property {string} commit
 * @property {string} nodeVersion
 * @property {Record<string, string>} toolVersions
 */

/** @param {string} file @returns {ManifestFileInfo} */
function fileInfo(file) {
  const bytes = fs.readFileSync(file);
  return {sha256: crypto.createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length};
}

// Deterministic inventory of actual input and output bytes. Missing optional sources are explicit.
/** @param {ReleaseManifestOptions} options @returns {ReleaseManifest} */
function createReleaseManifest({root, inputs, optional, assets, commit, nodeVersion, toolVersions}) {
  /** @type {Record<string, ManifestFileInfo>} */
  const inputFiles = {};
  /** @param {string} relative */
  function collect(relative) {
    const full = path.join(root, relative);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(full).sort()) collect(path.posix.join(relative, name));
    } else if (stat.isFile()) inputFiles[relative] = fileInfo(full);
  }
  inputs.forEach(collect);
  /** @type {Record<string, ManifestFileInfo | null>} */
  const optionalFiles = {};
  for (const relative of optional) {
    const full = path.join(root, relative);
    optionalFiles[relative] = fs.existsSync(full) ? fileInfo(full) : null;
  }
  /** @type {Record<string, ManifestFileInfo>} */
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

/** @param {string} root @param {ReleaseManifest} manifest */
function verifyReleaseManifest(root, manifest) {
  try {
    const actual = createReleaseManifest({root, inputs: manifest.inputRoots,
      optional: Object.keys(manifest.optional), assets: Object.keys(manifest.assets),
      commit: manifest.commit, nodeVersion: manifest.nodeVersion, toolVersions: manifest.toolVersions});
    if (JSON.stringify(actual) !== JSON.stringify(manifest)) throw new Error('contents differ');
  } catch (error) {
    throw new Error(`Release manifest validation failed: ${/** @type {Error} */ (error).message}`);
  }
}

/** @param {string} root @param {string[]} [assets] @returns {ReleaseManifestOptions} */
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

/** @param {ReleaseManifest} before @param {ReleaseManifest} after */
function assertReleaseInputsUnchanged(before, after) {
  for (const field of /** @type {const} */ (['schemaVersion', 'commit', 'nodeVersion', 'toolVersions', 'inputRoots', 'inputs', 'optional'])) {
    if (JSON.stringify(before[field]) !== JSON.stringify(after[field])) {
      throw new Error(`Release inputs changed during build (${field}); rebuild before publishing`);
    }
  }
}

module.exports = {createReleaseManifest, verifyReleaseManifest, releaseManifestOptions, assertReleaseInputsUnchanged};
