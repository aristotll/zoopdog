#!/usr/bin/env node

'use strict';

const path = require('node:path');
const {parseArgs} = require('node:util');
const repoPaths = require('./lib/paths');
const {buildArchiveBuffer, publishArchive, verifyArchive} = require('./lib/extension-package/archive');
const {EXIT_CODES, ERROR_CODES, PackageError} = require('./lib/extension-package/errors');

const EXTENSION_ROOT_RELATIVE = 'zd-extension';
const ARCHIVE_RELATIVE = 'zd-extension.zip';

const USAGE = [
  'Usage: build-extension-package.js <build|verify> [options]',
  '',
  '  build              Rebuild zd-extension.zip from the current extension source.',
  '                     Atomic: an existing archive is left untouched on any failure.',
  '  verify             Verify the tracked archive against the current source without',
  '                     mutating it or the checkout.',
  '',
  '  --root <dir>       Repository root. Defaults to this repository.',
  '  --extension <dir>  Extension source directory. Defaults to <root>/zd-extension.',
  '  --archive <path>   Archive path. Defaults to <root>/zd-extension.zip.',
  '  --json             Emit one JSON object instead of key=value lines.'
].join('\n');

function formatKeyValue(fields) {
  return Object.entries(fields)
    .map(([key, value]) => `${key}=${value}`)
    .join(' ');
}

function writeLine(stream, text) {
  stream.write(`${text}\n`);
}

function emitSuccess(io, json, payload, lines) {
  if (json) {
    writeLine(io.stdout, JSON.stringify({schema: 'zoopdog.extension-package/1', ok: true, ...payload}));
  } else {
    writeLine(io.stdout, lines);
  }
}

function emitFailure(io, json, error, extra = {}) {
  const body = {
    ok: false,
    error: {
      code: error.code || 'unexpected_failure',
      category: error.category || 'io',
      message: error.message,
      hint: error.hint,
      details: error.details || {}
    },
    ...extra
  };
  if (json) {
    writeLine(io.stderr, JSON.stringify({schema: 'zoopdog.extension-package/1', ...body}));
  } else {
    writeLine(io.stderr, `error=${body.error.code} message=${JSON.stringify(error.message)}`);
    if (error.hint) writeLine(io.stderr, `hint=${JSON.stringify(error.hint)}`);
    for (const problem of extra.problems || []) {
      writeLine(io.stderr, `problem=${problem.code} path=${problem.path || ''} message=${JSON.stringify(problem.message)}`);
    }
  }
}

function resolvePaths(values, root) {
  const base = values.root ? path.resolve(values.root) : root;
  const extensionRoot = values.extension ? path.resolve(values.extension) : path.join(base, EXTENSION_ROOT_RELATIVE);
  const archivePath = values.archive ? path.resolve(values.archive) : path.join(base, ARCHIVE_RELATIVE);
  return {base, extensionRoot, archivePath};
}

function run(argv, io = process, root = repoPaths.rootDir) {
  let values;
  let positionals;
  try {
    ({values, positionals} = parseArgs({
      args: argv,
      options: {
        root: {type: 'string'},
        extension: {type: 'string'},
        archive: {type: 'string'},
        json: {type: 'boolean', default: false}
      },
      strict: true,
      allowPositionals: true
    }));
  } catch (error) {
    writeLine(io.stderr, error.message);
    writeLine(io.stderr, USAGE);
    return EXIT_CODES.USAGE;
  }

  const command = positionals[0];
  if (positionals.length > 1) {
    emitFailure(io, values.json, new PackageError('unexpected_argument', `Unexpected argument: ${positionals[1]}`));
    return EXIT_CODES.USAGE;
  }
  if (command !== 'build' && command !== 'verify') {
    emitFailure(io, values.json, new PackageError('unknown_command', `Unknown command: ${command || '(missing)'}`));
    if (!values.json) writeLine(io.stderr, USAGE);
    return EXIT_CODES.USAGE;
  }

  const {extensionRoot, archivePath} = resolvePaths(values, root);

  try {
    if (command === 'build') {
      const {archivePath: publishedPath, summary} = publishArchive(extensionRoot, archivePath);
      emitSuccess(io, values.json, {action: 'build', archive: publishedPath, summary}, formatKeyValue({
        action: 'build',
        archive: publishedPath,
        manifestVersion: summary.manifestVersion,
        version: summary.version,
        entryCount: summary.entryCount,
        byteCount: summary.byteCount,
        sha256: summary.sha256
      }));
      return EXIT_CODES.SUCCESS;
    }

    const result = verifyArchive(extensionRoot, archivePath);
    if (result.ok) {
      emitSuccess(io, values.json, {action: 'verify', ...result}, formatKeyValue({
        action: 'verify',
        archive: result.archivePath,
        manifestVersion: result.actual.manifestVersion,
        version: result.actual.version,
        entryCount: result.actual.entryCount,
        byteCount: result.actual.byteCount,
        sha256: result.actual.sha256
      }));
      return EXIT_CODES.SUCCESS;
    }

    const firstProblem = result.problems[0];
    const category = ERROR_CODES[firstProblem.code]
      ? ERROR_CODES[firstProblem.code].exit
      : EXIT_CODES.INTEGRITY;
    emitFailure(io, values.json, new PackageError(firstProblem.code, firstProblem.message, {path: firstProblem.path}), {
      action: 'verify',
      archive: result.archivePath,
      expected: result.expected,
      actual: result.actual,
      problems: result.problems
    });
    return category;
  } catch (error) {
    const packageError = error instanceof PackageError ? error : new PackageError('unexpected_failure', error.message);
    emitFailure(io, values.json, packageError);
    return packageError.exitCode;
  }
}

module.exports = {
  buildArchiveBuffer,
  publishArchive,
  verifyArchive,
  run,
  USAGE
};

if (require.main === module) {
  process.exitCode = run(process.argv.slice(2));
}
