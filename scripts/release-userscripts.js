#!/usr/bin/env node

// Publishes the minified userscripts in dist/ as assets of a new GitHub Release
// (`make release-userscripts`). The @updateURL/@downloadURL in each script point at
// releases/latest/download/<name>, so a new release is what makes installed copies update.
// Needs the GitHub CLI (`gh`) authenticated for the repository. `--dry-run` prints the plan only.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const repoPaths = require('./lib/paths');
const {METADATA_SCHEMA_VERSION} = require('./build-extension-vnedict-json');
const {createReleaseManifest, verifyReleaseManifest, releaseManifestOptions, assertReleaseInputsUnchanged} = require('./lib/release-manifest');
const {atomicWrite} = require('./lib/fsutil');
const {readUserscriptVersion, setUserscriptVersion, compareVersions, nextUserscriptVersion, versionDatestamp} = require('./lib/userscript');

const KEYS = ['nomUserscript', 'popupUserscript'];
// Generated, gitignored runtime dictionary: shipped as-is (not minified) so the extension and
// website can be built from a release instead of from committed 7MB blobs.
const DICTIONARY_KEYS = ['runtimeDictionary', 'runtimeDictionaryMetadata'];
// chunom.org's standard characters (generated, gitignored): shipped when this checkout has imported it, so a release carries the data the
// builds folded in. Optional: a checkout that never ran import-chunom-standard.js simply has none.
const OPTIONAL_DATA_KEYS = ['chunomStandard'];

function releaseTag(now = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `userscripts-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function assertVersion(version) {
  if (!/^\d+(?:\.\d+)*$/.test(String(version || ''))) {
    throw new Error(`Invalid numeric userscript version: ${version}`);
  }
}

function validateUserscriptHeader(source) {
  const header = /^\/\/ ==UserScript==\r?\n([\s\S]*?)^\/\/ ==\/UserScript==\r?$/m.exec(source);
  if (!header || header.index !== 0) throw new Error('Missing or invalid userscript metadata header');
  const versions = [...header[1].matchAll(/^\/\/ @version[ \t]+(\S+)[ \t]*\r?$/gm)];
  if (versions.length !== 1) throw new Error('Userscript header must contain exactly one version');
  assertVersion(versions[0][1]);
  return versions[0][1];
}

function chooseReleaseVersion(publishedVersions, date, requested) {
  if (!publishedVersions.length) throw new Error('Published userscript versions are required');
  publishedVersions.forEach(assertVersion);
  assertVersion(date);
  const latest = publishedVersions.reduce((a, b) => compareVersions(a, b) >= 0 ? a : b);
  const version = requested || nextUserscriptVersion(latest, date);
  assertVersion(version);
  if (publishedVersions.some(previous => compareVersions(version, previous) <= 0)) {
    throw new Error(`Release version ${version} must be newer than all published versions`);
  }
  return version;
}

function stampReleaseAssets(assets, version) {
  assertVersion(version);
  return assets.map(asset => {
    validateUserscriptHeader(asset.source);
    const source = setUserscriptVersion(asset.source, version);
    validateUserscriptHeader(source);
    return {...asset, source};
  });
}

function readPublishedRelease(names, gh) {
  const {tagName: tag} = JSON.parse(gh(['view', '--json', 'tagName']));
  if (!tag || typeof tag !== 'string') throw new Error('Cannot determine the latest published release');
  const versions = names.map(name => {
    const contents = gh(['download', tag, '--pattern', name, '--output', '-']);
    const version = validateUserscriptHeader(contents);
    assertVersion(version);
    return version;
  });
  return {tag, versions};
}

function validateDictionaryPair(bytes, metadataBytes) {
  const metadata = JSON.parse(metadataBytes);
  if (metadata.schemaVersion !== METADATA_SCHEMA_VERSION) throw new Error('Invalid dictionary metadata schema');
  const revision = crypto.createHash('sha256').update(bytes).digest('hex');
  if (metadata.revision !== revision) throw new Error('Dictionary revision does not match metadata');
  if (metadata.payload !== undefined && metadata.payload !== `vnedict.${revision}.json`) {
    throw new Error('Invalid revision-specific dictionary payload');
  }
  const entries = JSON.parse(bytes);
  if (!Array.isArray(entries) || metadata.entryCount !== entries.length) {
    throw new Error('Dictionary entry count does not match metadata');
  }
  return metadata;
}

function main(argv = process.argv.slice(2)) {
  const dryRun = argv.includes('--dry-run');
  const gh = args => execFileSync('gh', ['release', ...args], {
    encoding: 'utf8', cwd: repoPaths.rootDir, maxBuffer: 50 * 1024 * 1024
  });
  const assets = KEYS.map((key) => {
    const file = repoPaths.distPath(key);
    if (!fs.existsSync(file)) {
      throw new Error(`Missing ${file}: run \`make rebuild-userscripts\` first`);
    }
    const version = readUserscriptVersion(fs.readFileSync(file, 'utf8'));
    return {file, version, bytes: fs.statSync(file).size};
  });

  const dictionaryAssets = DICTIONARY_KEYS.map((key) => {
    const file = repoPaths.absolute[key];
    if (!fs.existsSync(file)) {
      throw new Error(`Missing ${file}: run \`make rebuild-extension-vnedict-json\` first`);
    }
    return {file, bytes: fs.statSync(file).size};
  });
  const metadata = validateDictionaryPair(fs.readFileSync(repoPaths.absolute.runtimeDictionary),
    fs.readFileSync(repoPaths.absolute.runtimeDictionaryMetadata, 'utf8'));
  if (metadata.payload) {
    const immutable = path.join(path.dirname(repoPaths.absolute.runtimeDictionaryMetadata), metadata.payload);
    if (!fs.existsSync(immutable)) throw new Error(`Missing immutable dictionary payload ${immutable}`);
    if (!fs.readFileSync(immutable).equals(fs.readFileSync(repoPaths.absolute.runtimeDictionary))) {
      throw new Error('Immutable dictionary payload does not match the current generation');
    }
    dictionaryAssets.push({file: immutable, bytes: fs.statSync(immutable).size});
  }

  OPTIONAL_DATA_KEYS.forEach((key) => {
    const file = repoPaths.absolute[key];
    if (fs.existsSync(file)) {
      dictionaryAssets.push({file, bytes: fs.statSync(file).size});
    } else {
      console.warn(`Warning: ${file} is missing: this release ships no chunom.org data (run import-chunom-standard.js first if the userscripts should carry it)`);
    }
  });

  // The latest published files, rather than ignored local builds, are the version authority.
  // Pin a tag for both downloads and check it again immediately before publication.
  const published = readPublishedRelease(assets.map(asset => path.basename(asset.file)), gh);
  const version = chooseReleaseVersion(published.versions, versionDatestamp(), process.env.RELEASE_VERSION);
  const stamped = stampReleaseAssets(assets.map(asset => ({...asset, source: fs.readFileSync(asset.file, 'utf8')})), version);
  stamped.forEach(asset => {
    fs.writeFileSync(asset.file, asset.source);
    asset.version = version;
    asset.bytes = Buffer.byteLength(asset.source);
  });

  const releaseAssets = stamped.concat(dictionaryAssets);
  const assetNames = releaseAssets.map(asset => path.relative(repoPaths.rootDir, asset.file).split(path.sep).join('/'));
  const manifest = createReleaseManifest(releaseManifestOptions(repoPaths.rootDir, assetNames));
  const snapshotFile = path.join(repoPaths.rootDir, 'dist', 'zoopdog-release-inputs.json');
  if (!fs.existsSync(snapshotFile)) throw new Error('Missing release input snapshot; run make release-userscripts');
  assertReleaseInputsUnchanged(JSON.parse(fs.readFileSync(snapshotFile, 'utf8')), manifest);
  const manifestFile = path.join(repoPaths.rootDir, 'dist', 'zoopdog-release-manifest.json');
  atomicWrite(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  verifyReleaseManifest(repoPaths.rootDir, JSON.parse(fs.readFileSync(manifestFile, 'utf8')));

  const tag = releaseTag();
  const notes = stamped.map(({file, version}) => `- ${path.basename(file)} @version ${version}`).join('\n');
  for (const asset of stamped) {
    console.log(`${asset.file}  @version ${asset.version}  ${asset.bytes} bytes`);
  }
  for (const asset of dictionaryAssets) {
    console.log(`${asset.file}  ${asset.bytes} bytes`);
  }
  console.log(`Release manifest: ${manifestFile}`);
  console.log(`Release tag: ${tag}`);
  if (dryRun) {
    console.log('Dry run: nothing published.');
    return;
  }

  const currentTag = JSON.parse(gh(['view', '--json', 'tagName'])).tagName;
  if (currentTag !== published.tag) throw new Error('Latest release changed during preflight; rebuild and retry');
  verifyReleaseManifest(repoPaths.rootDir, manifest);

  execFileSync('gh', [
    'release', 'create', tag, ...releaseAssets.map((asset) => asset.file), manifestFile,
    '--title', tag, '--notes', notes, '--latest'
  ], {stdio: 'inherit', cwd: repoPaths.rootDir});
}

module.exports = {releaseTag, chooseReleaseVersion, stampReleaseAssets, readPublishedRelease, validateDictionaryPair, validateUserscriptHeader, main};

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.code === 'ENOENT' ? 'The GitHub CLI (`gh`) is not installed: brew install gh' : error.message);
    process.exit(1);
  }
}
