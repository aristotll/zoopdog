const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const lock = require('../scripts/add-chu-nom/lock');
const journal = require('../scripts/add-chu-nom/journal');
const {WorkflowError} = require('../scripts/add-chu-nom/errors');

function makeRepoRoot(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zoopdog-lock-'));
  // `t.after` hooks run in the order they were registered, so this removal (registered here,
  // first) always runs *after* the lock cleanup a test registers later -- tests must therefore
  // release any lock they hold before returning rather than relying on hook ordering.
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  return dir;
}

test('acquireLock creates an owner record and releaseLock removes the lock directory', (t) => {
  const root = makeRepoRoot(t);
  const owner = lock.acquireLock(root, {operation: 'apply'});
  assert.equal(owner.pid, process.pid);
  assert.match(owner.token, /^[a-f0-9]{32}$/);
  assert.ok(fs.existsSync(lock.lockDirPath(root)));
  lock.releaseLock(root, owner.token);
  assert.ok(!fs.existsSync(lock.lockDirPath(root)));
});

test('a second acquisition is refused while the first is held (contention)', (t) => {
  const root = makeRepoRoot(t);
  const owner = lock.acquireLock(root, {operation: 'apply'});
  assert.throws(
    () => lock.acquireLock(root, {operation: 'apply', waitMs: 0}),
    (error) => error instanceof WorkflowError && error.code === 'workflow_busy' &&
      error.details.owner.pid === process.pid
  );
  lock.releaseLock(root, owner.token);
});

test('releaseLock refuses to release a lock this token does not own', (t) => {
  const root = makeRepoRoot(t);
  const owner = lock.acquireLock(root, {operation: 'apply'});
  assert.throws(
    () => lock.releaseLock(root, 'not-the-real-token'),
    (error) => error instanceof WorkflowError && error.code === 'workflow_lock_owner_mismatch'
  );
  // The lock must still be intact and releasable by its real owner after the refusal.
  lock.releaseLock(root, owner.token);
});

test('planRecovery reports "clean" when no lock exists', (t) => {
  const root = makeRepoRoot(t);
  assert.deepEqual(lock.planRecovery(root, {readJournal: journal.readJournal}), {status: 'clean'});
});

test('planRecovery reports "live" for a lock owned by this still-running process', (t) => {
  const root = makeRepoRoot(t);
  const owner = lock.acquireLock(root, {operation: 'apply'});
  const plan = lock.planRecovery(root, {readJournal: journal.readJournal});
  assert.equal(plan.status, 'live');
  lock.releaseLock(root, owner.token);
});

test('planRecovery reports "recoverable" for a lock owned by a PID that does not exist', (t) => {
  const root = makeRepoRoot(t);
  fs.mkdirSync(lock.lockDirPath(root), {recursive: true});
  fs.writeFileSync(lock.ownerFilePath(root), JSON.stringify({
    schemaVersion: 1,
    token: 'deadbeef',
    pid: 999999, // not a real PID in any reasonable test environment
    startSignature: null,
    operation: 'apply',
    manifestPath: null,
    acquiredAt: new Date().toISOString()
  }));
  const plan = lock.planRecovery(root, {readJournal: journal.readJournal});
  assert.equal(plan.status, 'recoverable');
  const result = lock.recover(root, plan);
  assert.equal(result.recovered, true);
  assert.ok(!fs.existsSync(lock.lockDirPath(root)));
});

test('planRecovery reports "ambiguous" for a corrupt owner record and refuses recovery', (t) => {
  const root = makeRepoRoot(t);
  fs.mkdirSync(lock.lockDirPath(root), {recursive: true});
  fs.writeFileSync(lock.ownerFilePath(root), '{not valid json');
  const plan = lock.planRecovery(root, {readJournal: journal.readJournal});
  assert.equal(plan.status, 'ambiguous');
  assert.throws(
    () => lock.recover(root, plan),
    (error) => error instanceof WorkflowError && error.code === 'workflow_lock_recovery_required'
  );
  // Refusing recovery must not have mutated anything.
  assert.ok(fs.existsSync(lock.lockDirPath(root)));
});

test('planRecovery reports "needs_operator_recovery" for a dead owner with a partially-written file', (t) => {
  const root = makeRepoRoot(t);
  const target = path.join(root, 'owned-file.txt');
  fs.writeFileSync(target, 'original');
  const {hashFile} = require('../scripts/add-chu-nom/fsutil');
  const preHash = hashFile(target);

  fs.mkdirSync(lock.lockDirPath(root), {recursive: true});
  fs.writeFileSync(lock.ownerFilePath(root), JSON.stringify({
    schemaVersion: 1, token: 'deadbeef', pid: 999999, startSignature: null,
    operation: 'apply', manifestPath: null, acquiredAt: new Date().toISOString()
  }));
  journal.writeJournal(root, {
    token: 'deadbeef', operation: 'apply', phase: 'mutating',
    files: [{path: target, preHash}]
  });
  // Simulate a kill mid-write: bytes changed but the journal was never marked committed.
  fs.writeFileSync(target, 'half-written');

  const plan = lock.planRecovery(root, {readJournal: journal.readJournal});
  assert.equal(plan.status, 'needs_operator_recovery');
  assert.equal(plan.mismatches.length, 1);
  assert.throws(
    () => lock.recover(root, plan),
    (error) => error instanceof WorkflowError && error.code === 'workflow_lock_recovery_required'
  );
  assert.equal(fs.readFileSync(target, 'utf8'), 'half-written', 'refused recovery never touches file bytes');
});

test('planRecovery reports "recoverable" for a dead owner whose journal never got past preimage', (t) => {
  const root = makeRepoRoot(t);
  const target = path.join(root, 'owned-file.txt');
  fs.writeFileSync(target, 'original');
  const {hashFile} = require('../scripts/add-chu-nom/fsutil');
  const preHash = hashFile(target);

  fs.mkdirSync(lock.lockDirPath(root), {recursive: true});
  fs.writeFileSync(lock.ownerFilePath(root), JSON.stringify({
    schemaVersion: 1, token: 'deadbeef', pid: 999999, startSignature: null,
    operation: 'apply', manifestPath: null, acquiredAt: new Date().toISOString()
  }));
  journal.writeJournal(root, {
    token: 'deadbeef', operation: 'apply', phase: 'mutating',
    files: [{path: target, preHash}]
  });
  // Process died before it wrote anything: the file is untouched.

  const plan = lock.planRecovery(root, {readJournal: journal.readJournal});
  assert.equal(plan.status, 'recoverable');
  const result = lock.recover(root, plan);
  assert.equal(result.recovered, true);
});

test('isProcessAlive is true for this process and false for an unused PID', () => {
  assert.equal(lock.isProcessAlive(process.pid), true);
  assert.equal(lock.isProcessAlive(999999), false);
});

test('journal readJournal returns null for a missing or corrupt journal file', (t) => {
  const root = makeRepoRoot(t);
  assert.equal(journal.readJournal(root), null);
  fs.mkdirSync(path.join(root, lock.CONTROL_DIR_NAME), {recursive: true});
  fs.writeFileSync(journal.journalFilePath(root), 'not json');
  assert.equal(journal.readJournal(root), null);
});

test('journal writeJournal/clearJournal round-trip', (t) => {
  const root = makeRepoRoot(t);
  journal.writeJournal(root, {token: 'abc', operation: 'apply', phase: 'mutating', files: []});
  const read = journal.readJournal(root);
  assert.equal(read.token, 'abc');
  assert.equal(read.phase, 'mutating');
  journal.clearJournal(root);
  assert.equal(journal.readJournal(root), null);
});
