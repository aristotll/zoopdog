#!/usr/bin/env node

// Watches the hand-maintained Chu Nom inputs and rebuilds only the (Local) userscript variants
// (`make rebuild-local-userscripts`, i.e. `--local-only`) when they change -- so a Violentmonkey
// "track local file" install stays current without a manual rebuild after every edit.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const repoPaths = require('./lib/paths');

const CHECK_INTERVAL_MS = 60 * 1000;

const shardRoot = repoPaths.absolute.userNomEntries;
const orderPath = repoPaths.absolute.userNomOrder;

// Sorted so the hash never depends on directory-listing order, which varies by filesystem.
function collectFiles(dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }

  return fs.readdirSync(dir, {recursive: true})
    .map((entry) => path.join(dir, entry))
    .filter((entryPath) => fs.statSync(entryPath).isFile())
    .sort();
}

// One hash over every watched input's path and content, so any edit -- a shard row added,
// removed, or reordered, or the display-order file touched -- changes the result.
function computeInputsHash() {
  const hash = crypto.createHash('sha256');

  for (const filePath of collectFiles(shardRoot)) {
    hash.update(path.relative(shardRoot, filePath));
    hash.update('\0');
    hash.update(fs.readFileSync(filePath));
    hash.update('\0');
  }

  if (fs.existsSync(orderPath)) {
    hash.update('user_nom_order.jsonc\0');
    hash.update(fs.readFileSync(orderPath));
  }

  return hash.digest('hex');
}

// Each builder is isolated: a failure in one (e.g. a malformed shard) must not stop the other
// from rebuilding, and must not be swallowed -- it's logged so the next cycle's retry is visible.
function rebuildLocalUserscripts() {
  const builders = [
    ['build-nom-userscript', require('./build-nom-userscript')],
    ['build-popupdict-userscript', require('./build-popupdict-userscript')]
  ];

  let allSucceeded = true;

  for (const [name, builder] of builders) {
    try {
      builder.main(['--local-only']);
    } catch (error) {
      allSucceeded = false;
      console.error(`[watch-local-userscripts] ${name} failed: ${error.message}`);
    }
  }

  return allSucceeded;
}

// Compares `previousHash` against the current input state and rebuilds on a difference.
// Returns the hash to remember for the next cycle: the new hash once every builder has
// succeeded, or `previousHash` unchanged so a failed rebuild is retried next cycle instead of
// silently going stale.
function checkAndRebuild(previousHash) {
  const currentHash = computeInputsHash();

  if (currentHash === previousHash) {
    return previousHash;
  }

  console.log('[watch-local-userscripts] change detected, rebuilding local userscripts');
  const succeeded = rebuildLocalUserscripts();

  if (!succeeded) {
    return previousHash;
  }

  console.log('[watch-local-userscripts] rebuild complete');
  return currentHash;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Runs until the process is signaled to stop. The first cycle only records a baseline -- it
// never rebuilds on startup -- since a running watcher assumes the local userscripts already
// match the current entries.
async function main() {
  let running = true;
  const stop = () => {
    running = false;
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);

  let lastHash = computeInputsHash();
  console.log('[watch-local-userscripts] watching for changes, checking every 60s');

  while (running) {
    await sleep(CHECK_INTERVAL_MS);
    if (!running) {
      break;
    }
    lastHash = checkAndRebuild(lastHash);
  }

  console.log('[watch-local-userscripts] stopped');
}

module.exports = {
  computeInputsHash,
  checkAndRebuild,
  main
};

if (require.main === module) {
  main();
}
