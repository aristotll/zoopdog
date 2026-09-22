'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {EXIT_CODES, WorkflowError} = require('./errors');
const {
  atomicWrite,
  hashFile,
  guardedRestoreSnapshot,
  resolveInsideRoot,
  snapshotFiles
} = require('./fsutil');
const {acquireLock, releaseLock} = require('./lock');
const {writeJournal, clearJournal} = require('./journal');
const {cleanupInputContent} = require('./input');
const {readJsonStringEnd, readJsonValueEnd} = require('./jsonc');
const {validateManifest} = require('./manifest');
const {isEmbeddableTerm} = require('../lib/cjk');
const repoPaths = require('../lib/paths');
const {stableUnique} = require('../lib/text');
const {shardPathFor} = require('../lib/shard-path');
const {upsertEntries} = require('../lib/nom-entries-store');

function defaultCommandRunner(command, args, options) {
  return spawnSync(command, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    stdio: 'pipe'
  });
}

function runChecked(commandRunner, command, args, cwd, stage) {
  const result = commandRunner(command, args, {cwd});
  if (!result || result.status !== 0) {
    throw new WorkflowError('build_step_failed', 
      `${stage} failed${result && result.stderr ? `: ${String(result.stderr).trim()}` : '.'}`,
      {stage}
    );
  }
}

function extractAssignedJson(source, variableName) {
  const marker = `var ${variableName} =`;
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) throw new WorkflowError('generated_variable_missing', `Missing generated ${variableName}.`);
  let start = markerIndex + marker.length;
  while (start < source.length && /\s/.test(source[start])) start++;
  // Generated userscripts embed their maps as `JSON.parse("<escaped json>")` (see
  // jsonParseLiteral in scripts/lib/userscript.js); a plain object literal is still accepted.
  const wrapper = 'JSON.parse(';
  if (source.startsWith(wrapper, start)) {
    const stringStart = start + wrapper.length;
    return JSON.parse(JSON.parse(source.slice(stringStart, readJsonStringEnd(source, stringStart))));
  }
  const end = readJsonValueEnd(source, start);
  return JSON.parse(source.slice(start, end));
}

// Acquires the repository-scoped workflow lock, then re-validates the manifest against
// current on-disk hashes before any mutation. Holding the lock across this revalidation is
// what turns a queued second session's stale plan into a clean, stable `stale_source` result
// instead of a race: nothing it read at plan time can still be trusted once it is the one
// holding the lock, so it is re-read here regardless of how long it waited.
function applyManifest(manifest, options = {}) {
  const repoRoot = path.resolve(options.repoRoot || path.join(__dirname, '../..'));
  const owner = acquireLock(repoRoot, {
    operation: 'apply',
    manifestPath: options.manifestPath,
    waitMs: options.waitMs || 0
  });
  let releaseOnExit = true;
  try {
    return applyManifestLocked(manifest, options, repoRoot, owner);
  } catch (error) {
    // Bytes could not be safely rolled back (see `guardedRestoreSnapshot`): leave the lock
    // held so no other session can proceed until an operator resolves it with `recover`.
    if (error instanceof WorkflowError && error.code === 'workflow_lock_recovery_required') {
      releaseOnExit = false;
    }
    throw error;
  } finally {
    if (releaseOnExit) releaseLock(repoRoot, owner.token);
  }
}

function applyManifestLocked(manifest, options, repoRoot, owner) {
  const approvedEntries = validateManifest(manifest, {repoRoot, approved: options.approved});
  if (!approvedEntries.length) {
    return {
      ok: true,
      action: 'apply',
      updated: [],
      removedItems: [],
      notEmbedded: [],
      rebuilt: [],
      checks: []
    };
  }
  const commandRunner = options.commandRunner || defaultCommandRunner;
  const userDir = repoPaths.resolveIn(repoRoot, 'userNomEntries');
  const nomTarget = repoPaths.resolveIn(repoRoot, 'nomUserscript');
  const popupTarget = repoPaths.resolveIn(repoRoot, 'popupUserscript');
  const inputPath = manifest.source && manifest.source.kind === 'file'
    ? resolveInsideRoot(repoRoot, manifest.source.path)
    : null;
  // Only the shards these entries' keys hash to are ever written, so only those need a
  // rollback snapshot -- not the whole 128-shard store.
  const touchedShardPaths = stableUnique(approvedEntries.map((entry) => shardPathFor(entry.vi)))
    .map((relative) => path.join(userDir, relative));
  const ownedPaths = stableUnique([...touchedShardPaths, nomTarget, popupTarget, inputPath].filter(Boolean));
  const snapshot = snapshotFiles(ownedPaths);
  const writtenHashes = new Map();
  writeJournal(repoRoot, {
    token: owner.token,
    operation: 'apply',
    phase: 'mutating',
    files: ownedPaths.map((target) => ({path: target, preHash: hashFile(target)}))
  });

  try {
    upsertEntries(userDir, approvedEntries);
    for (const target of touchedShardPaths) writtenHashes.set(target, hashFile(target));

    const removedItemIds = new Set(approvedEntries
      .filter((entry) => entry.primary)
      .map((entry) => entry.sourceItemId));
    if (inputPath && removedItemIds.size) {
      const cleaned = cleanupInputContent(
        fs.readFileSync(inputPath, 'utf8'),
        manifest.source.items,
        removedItemIds
      );
      atomicWrite(inputPath, cleaned);
      writtenHashes.set(inputPath, hashFile(inputPath));
    }

    runChecked(commandRunner, process.execPath, ['scripts/build-nom-userscript.js'], repoRoot, 'nom-build');
    writtenHashes.set(nomTarget, hashFile(nomTarget));
    runChecked(commandRunner, process.execPath, ['scripts/build-popupdict-userscript.js'], repoRoot, 'popup-build');
    writtenHashes.set(popupTarget, hashFile(popupTarget));

    const nomMap = extractAssignedJson(fs.readFileSync(nomTarget, 'utf8'), 'NOM_MAP');
    const popupMap = extractAssignedJson(fs.readFileSync(popupTarget, 'utf8'), 'ZOO_DICTIONARY');
    const notEmbedded = [];
    for (const entry of approvedEntries) {
      // The Nom builder deliberately drops terms its embeddability rule rejects, so only
      // check NOM_MAP for keys it would accept. Import the rule rather than restate it.
      const nomEligible = isEmbeddableTerm(entry.key);
      if (!nomEligible) {
        notEmbedded.push(entry.key);
      }
      if ((nomEligible && !Object.hasOwn(nomMap, entry.key)) ||
          !Object.hasOwn(popupMap, entry.key)) {
        throw new WorkflowError('generated_key_missing', `Generated dictionaries are missing approved key: ${entry.key}`);
      }
    }

    for (const script of [
      'scripts/user-nom-entries.js',
      'scripts/build-nom-userscript.js',
      'scripts/build-popupdict-userscript.js'
    ]) {
      runChecked(commandRunner, process.execPath, ['--check', script], repoRoot, `syntax-check:${script}`);
    }

    writeJournal(repoRoot, {
      token: owner.token,
      operation: 'apply',
      phase: 'committed',
      files: ownedPaths.map((target) => ({path: target, preHash: hashFile(target), postHash: hashFile(target)}))
    });
    clearJournal(repoRoot);

    return {
      ok: true,
      action: 'apply',
      updated: approvedEntries.map((entry) => entry.key),
      removedItems: Array.from(removedItemIds),
      notEmbedded,
      rebuilt: [repoPaths.relative.nomUserscript, repoPaths.relative.popupUserscript],
      checks: ['NOM_MAP', 'ZOO_DICTIONARY', 'node --check']
    };
  } catch (error) {
    guardedRestoreSnapshot(snapshot, writtenHashes);
    writeJournal(repoRoot, {
      token: owner.token,
      operation: 'apply',
      phase: 'rolled_back',
      files: ownedPaths.map((target) => ({path: target, preHash: hashFile(target)}))
    });
    clearJournal(repoRoot);
    if (error instanceof WorkflowError &&
        (error.exitCode === EXIT_CODES.APPLY_FAILED || error.exitCode === EXIT_CODES.RECOVERY_REQUIRED)) {
      throw error;
    }
    throw new WorkflowError('apply_rolled_back', error.message);
  }
}

module.exports = {
  defaultCommandRunner,
  runChecked,
  extractAssignedJson,
  applyManifest,
  applyManifestLocked
};
