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
  userNomEntries: 'zd-extension/db_src/user_nom_entries.jsonc',
  nomUserscript: 'zoopdog-nom-ruby.user.js',
  popupUserscript: 'zoopdog-popupdict.user.js',
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

const absolute = Object.freeze(Object.fromEntries(
  Object.keys(relative).map((key) => [key, resolveIn(rootDir, key)])
));

module.exports = {
  rootDir,
  relative,
  absolute,
  resolveIn,
  rawBaseUrl,
  rawUrl
};
