'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {WorkflowError} = require('./errors');
const {atomicWrite} = require('../lib/fsutil');

function hashFile(target) {
  if (!fs.existsSync(target)) {
    return null;
  }
  return crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');
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

module.exports = {
  hashFile,
  resolveInsideRoot,
  atomicWrite,
  snapshotFiles,
  restoreSnapshot
};
