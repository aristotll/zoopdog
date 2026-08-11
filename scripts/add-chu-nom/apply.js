'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {EXIT_CODES, WorkflowError} = require('./errors');
const {
  atomicWrite,
  resolveInsideRoot,
  restoreSnapshot,
  snapshotFiles
} = require('./fsutil');
const {cleanupInputContent} = require('./input');
const {readJsonValueEnd, upsertUserEntriesJsonc} = require('./jsonc');
const {validateManifest} = require('./manifest');
const {isEmbeddableTerm} = require('../lib/cjk');
const repoPaths = require('../lib/paths');
const {stableUnique} = require('../lib/text');

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
  const end = readJsonValueEnd(source, start);
  return JSON.parse(source.slice(start, end));
}

function applyManifest(manifest, options = {}) {
  const repoRoot = path.resolve(options.repoRoot || path.join(__dirname, '../..'));
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
  const userPath = repoPaths.resolveIn(repoRoot, 'userNomEntries');
  const nomTarget = repoPaths.resolveIn(repoRoot, 'nomUserscript');
  const popupTarget = repoPaths.resolveIn(repoRoot, 'popupUserscript');
  const inputPath = manifest.source && manifest.source.kind === 'file'
    ? resolveInsideRoot(repoRoot, manifest.source.path)
    : null;
  const ownedPaths = stableUnique([userPath, nomTarget, popupTarget, inputPath].filter(Boolean));
  const snapshot = snapshotFiles(ownedPaths);

  try {
    const currentUserSource = fs.existsSync(userPath) ? fs.readFileSync(userPath, 'utf8') : '[]\n';
    atomicWrite(userPath, upsertUserEntriesJsonc(currentUserSource, approvedEntries));

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
    }

    runChecked(commandRunner, process.execPath, ['scripts/build-nom-userscript.js'], repoRoot, 'nom-build');
    runChecked(commandRunner, process.execPath, ['scripts/build-popupdict-userscript.js'], repoRoot, 'popup-build');

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
    restoreSnapshot(snapshot);
    if (error instanceof WorkflowError && error.exitCode === EXIT_CODES.APPLY_FAILED) {
      throw error;
    }
    throw new WorkflowError('apply_rolled_back', error.message);
  }
}

module.exports = {
  defaultCommandRunner,
  runChecked,
  extractAssignedJson,
  applyManifest
};
