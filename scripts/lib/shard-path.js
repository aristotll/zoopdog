'use strict';

const crypto = require('node:crypto');
const {normalizeTerm} = require('./text');

const SHARD_COUNT = 128;
const FOLDERS_PER_ROOT = 8;
const FILES_PER_FOLDER = SHARD_COUNT / FOLDERS_PER_ROOT;

// Deterministic bucket for a `vi` term: SHA-256 of its normalized form, first 16 bits of the
// digest mod 128. 16 bits of entropy is far more than 128 buckets need while staying trivial to
// re-derive by hand.
// This exact algorithm is also implemented independently in `book-translator` (Python) against
// the shared fixture in `zd-extension/db_src/user_nom_entries/SHARDING.md` -- changing it here
// without updating that fixture and the Python side breaks cross-repo agreement on which shard a
// term belongs to.
function shardIndexFor(vi) {
  const digest = crypto.createHash('sha256').update(normalizeTerm(vi), 'utf8').digest('hex');
  return parseInt(digest.slice(0, 4), 16) % SHARD_COUNT;
}

function shardComponentsFor(vi) {
  const index = shardIndexFor(vi);
  const folder = String(Math.floor(index / FILES_PER_FOLDER)).padStart(2, '0');
  const file = String(index % FILES_PER_FOLDER).padStart(2, '0');
  return {index, folder, file};
}

// Relative to the shard root directory, e.g. "03/07.csv".
function shardPathFor(vi) {
  const {folder, file} = shardComponentsFor(vi);
  return `${folder}/${file}.csv`;
}

// Every shard path that must exist, in order -- the fixed enumeration the store relies on
// instead of a directory listing (see design.md Decision 2).
function allShardPaths() {
  const paths = [];
  for (let folder = 0; folder < FOLDERS_PER_ROOT; folder++) {
    for (let file = 0; file < FILES_PER_FOLDER; file++) {
      paths.push(`${String(folder).padStart(2, '0')}/${String(file).padStart(2, '0')}.csv`);
    }
  }
  return paths;
}

module.exports = {
  SHARD_COUNT,
  FOLDERS_PER_ROOT,
  FILES_PER_FOLDER,
  shardIndexFor,
  shardComponentsFor,
  shardPathFor,
  allShardPaths
};
