#!/usr/bin/env node

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {applyManifest} = require('./add-chu-nom/apply');
const {EXIT_CODES, WorkflowError} = require('./add-chu-nom/errors');
const {atomicWrite} = require('./add-chu-nom/fsutil');
const {
  cleanupInputContent,
  parseFileMention,
  parseInputText
} = require('./add-chu-nom/input');
const {upsertUserEntriesJsonc} = require('./add-chu-nom/jsonc');
const {validateManifest} = require('./add-chu-nom/manifest');
const {createPlan} = require('./add-chu-nom/plan');
const {levenshtein} = require('./add-chu-nom/sources');
const {foldAccents} = require('./lib/text');

function parseArguments(argv) {
  const args = {command: argv[0]};
  const booleanFlags = new Set(['--approve']);
  const allowedFlags = new Set(['--approve', '--words', '--file', '--manifest', '--repo-root']);
  for (let index = 1; index < argv.length; index++) {
    const flag = argv[index];
    if (!flag.startsWith('--')) {
      throw new WorkflowError(`Unexpected argument: ${flag}`);
    }
    if (!allowedFlags.has(flag)) {
      throw new WorkflowError(`Unknown option: ${flag}`);
    }
    const key = flag.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    if (Object.hasOwn(args, key)) {
      throw new WorkflowError(`Duplicate option: ${flag}`);
    }
    if (booleanFlags.has(flag)) {
      args[key] = true;
      continue;
    }
    if (index + 1 >= argv.length || argv[index + 1].startsWith('--')) {
      throw new WorkflowError(`Missing value for ${flag}`);
    }
    args[key] = argv[++index];
  }
  return args;
}

function writeResult(stream, value) {
  stream.write(`${JSON.stringify(value)}\n`);
}

function main(argv = process.argv.slice(2), io = process) {
  try {
    const args = parseArguments(argv);
    if (args.command === 'plan') {
      if (args.approve) {
        throw new WorkflowError('--approve is only valid with apply.');
      }
      if (!args.manifest) {
        throw new WorkflowError('plan requires --manifest <path>.');
      }
      const plan = createPlan({
        repoRoot: args.repoRoot,
        words: args.words,
        file: args.file
      });
      const manifestPath = path.resolve(args.manifest);
      atomicWrite(manifestPath, `${JSON.stringify(plan, null, 2)}\n`);
      writeResult(io.stdout, {
        ok: true,
        action: 'plan',
        manifest: manifestPath,
        summary: {
          proposed: plan.entries.filter((entry) => entry.status === 'proposed').length,
          needsReview: plan.entries.filter((entry) => entry.status === 'needs-review').length,
          skipped: plan.entries.filter((entry) => entry.status === 'skipped').length
        }
      });
      return EXIT_CODES.SUCCESS;
    }
    if (args.command === 'apply') {
      if (args.words !== undefined || args.file !== undefined) {
        throw new WorkflowError('--words and --file are only valid with plan.');
      }
      if (!args.manifest) {
        throw new WorkflowError('apply requires --manifest <path>.');
      }
      const manifestPath = path.resolve(args.manifest);
      let manifest;
      try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      } catch (error) {
        throw new WorkflowError(`Unable to read manifest: ${error.message}`);
      }
      const result = applyManifest(manifest, {
        repoRoot: args.repoRoot,
        approved: Boolean(args.approve)
      });
      writeResult(io.stdout, result);
      return EXIT_CODES.SUCCESS;
    }
    throw new WorkflowError(`Unknown command: ${args.command || '(missing)'}`);
  } catch (error) {
    const workflowError = error instanceof WorkflowError
      ? error
      : new WorkflowError(error.message, EXIT_CODES.APPLY_FAILED);
    const code = workflowError.exitCode === EXIT_CODES.STALE
      ? 'stale'
      : (workflowError.exitCode === EXIT_CODES.APPLY_FAILED ? 'apply_failed' : 'validation');
    writeResult(io.stderr, {
      ok: false,
      error: {code, message: workflowError.message, details: workflowError.details}
    });
    return workflowError.exitCode;
  }
}

module.exports = {
  EXIT_CODES,
  WorkflowError,
  parseFileMention,
  parseInputText,
  foldAccents,
  levenshtein,
  createPlan,
  validateManifest,
  upsertUserEntriesJsonc,
  cleanupInputContent,
  applyManifest,
  main
};

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}
