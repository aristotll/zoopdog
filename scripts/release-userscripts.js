#!/usr/bin/env node

// Publishes the minified userscripts in dist/ as assets of a new GitHub Release
// (`make release-userscripts`). The @updateURL/@downloadURL in each script point at
// releases/latest/download/<name>, so a new release is what makes installed copies update.
// Needs the GitHub CLI (`gh`) authenticated for the repository. `--dry-run` prints the plan only.

'use strict';

const fs = require('node:fs');
const {execFileSync} = require('node:child_process');
const repoPaths = require('./lib/paths');
const {readUserscriptVersion} = require('./lib/userscript');

const KEYS = ['nomUserscript', 'popupUserscript'];
// Generated, gitignored runtime dictionary: shipped as-is (not minified) so the extension and
// website can be built from a release instead of from committed 7MB blobs.
const DICTIONARY_KEYS = ['runtimeDictionary', 'runtimeDictionaryMetadata'];

function releaseTag(now = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `userscripts-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function main(argv = process.argv.slice(2)) {
  const dryRun = argv.includes('--dry-run');
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

  const tag = releaseTag();
  const notes = assets.map(({file, version}) => `- ${require('node:path').basename(file)} @version ${version}`).join('\n');
  for (const asset of assets) {
    console.log(`${asset.file}  @version ${asset.version}  ${asset.bytes} bytes`);
  }
  for (const asset of dictionaryAssets) {
    console.log(`${asset.file}  ${asset.bytes} bytes`);
  }
  console.log(`Release tag: ${tag}`);
  if (dryRun) {
    console.log('Dry run: nothing published.');
    return;
  }

  execFileSync('gh', [
    'release', 'create', tag, ...assets.concat(dictionaryAssets).map((asset) => asset.file),
    '--title', tag, '--notes', notes, '--latest'
  ], {stdio: 'inherit', cwd: repoPaths.rootDir});
}

module.exports = {releaseTag, main};

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.code === 'ENOENT' ? 'The GitHub CLI (`gh`) is not installed: brew install gh' : error.message);
    process.exit(1);
  }
}
