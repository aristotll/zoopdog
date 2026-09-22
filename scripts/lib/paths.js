'use strict';

const path = require('node:path');

const rootDir = path.resolve(__dirname, '../..');

// Repository-relative locations, kept as relative strings so callers that operate on an
// alternate root (tests, isolated fixtures) can resolve them against their own base.
const relative = Object.freeze({
  baseDictionarySource: 'zd-extension/db_src/vnedict.txt',
  baseDictionary: 'zd-extension/db_src/vnedict.json',
  dictionary: 'zd-extension/db_src/vnedict2.json',
  runtimeDictionary: 'zd-extension/js/vnedict.json',
  runtimeDictionaryMetadata: 'zd-extension/js/vnedict.meta.json',
  runtimeDictionaryCollisions: 'zd-extension/js/vnedict.collisions.json',
  mdxNom: 'zd-extension/db_src/mdx_nom.json',
  userNomEntries: 'zd-extension/db_src/user_nom_entries',
  userNomOrder: 'zd-extension/db_src/user_nom_order.jsonc',
  nomFontLocal: 'zd-extension/db_src/fonts/NomNaTong-Regular.otf',
  nomUserscript: 'zoopdog-nom-ruby.user.js',
  popupUserscript: 'zoopdog-popupdict.user.js',
  nomLocalUserscript: 'zoopdog-nom-ruby-local.user.js',
  popupLocalUserscript: 'zoopdog-popupdict-local.user.js',
  distDir: 'dist',
  defaultInput: '.idea/newfile.md',
  openspecChanges: 'openspec/changes',
  openspecArchive: 'openspec/changes/archive',
  openspecSpecs: 'openspec/specs'
});

function assertKnown(key) {
  if (!Object.hasOwn(relative, key)) {
    throw new Error(`Unknown repository path: ${key}`);
  }
}

function resolveIn(base, key) {
  assertKnown(key);
  return path.join(base, relative[key]);
}

// The userscripts are published as assets of the latest GitHub Release, not committed: the
// embedded dictionaries make each build megabytes of churn per commit. `releases/latest/
// download/<asset>` always redirects to the newest release, so the URL never changes and
// installed copies keep updating. The asset name is the built file's basename.
const releaseBaseUrl = 'https://github.com/aristotll/zoopdog/releases/latest/download';

function releaseUrl(key) {
  assertKnown(key);
  return `${releaseBaseUrl}/${path.basename(relative[key])}`;
}

// Minified release builds live here (gitignored); the readable build at the repository root
// stays the contract for scripts/add-chu-nom and the tests.
function distPath(key, base = rootDir) {
  assertKnown(key);
  return path.join(base, relative.distDir, path.basename(relative[key]));
}

// The -local userscripts never publish to github: they update from their own built file on
// this machine, so Violentmonkey's "track local file" polling picks up a rebuild directly.
function localFileUrl(key) {
  assertKnown(key);
  return `file://${resolveIn(rootDir, key)}`;
}

const absolute = Object.freeze(Object.fromEntries(
  Object.keys(relative).map((key) => [key, resolveIn(rootDir, key)])
));

module.exports = {
  rootDir,
  relative,
  absolute,
  resolveIn,
  releaseBaseUrl,
  releaseUrl,
  distPath,
  localFileUrl
};
