// Multi-process concurrency and interruption/recovery coverage for the Chu Nom workflow lock
// (openspec/changes/serialize-chu-nom-apply-transactions). Every fixture here is an isolated
// temp-directory repository copy -- these tests never touch the real repository's workflow
// files, and never lock the real repository (see task 4.4).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawn} = require('node:child_process');

const shardPath = require('../scripts/lib/shard-path');
const nomStore = require('../scripts/lib/nom-entries-store');
const cli = require('../scripts/add-chu-nom');
const lock = require('../scripts/add-chu-nom/lock');
const journal = require('../scripts/add-chu-nom/journal');
const repoRoot = path.resolve(__dirname, '..');
const cliEntry = path.join(repoRoot, 'scripts/add-chu-nom.js');

const USER_NOM_ENTRIES_RELATIVE = 'zd-extension/db_src/user_nom_entries';

function userNomEntriesDir(root) {
  return path.join(root, USER_NOM_ENTRIES_RELATIVE);
}

function writeEmptyShards(dir) {
  for (const relative of shardPath.allShardPaths()) {
    const target = path.join(dir, relative);
    fs.mkdirSync(path.dirname(target), {recursive: true});
    fs.writeFileSync(target, 'vi,nom,explain\n');
  }
}

function writeJson(target, value) {
  fs.mkdirSync(path.dirname(target), {recursive: true});
  fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`);
}

// A trimmed copy of test/add-chu-nom.test.js's makeFixture/installRealBuilders: an isolated
// repository directory with real (not stubbed) build scripts, small enough that a real
// `apply` completes in about a second, which is what lets these tests spawn several of them
// concurrently and still finish quickly.
function makeFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zoopdog-concurrency-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));

  fs.mkdirSync(path.join(root, 'scripts'), {recursive: true});
  fs.mkdirSync(path.join(root, 'zd-extension/db_src'), {recursive: true});
  fs.mkdirSync(path.join(root, '.idea'), {recursive: true});

  writeJson(path.join(root, 'zd-extension/db_src/vnedict2.json'), [
    {vn: 'quản lý', en: [{def: '管理', pos: ''}, {def: 'manage', pos: ''}]},
    {vn: 'kiểm tra', en: [{def: '檢查', pos: ''}, {def: 'check', pos: ''}]}
  ]);
  writeJson(path.join(root, 'zd-extension/db_src/mdx_nom.json'), {entries: {}});
  writeEmptyShards(userNomEntriesDir(root));
  fs.writeFileSync(path.join(root, '.idea/newfile.md'), '# Queue\n');
  fs.writeFileSync(path.join(root, 'zoopdog-nom-ruby.user.js'), 'var NOM_MAP = {};\n');
  fs.writeFileSync(path.join(root, 'zoopdog-popupdict.user.js'), 'var ZOO_DICTIONARY = {};\n');

  for (const script of [
    'user-nom-entries.js', 'user-nom-order.js', 'build-nom-userscript.js', 'build-popupdict-userscript.js'
  ]) {
    fs.copyFileSync(path.join(repoRoot, 'scripts', script), path.join(root, 'scripts', script));
  }
  for (const directory of ['scripts/lib', 'scripts/userscript']) {
    fs.cpSync(path.join(repoRoot, directory), path.join(root, directory), {recursive: true});
  }
  for (const relative of [
    'zd-extension/js/lib/chroma.min.js', 'zd-extension/js/zd-words.js', 'zd-extension/js/zd-nom-match.js',
    'zd-extension/js/zd-pron-data.js', 'zd-extension/js/zd-pron-functions.js', 'zd-extension/js/zd-pron-drawtones.js'
  ]) {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), {recursive: true});
    fs.writeFileSync(target, '// isolated fixture runtime\n');
  }
  return root;
}

function captureIo() {
  let stdout = '';
  let stderr = '';
  return {
    io: {
      stdout: {write: (value) => { stdout += String(value); }},
      stderr: {write: (value) => { stderr += String(value); }}
    },
    stdout: () => stdout,
    stderr: () => stderr
  };
}

// Plans a single-word manifest and approves every actionable entry, entirely in-process (fast,
// no subprocess needed since neither step mutates workflow-owned files).
function planApproved(root, manifestPath, words) {
  const planOut = captureIo();
  cli.main(['plan', '--words', words, '--manifest', manifestPath, '--repo-root', root], planOut.io);
  const actionable = JSON.parse(planOut.stdout()).review.filter((record) => record.status !== 'skipped');
  const decisions = actionable.map((record) => ({id: record.id, decision: 'apply', nom: ['測'], explain: ['test']}));
  const reviewOut = captureIo();
  const decisionsPath = `${manifestPath}.decisions.json`;
  fs.writeFileSync(decisionsPath, JSON.stringify(decisions));
  const exitCode = cli.main(
    ['review', '--manifest', manifestPath, '--decisions', decisionsPath, '--repo-root', root],
    reviewOut.io
  );
  assert.equal(exitCode, cli.EXIT_CODES.SUCCESS, `setup review should succeed: ${reviewOut.stderr()}`);
  return manifestPath;
}

// Runs the real CLI entry point as a genuine child OS process (not an in-process call), which
// is what actually exercises the lock across process boundaries.
function spawnCli(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cliEntry, ...args], {stdio: ['ignore', 'pipe', 'pipe']});
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => resolve({code, stdout, stderr, pid: child.pid}));
  });
}

function waitForLock(root, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (fs.existsSync(lock.lockDirPath(root))) return resolve();
      if (Date.now() > deadline) return reject(new Error('lock was never acquired'));
      setTimeout(poll, 20);
    };
    poll();
  });
}

test('two concurrent applies from the same snapshot serialize: one succeeds, the other reports a stale plan', async (t) => {
  const root = makeFixture(t);
  const manifestA = planApproved(root, path.join(root, 'a.json'), 'quản lý');
  const manifestB = planApproved(root, path.join(root, 'b.json'), 'kiểm tra');

  const [resultA, resultB] = await Promise.all([
    spawnCli(['apply', '--manifest', manifestA, '--approve', '--repo-root', root, '--wait-ms', '10000']),
    spawnCli(['apply', '--manifest', manifestB, '--approve', '--repo-root', root, '--wait-ms', '10000'])
  ]);

  const codes = [resultA.code, resultB.code].sort();
  assert.deepEqual(codes, [cli.EXIT_CODES.SUCCESS, cli.EXIT_CODES.STALE],
    `expected one success and one stale-plan result, got A=${resultA.code} (${resultA.stderr}) B=${resultB.code} (${resultB.stderr})`);

  const [winner, loser] = resultA.code === cli.EXIT_CODES.SUCCESS ? [resultA, resultB] : [resultB, resultA];
  assert.equal(JSON.parse(loser.stderr).error.code, 'stale_source');

  const winnerKey = JSON.parse(winner.stdout).updated[0];
  const store = fs.readFileSync(path.join(userNomEntriesDir(root), shardPath.shardPathFor(winnerKey)), 'utf8');
  assert.ok(store.includes(winnerKey), 'the winning transaction\'s entry actually landed');

  // The failed session's rollback must not have removed the winner's entry (no foreign
  // rollback / lost update).
  const secondAttempt = await spawnCli([
    'apply', '--manifest', (resultA.code === cli.EXIT_CODES.SUCCESS ? manifestB : manifestA),
    '--approve', '--repo-root', root
  ]);
  // Re-running the stale one without a fresh plan is still stale (it was never re-planned);
  // the important assertion is that the winner's data survived, checked above.
  assert.notEqual(secondAttempt.code, cli.EXIT_CODES.APPLY_FAILED);
});

test('apply fails fast with workflow_busy when the lock is already held, and makes no change', async (t) => {
  const root = makeFixture(t);
  const manifestPath = planApproved(root, path.join(root, 'plan.json'), 'quản lý');
  const before = fs.readFileSync(path.join(root, 'zoopdog-nom-ruby.user.js'), 'utf8');

  const owner = lock.acquireLock(root, {operation: 'apply'});
  try {
    const result = await spawnCli(['apply', '--manifest', manifestPath, '--approve', '--repo-root', root]);
    assert.equal(result.code, cli.EXIT_CODES.WORKFLOW_BUSY);
    assert.equal(JSON.parse(result.stderr).error.code, 'workflow_busy');
    assert.equal(fs.readFileSync(path.join(root, 'zoopdog-nom-ruby.user.js'), 'utf8'), before,
      'a busy rejection must not touch workflow-owned files');
  } finally {
    lock.releaseLock(root, owner.token);
  }
});

test('apply with --wait-ms queues behind a held lock and proceeds once it is released', async (t) => {
  const root = makeFixture(t);
  const manifestPath = planApproved(root, path.join(root, 'plan.json'), 'quản lý');

  const owner = lock.acquireLock(root, {operation: 'apply'});
  const started = Date.now();
  const pending = spawnCli(['apply', '--manifest', manifestPath, '--approve', '--repo-root', root, '--wait-ms', '5000']);
  setTimeout(() => lock.releaseLock(root, owner.token), 200);
  const result = await pending;
  assert.equal(result.code, cli.EXIT_CODES.SUCCESS, result.stderr);
  assert.ok(Date.now() - started >= 190, 'the queued apply actually waited for the release');
});

test('two concurrent reviews of the same manifest do not lose either decision', async (t) => {
  const root = makeFixture(t);
  const manifestPath = path.join(root, 'plan.json');
  const planOut = captureIo();
  cli.main(['plan', '--words', 'quản lý, kiểm tra', '--manifest', manifestPath, '--repo-root', root], planOut.io);
  const actionable = JSON.parse(planOut.stdout()).review.filter((record) => record.status !== 'skipped');
  assert.ok(actionable.length >= 2, 'fixture must produce at least two actionable entries');

  const decisionsA = [{id: actionable[0].id, decision: 'apply', nom: ['測'], explain: ['a']}];
  const decisionsB = [{id: actionable[1].id, decision: 'apply', nom: ['試'], explain: ['b']}];
  const decisionsPathA = path.join(root, 'decisions-a.json');
  const decisionsPathB = path.join(root, 'decisions-b.json');
  fs.writeFileSync(decisionsPathA, JSON.stringify(decisionsA));
  fs.writeFileSync(decisionsPathB, JSON.stringify(decisionsB));

  const [resultA, resultB] = await Promise.all([
    spawnCli(['review', '--manifest', manifestPath, '--decisions', decisionsPathA, '--repo-root', root, '--wait-ms', '5000']),
    spawnCli(['review', '--manifest', manifestPath, '--decisions', decisionsPathB, '--repo-root', root, '--wait-ms', '5000'])
  ]);
  // Each session only decides its own entry, so whichever session's write lands first still
  // sees the other entry undecided and legitimately reports `review`'s not-ready exit code
  // (VALIDATION) rather than SUCCESS -- that is not a lost update, just a stale-in-the-moment
  // snapshot. What must never happen is a hard failure (manifest corruption, a validation
  // error) from either side.
  for (const result of [resultA, resultB]) {
    assert.ok([cli.EXIT_CODES.SUCCESS, cli.EXIT_CODES.VALIDATION].includes(result.code),
      `unexpected exit code ${result.code}: ${result.stdout} ${result.stderr}`);
  }

  const finalManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const entryA = finalManifest.entries.find((entry) => entry.id === actionable[0].id);
  const entryB = finalManifest.entries.find((entry) => entry.id === actionable[1].id);
  assert.equal(entryA.decision, 'apply', 'the first session\'s decision was not lost');
  assert.equal(entryB.decision, 'apply', 'the second session\'s decision was not lost');
});

test('a lock left by a killed process before any mutation recovers cleanly', async (t) => {
  const root = makeFixture(t);
  // Spawn a real child process that only ever acquires the lock and then blocks, so it can
  // genuinely be killed -9 while holding it -- the same failure mode as a process interrupted
  // between lock acquisition and its first mutation.
  const holder = spawn(process.execPath, ['-e', `
    const lock = require(${JSON.stringify(path.join(repoRoot, 'scripts/add-chu-nom/lock.js'))});
    lock.acquireLock(${JSON.stringify(root)}, {operation: 'apply'});
    setTimeout(() => {}, 30000);
  `], {stdio: 'ignore'});
  await waitForLock(root);
  const killedPid = holder.pid;
  holder.kill('SIGKILL');
  await new Promise((resolve) => holder.on('close', resolve));
  // The killed process's PID must actually be gone before recovery can treat it as dead.
  const deadline = Date.now() + 2000;
  while (lock.isProcessAlive(killedPid) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  const recovered = await spawnCli(['recover', '--repo-root', root]);
  assert.equal(recovered.code, cli.EXIT_CODES.SUCCESS, recovered.stderr);
  assert.equal(JSON.parse(recovered.stdout).recovered, true);
  assert.ok(!fs.existsSync(lock.lockDirPath(root)));

  // The workflow is usable again afterwards.
  const manifestPath = planApproved(root, path.join(root, 'plan.json'), 'quản lý');
  const applied = await spawnCli(['apply', '--manifest', manifestPath, '--approve', '--repo-root', root]);
  assert.equal(applied.code, cli.EXIT_CODES.SUCCESS, applied.stderr);
});

test('a lock left by a killed process mid-mutation refuses automatic recovery', async (t) => {
  const root = makeFixture(t);
  const target = path.join(userNomEntriesDir(root), shardPath.allShardPaths()[0]);
  const before = fs.readFileSync(target, 'utf8');
  const {hashFile} = require('../scripts/add-chu-nom/fsutil');

  fs.mkdirSync(lock.lockDirPath(root), {recursive: true});
  fs.writeFileSync(lock.ownerFilePath(root), JSON.stringify({
    schemaVersion: 1, token: 'deadtoken', pid: 999999, startSignature: null,
    operation: 'apply', manifestPath: null, acquiredAt: new Date().toISOString()
  }));
  journal.writeJournal(root, {
    token: 'deadtoken', operation: 'apply', phase: 'mutating',
    files: [{path: target, preHash: hashFile(target)}]
  });
  // Simulate the kill landing after a partial write.
  fs.writeFileSync(target, `${before}tampered,亂,x\n`);

  const recovered = await spawnCli(['recover', '--repo-root', root]);
  assert.equal(recovered.code, cli.EXIT_CODES.RECOVERY_REQUIRED);
  assert.equal(JSON.parse(recovered.stderr).error.code, 'workflow_lock_recovery_required');
  assert.ok(fs.existsSync(lock.lockDirPath(root)), 'the lock stays held until an operator resolves it');
  assert.equal(fs.readFileSync(target, 'utf8'), `${before}tampered,亂,x\n`, 'refused recovery leaves bytes untouched');
});

test('a manual byte change during rollback is refused instead of overwritten', (t) => {
  const {applyManifest} = require('../scripts/add-chu-nom/apply');
  const root = makeFixture(t);
  const manifestPath = path.join(root, 'plan.json');
  const planOut = captureIo();
  cli.main(['plan', '--words', 'quản lý', '--manifest', manifestPath, '--repo-root', root], planOut.io);
  const actionable = JSON.parse(planOut.stdout()).review.filter((record) => record.status !== 'skipped');
  const decisionsPath = path.join(root, 'decisions.json');
  fs.writeFileSync(decisionsPath, JSON.stringify(
    actionable.map((record) => ({id: record.id, decision: 'apply', nom: ['測'], explain: ['x']}))
  ));
  const reviewOut = captureIo();
  cli.main(['review', '--manifest', manifestPath, '--decisions', decisionsPath, '--repo-root', root], reviewOut.io);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  const target = path.join(userNomEntriesDir(root), shardPath.shardPathFor('quản lý'));
  // A commandRunner that, on the first build step, tampers with the shard file this
  // transaction already wrote (as if an unrelated process or a human edited it), then fails
  // the build so apply must roll back.
  let tampered = false;
  const commandRunner = (command, args) => {
    if (!tampered) {
      tampered = true;
      fs.writeFileSync(target, 'tampered-by-someone-else\n');
    }
    return {status: 1, stdout: '', stderr: 'forced failure'};
  };

  assert.throws(
    () => require('../scripts/add-chu-nom/apply').applyManifest(manifest, {repoRoot: root, approved: true, commandRunner}),
    (error) => error.code === 'workflow_lock_recovery_required'
  );
  assert.equal(fs.readFileSync(target, 'utf8'), 'tampered-by-someone-else\n', 'the tampered bytes were left alone');
  assert.ok(fs.existsSync(lock.lockDirPath(root)), 'the lock is left held for operator recovery, not silently released');

  // Clean up: an operator inspecting this would restore from git and recover the lock.
  const plan = lock.planRecovery(root, {readJournal: journal.readJournal});
  assert.equal(plan.status, 'live', 'lock is still owned by this (still-running) test process');
  const {readOwnerRecord} = lock;
  const {owner} = readOwnerRecord(root);
  lock.releaseLock(root, owner.token);
});

test('the real repository is never locked or mutated by this suite', () => {
  assert.ok(!fs.existsSync(path.join(repoRoot, lock.CONTROL_DIR_NAME)),
    'no test in this file may create the workflow lock directory inside the real repository');
});
