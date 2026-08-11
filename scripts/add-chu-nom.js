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
const {collectManifestIssues, validateManifest} = require('./add-chu-nom/manifest');
const {buildReviewProjection, createPlan, summarizePlan} = require('./add-chu-nom/plan');
const {DECISION_FIELDS, applyDecisions, readDecisions} = require('./add-chu-nom/decisions');
const {levenshtein} = require('./add-chu-nom/sources');
const {foldAccents} = require('./lib/text');

function parseArguments(argv) {
  const args = {command: argv[0]};
  const booleanFlags = new Set(['--approve']);
  const allowedFlags = new Set([
    '--approve', '--words', '--file', '--manifest', '--repo-root', '--decisions'
  ]);
  for (let index = 1; index < argv.length; index++) {
    const flag = argv[index];
    if (!flag.startsWith('--')) {
      throw new WorkflowError('unexpected_argument', `Unexpected argument: ${flag}`);
    }
    if (!allowedFlags.has(flag)) {
      throw new WorkflowError('unknown_option', `Unknown option: ${flag}`);
    }
    const key = flag.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    if (Object.hasOwn(args, key)) {
      throw new WorkflowError('duplicate_option', `Duplicate option: ${flag}`);
    }
    if (booleanFlags.has(flag)) {
      args[key] = true;
      continue;
    }
    if (index + 1 >= argv.length || argv[index + 1].startsWith('--')) {
      throw new WorkflowError('missing_option_value', `Missing value for ${flag}`);
    }
    args[key] = argv[++index];
  }
  return args;
}

function writeResult(stream, value) {
  stream.write(`${JSON.stringify(value)}\n`);
}

function readManifest(manifestPath) {
  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    throw new WorkflowError('manifest_unreadable', `Unable to read manifest: ${error.message}`);
  }
}

function main(argv = process.argv.slice(2), io = process) {
  try {
    const args = parseArguments(argv);
    if (args.command === 'plan') {
      if (args.approve) {
        throw new WorkflowError('approve_requires_apply', '--approve is only valid with apply.');
      }
      if (!args.manifest) {
        throw new WorkflowError('manifest_option_required', 'plan requires --manifest <path>.');
      }
      const plan = createPlan({
        repoRoot: args.repoRoot,
        words: args.words,
        file: args.file
      });
      const manifestPath = path.resolve(args.manifest);
      atomicWrite(manifestPath, `${JSON.stringify(plan, null, 2)}\n`);
      // The projection travels with the plan so reviewing a batch costs no manifest read.
      writeResult(io.stdout, {
        ok: true,
        action: 'plan',
        manifest: manifestPath,
        summary: summarizePlan(plan),
        review: buildReviewProjection(plan)
      });
      return EXIT_CODES.SUCCESS;
    }
    if (args.command === 'review') {
      if (args.words !== undefined || args.file !== undefined) {
        throw new WorkflowError('input_option_requires_plan', '--words and --file are only valid with plan.');
      }
      if (args.approve) {
        throw new WorkflowError('approve_requires_apply', '--approve is only valid with apply.');
      }
      if (!args.manifest) {
        throw new WorkflowError('manifest_option_required', 'review requires --manifest <path>.');
      }
      if (!args.decisions) {
        throw new WorkflowError('decisions_option_required',
          'review requires --decisions <path|-> holding a JSON array of decisions.');
      }
      const manifestPath = path.resolve(args.manifest);
      const manifest = readManifest(manifestPath);
      const decisions = readDecisions(args.decisions);
      // Every decision is validated before the first is written, so a rejected batch leaves
      // the manifest byte-identical.
      const recorded = applyDecisions(manifest, decisions);
      atomicWrite(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

      const {errors} = collectManifestIssues(manifest, {repoRoot: args.repoRoot});
      const summary = summarizePlan(manifest);
      const ready = errors.length === 0 && summary.undecided === 0;
      // A report, not an abort: the projection is what the reviewer needs next, so it goes to
      // stdout either way and the exit code carries readiness.
      writeResult(io.stdout, {
        ok: ready,
        action: 'review',
        manifest: manifestPath,
        recorded,
        summary,
        review: buildReviewProjection(manifest),
        issues: errors.map((error) => ({
          code: error.code,
          message: error.message,
          hint: error.hint,
          details: error.details
        }))
      });
      return ready ? EXIT_CODES.SUCCESS : EXIT_CODES.VALIDATION;
    }
    if (args.command === 'apply') {
      if (args.words !== undefined || args.file !== undefined) {
        throw new WorkflowError('input_option_requires_plan', '--words and --file are only valid with plan.');
      }
      if (args.decisions !== undefined) {
        throw new WorkflowError('unknown_option', '--decisions is only valid with review.');
      }
      if (!args.manifest) {
        throw new WorkflowError('manifest_option_required', 'apply requires --manifest <path>.');
      }
      const manifestPath = path.resolve(args.manifest);
      const manifest = readManifest(manifestPath);
      const result = applyManifest(manifest, {
        repoRoot: args.repoRoot,
        approved: Boolean(args.approve)
      });
      writeResult(io.stdout, result);
      return EXIT_CODES.SUCCESS;
    }
    throw new WorkflowError('unknown_command', `Unknown command: ${args.command || '(missing)'}`);
  } catch (error) {
    const workflowError = error instanceof WorkflowError
      ? error
      : new WorkflowError('unexpected_failure', error.message);
    writeResult(io.stderr, {
      ok: false,
      error: {
        code: workflowError.code,
        category: workflowError.category,
        message: workflowError.message,
        hint: workflowError.hint,
        details: workflowError.details
      }
    });
    return workflowError.exitCode;
  }
}

module.exports = {
  EXIT_CODES,
  WorkflowError,
  DECISION_FIELDS,
  parseFileMention,
  parseInputText,
  foldAccents,
  levenshtein,
  createPlan,
  buildReviewProjection,
  summarizePlan,
  applyDecisions,
  collectManifestIssues,
  validateManifest,
  upsertUserEntriesJsonc,
  cleanupInputContent,
  applyManifest,
  main
};

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}
