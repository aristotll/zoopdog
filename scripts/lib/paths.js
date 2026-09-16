'use strict';

const path = require('node:path');

const rootDir = path.resolve(__dirname, '../..');

// Repository-relative locations, kept as relative strings so callers that operate on an
// alternate root (tests, isolated fixtures) can resolve them against their own base.
const relative = Object.freeze({
  dictionary: 'zd-extension/db_src/vnedict2.json',
  runtimeDictionary: 'zd-extension/js/vnedict.json',
  runtimeDictionaryMetadata: 'zd-extension/js/vnedict.meta.json',
  mdxNom: 'zd-extension/db_src/mdx_nom.json',
  userNomEntries: 'zd-extension/db_src/user_nom_entries',
  userNomOrder: 'zd-extension/db_src/user_nom_order.jsonc',
  nomFontLocal: 'zd-extension/db_src/fonts/NomNaTong-Regular.otf',
  nomUserscript: 'zoopdog-nom-ruby.user.js',
  popupUserscript: 'zoopdog-popupdict.user.js',
  nomLocalUserscript: 'zoopdog-nom-ruby-local.user.js',
  popupLocalUserscript: 'zoopdog-popupdict-local.user.js',
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

// Where the generated files are published. A userscript installed from this branch keeps
// updating from this branch, so the branch is part of the userscript's update contract and is
// declared here beside the paths rather than spelled out again in each runtime header.
const rawBaseUrl = 'https://raw.githubusercontent.com/aristotll/zoopdog/master';

function rawUrl(key) {
  assertKnown(key);
  return `${rawBaseUrl}/${relative[key]}`;
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
  rawBaseUrl,
  rawUrl,
  localFileUrl
};
