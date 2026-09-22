'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {WorkflowError} = require('./errors');
const {atomicWrite} = require('../lib/fsutil');

// Every regular file under `dir`, sorted for a deterministic walk order regardless of the
// filesystem's own directory-entry ordering.
function listFilesRecursive(dir) {
  const entries = fs.readdirSync(dir, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name));
  const files = [];
  for (const entry of entries) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFilesRecursive(target));
    } else if (entry.isFile()) {
      files.push(target);
    }
  }
  return files;
}

// The content hash of a byte buffer, using the same digest as `hashFile` so the two are
// directly comparable (needed to check a snapshot's in-memory preimage against a file on disk
// without writing the preimage out first).
function hashBuffer(data) {
  if (data === null || data === undefined) return null;
  return crypto.createHash('sha256').update(data).digest('hex');
}

// A single file's content hash, or -- for a directory (the sharded `user_nom_entries/` store) --
// a hash over every file beneath it in a fixed sort order, each framed with its relative path so
// a rename and a content change can never produce the same digest.
function hashFile(target) {
  if (!fs.existsSync(target)) {
    return null;
  }
  const hash = crypto.createHash('sha256');
  if (fs.statSync(target).isDirectory()) {
    for (const file of listFilesRecursive(target)) {
      hash.update(path.relative(target, file));
      hash.update('\0');
      hash.update(fs.readFileSync(file));
      hash.update('\0');
    }
    return hash.digest('hex');
  }
  hash.update(fs.readFileSync(target));
  return hash.digest('hex');
}

function resolveInsideRoot(repoRoot, relativePath) {
  const root = path.resolve(repoRoot);
  const target = path.resolve(root, relativePath);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new WorkflowError('path_escapes_root', `Path escapes repository root: ${relativePath}`);
  }
  const realRoot = fs.realpathSync(root);
  let existingAncestor = target;
  const missingParts = [];
  while (!fs.existsSync(existingAncestor)) {
    const parent = path.dirname(existingAncestor);
    if (parent === existingAncestor) {
      throw new WorkflowError('path_unresolvable', `Cannot resolve repository path: ${relativePath}`);
    }
    missingParts.unshift(path.basename(existingAncestor));
    existingAncestor = parent;
  }
  const realTarget = path.join(fs.realpathSync(existingAncestor), ...missingParts);
  if (realTarget !== realRoot && !realTarget.startsWith(`${realRoot}${path.sep}`)) {
    throw new WorkflowError('path_outside_root', `Path resolves outside repository root: ${relativePath}`);
  }
  return target;
}

function snapshotFiles(paths) {
  return new Map(paths.map((target) => [target, {
    exists: fs.existsSync(target),
    data: fs.existsSync(target) ? fs.readFileSync(target) : null
  }]));
}

function restoreSnapshot(snapshot) {
  for (const [target, state] of snapshot) {
    if (state.exists) {
      atomicWrite(target, state.data);
    } else if (fs.existsSync(target)) {
      fs.unlinkSync(target);
    }
  }
}

// Rollback guarded against clobbering bytes this transaction did not itself produce. For every
// snapshotted path, restoring is only allowed when the file's current content is either still
// the pre-transaction preimage (nothing happened yet) or exactly what this transaction's own
// `writtenHashes` map says it last wrote there. Anything else -- a foreign process or a manual
// edit landing mid-transaction -- stops the restore instead of silently overwriting it.
function guardedRestoreSnapshot(snapshot, writtenHashes = new Map()) {
  const mismatches = [];
  for (const [target, state] of snapshot) {
    const current = hashFile(target);
    const preHash = state.exists ? hashBuffer(state.data) : null;
    if (current === preHash) continue;
    const expectedWritten = writtenHashes.get(target);
    if (expectedWritten !== undefined && current === expectedWritten) continue;
    mismatches.push(target);
  }
  if (mismatches.length) {
    throw new WorkflowError('workflow_lock_recovery_required',
      'Files changed unexpectedly during rollback; refusing to overwrite them. Inspect and restore manually.',
      {paths: mismatches});
  }
  restoreSnapshot(snapshot);
}

module.exports = {
  hashFile,
  hashBuffer,
  resolveInsideRoot,
  atomicWrite,
  snapshotFiles,
  restoreSnapshot,
  guardedRestoreSnapshot
};
