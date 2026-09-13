'use strict';

// Covers scripts/watch-local-userscripts.js's pure change-detection and rebuild-trigger logic
// against a real (but mutable) copy of the repo -- never the actual repository, since these
// tests deliberately corrupt and edit shard files to exercise both the happy path and a
// builder failure.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {makeRealBuildCopy} = require('./helpers/real-build-copy');

const repoRoot = path.join(__dirname, '..');

// makeRealBuildCopy symlinks user_nom_entries/ and user_nom_order.jsonc as read-only, which is
// exactly wrong for these tests -- they need to mutate those inputs without ever touching the
// real committed files. Swap the two symlinks for private copies.
function makeMutableBuildCopy(t) {
  const dir = makeRealBuildCopy(t, repoRoot);

  const shardTarget = path.join(dir, 'zd-extension/db_src/user_nom_entries');
  const orderTarget = path.join(dir, 'zd-extension/db_src/user_nom_order.jsonc');

  fs.unlinkSync(shardTarget);
  fs.cpSync(path.join(repoRoot, 'zd-extension/db_src/user_nom_entries'), shardTarget, {recursive: true});

  fs.unlinkSync(orderTarget);
  fs.cpSync(path.join(repoRoot, 'zd-extension/db_src/user_nom_order.jsonc'), orderTarget);

  return dir;
}

function loadWatcher(dir) {
  const modulePath = path.join(dir, 'scripts', 'watch-local-userscripts.js');
  delete require.cache[require.resolve(modulePath)];
  return require(modulePath);
}

function firstShard(dir) {
  return path.join(dir, 'zd-extension/db_src/user_nom_entries/00/00.csv');
}

test('computeInputsHash changes when a shard file changes, and only then', (t) => {
  const dir = makeMutableBuildCopy(t);
  const {computeInputsHash} = loadWatcher(dir);

  const before = computeInputsHash();
  assert.equal(computeInputsHash(), before, 'hashing twice with no edits is stable');

  fs.appendFileSync(firstShard(dir), '');
  assert.equal(computeInputsHash(), before, 'touching a file without changing its bytes does not change the hash');

  const original = fs.readFileSync(firstShard(dir), 'utf8');
  fs.writeFileSync(firstShard(dir), `${original}"ba","巴",""\n`);
  assert.notEqual(computeInputsHash(), before, 'editing a shard file changes the hash');
});

test('checkAndRebuild is a no-op when the hash is unchanged', (t) => {
  const dir = makeMutableBuildCopy(t);
  const {computeInputsHash, checkAndRebuild} = loadWatcher(dir);
  const log = t.mock.method(console, 'log');

  const hash = computeInputsHash();
  const result = checkAndRebuild(hash);

  assert.equal(result, hash);
  assert.equal(log.mock.calls.length, 0, 'an unchanged input never logs a rebuild');
  assert.ok(!fs.existsSync(path.join(dir, 'zoopdog-nom-ruby-local.user.js')),
    'no local userscript is written when nothing changed');
});

test('checkAndRebuild rebuilds only the local userscript variants when the input changed', (t) => {
  const dir = makeMutableBuildCopy(t);
  const {computeInputsHash, checkAndRebuild} = loadWatcher(dir);
  t.mock.method(console, 'log');

  const baseline = computeInputsHash();
  const original = fs.readFileSync(firstShard(dir), 'utf8');
  fs.writeFileSync(firstShard(dir), `${original}"ba","巴",""\n`);

  const result = checkAndRebuild(baseline);

  assert.notEqual(result, baseline);
  assert.equal(result, computeInputsHash());
  assert.ok(fs.existsSync(path.join(dir, 'zoopdog-nom-ruby-local.user.js')));
  assert.ok(fs.existsSync(path.join(dir, 'zoopdog-popupdict-local.user.js')));
  assert.ok(!fs.existsSync(path.join(dir, 'zoopdog-nom-ruby.user.js')),
    'the github-hosted variant is never built by the watcher');
});

test('checkAndRebuild keeps retrying (never advances past) a change that makes a builder fail', (t) => {
  const dir = makeMutableBuildCopy(t);
  const {computeInputsHash, checkAndRebuild} = loadWatcher(dir);
  const errorLog = t.mock.method(console, 'error');
  t.mock.method(console, 'log');

  const baseline = computeInputsHash();

  // A file both builders read unconditionally (no existsSync guard); removing it makes the
  // rebuild throw regardless of shard content, without needing a malformed CSV fixture.
  const requiredFile = path.join(dir, 'zd-extension/js/zd-nom-match.js');
  const requiredFileContent = fs.readFileSync(requiredFile);
  fs.rmSync(requiredFile);

  const original = fs.readFileSync(firstShard(dir), 'utf8');
  fs.writeFileSync(firstShard(dir), `${original}"ba","巴",""\n`);
  const changedHash = computeInputsHash();

  const failedResult = checkAndRebuild(baseline);
  assert.equal(failedResult, baseline, 'a failed rebuild does not advance the remembered hash');
  assert.ok(errorLog.mock.calls.length > 0, 'the failure is logged, not swallowed');

  fs.writeFileSync(requiredFile, requiredFileContent);
  const recoveredResult = checkAndRebuild(failedResult);
  assert.equal(recoveredResult, changedHash, 'the same change rebuilds successfully once the failure is fixed');
});
