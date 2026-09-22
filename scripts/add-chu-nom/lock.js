'use strict';

// Repository-local, dependency-free mutual exclusion for the Chu Nom workflow.
//
// The control directory lives inside the repository root (not under `.git/`, so it works the
// same from a direct checkout or a submodule invocation that only ever resolves paths relative
// to `repoRoot`) and is gitignored. Exclusivity comes from `fs.mkdirSync` on the lock
// subdirectory: a single `mkdir` syscall either creates the directory or fails with `EEXIST`,
// so no two processes can ever believe they both hold it. Owner metadata is then written
// *inside* the directory this process just exclusively created, which is safe because no other
// process can proceed past its own `mkdirSync` until this one releases the lock.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const {WorkflowError} = require('./errors');
const {atomicWrite} = require('../lib/fsutil');

const LOCK_SCHEMA_VERSION = 1;
const CONTROL_DIR_NAME = '.zd-chu-nom-workflow';

function controlDir(repoRoot) {
  return path.join(repoRoot, CONTROL_DIR_NAME);
}

function lockDirPath(repoRoot) {
  return path.join(controlDir(repoRoot), 'lock');
}

function ownerFilePath(repoRoot) {
  return path.join(lockDirPath(repoRoot), 'owner.json');
}

// Best-effort process-start identity so a reused PID after a crash is not mistaken for the
// original owner. Unavailable platforms (no `ps`) simply record `null`, which downstream
// liveness checks treat conservatively (see `isOwnerLive`).
function processStartSignature(pid) {
  try {
    const out = execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']});
    const trimmed = out.trim();
    return trimmed || null;
  } catch {
    return null;
  }
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // ESRCH: no such process, so definitely dead. Any other errno (e.g. EPERM for a PID we
    // cannot signal) means we could not disprove liveness, so treat it as alive.
    return error.code !== 'ESRCH';
  }
}

function readOwnerRecord(repoRoot) {
  const file = ownerFilePath(repoRoot);
  if (!fs.existsSync(file)) {
    return {ok: true, owner: null};
  }
  try {
    const owner = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!owner || owner.schemaVersion !== LOCK_SCHEMA_VERSION ||
        typeof owner.token !== 'string' || !Number.isInteger(owner.pid)) {
      return {ok: false, owner: null};
    }
    return {ok: true, owner};
  } catch {
    return {ok: false, owner: null};
  }
}

// True only when the recorded owner is provably still the same running process.
function isOwnerLive(owner) {
  if (!owner) return false;
  if (!isProcessAlive(owner.pid)) return false;
  if (owner.startSignature == null) return true; // could not disprove; stay conservative
  const current = processStartSignature(owner.pid);
  if (current == null) return true; // still cannot disprove
  return current === owner.startSignature;
}

function sleepSync(ms) {
  const shared = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(shared, 0, 0, ms);
}

// Attempts one exclusive acquisition. Returns the owner record on success, or `null` if another
// live-or-unknown owner already holds the directory.
function tryAcquireOnce(repoRoot, {operation, manifestPath}) {
  fs.mkdirSync(controlDir(repoRoot), {recursive: true});
  const dir = lockDirPath(repoRoot);
  try {
    fs.mkdirSync(dir);
  } catch (error) {
    if (error.code === 'EEXIST') return null;
    throw error;
  }
  const owner = {
    schemaVersion: LOCK_SCHEMA_VERSION,
    token: crypto.randomBytes(16).toString('hex'),
    pid: process.pid,
    startSignature: processStartSignature(process.pid),
    operation,
    manifestPath: manifestPath || null,
    acquiredAt: new Date().toISOString()
  };
  fs.writeFileSync(ownerFilePath(repoRoot), `${JSON.stringify(owner, null, 2)}\n`);
  return owner;
}

// Acquires the workflow lock, failing fast by default. Pass `waitMs` to poll for a bounded
// duration instead (never unbounded, per design decision 3).
function acquireLock(repoRoot, {operation, manifestPath, waitMs = 0, pollIntervalMs = 25} = {}) {
  const deadline = Date.now() + Math.max(0, waitMs);
  for (;;) {
    const owner = tryAcquireOnce(repoRoot, {operation, manifestPath});
    if (owner) {
      return owner;
    }
    const {owner: currentOwner} = readOwnerRecord(repoRoot);
    if (Date.now() >= deadline) {
      throw new WorkflowError('workflow_busy',
        'Another add-chu-nom session holds the workflow lock.',
        {owner: currentOwner});
    }
    sleepSync(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())));
  }
}

// Releases a lock this process owns. Verifies the token so a process can never release a lock
// it does not actually hold (for instance after losing a race to a recovery tool).
function releaseLock(repoRoot, token) {
  const {owner} = readOwnerRecord(repoRoot);
  if (!owner || owner.token !== token) {
    throw new WorkflowError('workflow_lock_owner_mismatch',
      'The workflow lock changed ownership before it could be released.');
  }
  fs.rmSync(lockDirPath(repoRoot), {recursive: true, force: true});
}

// Read-only plan for `recover`: never mutates, always safe to call.
function planRecovery(repoRoot, {readJournal} = {}) {
  if (!fs.existsSync(lockDirPath(repoRoot))) {
    return {status: 'clean'};
  }
  const {ok, owner} = readOwnerRecord(repoRoot);
  if (!ok) {
    return {status: 'ambiguous', reason: 'owner_record_corrupt'};
  }
  if (isOwnerLive(owner)) {
    return {status: 'live', owner};
  }
  const journal = readJournal ? readJournal(repoRoot) : null;
  if (!journal || journal.phase === 'idle' || journal.phase === 'committed' || journal.phase === 'rolled_back') {
    return {status: 'recoverable', owner, journal};
  }
  // journal.phase === 'mutating': only safe to auto-recover if every recorded file is
  // demonstrably in either its pre-mutation or fully-written state -- i.e. nothing was left
  // half-written.
  const {hashFile} = require('./fsutil');
  const mismatches = [];
  for (const file of journal.files || []) {
    const current = hashFile(file.path);
    const settled = current === file.preHash || (file.postHash !== undefined && current === file.postHash);
    if (!settled) {
      mismatches.push({path: file.path, expectedPre: file.preHash, expectedPost: file.postHash, actual: current});
    }
  }
  if (mismatches.length) {
    return {status: 'needs_operator_recovery', owner, journal, mismatches};
  }
  return {status: 'recoverable', owner, journal};
}

function recover(repoRoot, plan) {
  if (plan.status === 'clean') {
    return {recovered: false, reason: 'no_lock_present'};
  }
  if (plan.status !== 'recoverable') {
    throw new WorkflowError('workflow_lock_recovery_required',
      'The workflow lock cannot be recovered automatically; it needs operator inspection.',
      {status: plan.status, owner: plan.owner, mismatches: plan.mismatches});
  }
  fs.rmSync(lockDirPath(repoRoot), {recursive: true, force: true});
  const {clearJournal} = require('./journal');
  clearJournal(repoRoot);
  return {recovered: true, previousOwner: plan.owner};
}

module.exports = {
  LOCK_SCHEMA_VERSION,
  CONTROL_DIR_NAME,
  controlDir,
  lockDirPath,
  ownerFilePath,
  processStartSignature,
  isProcessAlive,
  isOwnerLive,
  readOwnerRecord,
  acquireLock,
  releaseLock,
  planRecovery,
  recover
};
