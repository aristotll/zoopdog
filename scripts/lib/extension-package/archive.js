'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {buildPlan} = require('./plan');
const {writeZip, readZip} = require('./zip');
const {PackageError} = require('./errors');

const ARCHIVE_PREFIX = 'zd-extension';

function planToEntries(plan) {
  return plan.entries.map((entry) => ({
    path: `${ARCHIVE_PREFIX}/${entry.path}`,
    data: fs.readFileSync(entry.absolutePath)
  }));
}

function summarize(buffer, manifest) {
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const {entries} = readZip(buffer);
  return {
    manifestVersion: manifest.manifest_version,
    version: manifest.version,
    entryCount: entries.length,
    byteCount: buffer.length,
    sha256
  };
}

/**
 * Build the deterministic archive bytes for the current extension source tree. Pure: performs
 * no filesystem writes to the archive path.
 */
function buildArchiveBuffer(extensionRoot, inventory) {
  const plan = buildPlan(extensionRoot, inventory);
  const buffer = writeZip(planToEntries(plan));
  return {buffer, plan, summary: summarize(buffer, plan.manifest)};
}

/**
 * Atomically publish the archive: build succeeds fully in memory before anything touches the
 * target path, and the rename is the only mutation, so any planning/encoding failure leaves an
 * existing archive at `archivePath` completely untouched.
 */
function publishArchive(extensionRoot, archivePath, inventory) {
  const {buffer, summary} = buildArchiveBuffer(extensionRoot, inventory);
  const directory = path.dirname(archivePath);
  fs.mkdirSync(directory, {recursive: true});
  const temporary = path.join(directory, `.${path.basename(archivePath)}.tmp-${process.pid}`);
  try {
    fs.writeFileSync(temporary, buffer);
    fs.renameSync(temporary, archivePath);
  } catch (error) {
    throw new PackageError('publish_failed', `Unable to publish archive: ${error.message}`, {path: archivePath});
  } finally {
    if (fs.existsSync(temporary)) {
      fs.unlinkSync(temporary);
    }
  }
  return {archivePath, summary};
}

function extractManifest(entries, archivePath) {
  const manifestEntry = entries.find((entry) => entry.path === `${ARCHIVE_PREFIX}/manifest.json`);
  if (!manifestEntry || !manifestEntry.data) {
    throw new PackageError('malformed_archive', `Archive is missing ${ARCHIVE_PREFIX}/manifest.json`, {path: archivePath});
  }
  try {
    return JSON.parse(manifestEntry.data.toString('utf8'));
  } catch (error) {
    throw new PackageError('malformed_archive', `Archive manifest.json is not valid JSON: ${error.message}`, {path: archivePath});
  }
}

/**
 * Verify a tracked archive without mutating it or the checkout: builds the expected bytes
 * from the current source tree, parses the tracked archive, and reports every discrepancy
 * (stale manifest, missing/unexpected paths, duplicate/traversal paths, symlink entries,
 * corrupt CRC/size, non-reproducible metadata, byte mismatch) rather than stopping at the
 * first one.
 */
function verifyArchive(extensionRoot, archivePath, inventory) {
  let archiveBuffer;
  try {
    archiveBuffer = fs.readFileSync(archivePath);
  } catch (error) {
    throw new PackageError('archive_unreadable', `Unable to read archive: ${error.message}`, {path: archivePath});
  }

  const {plan, summary: expectedSummary} = buildArchiveBuffer(extensionRoot, inventory);
  const {entries: actualEntries, issues: parseIssues} = readZip(archiveBuffer);

  const problems = parseIssues.map((issue) => ({code: issue.code, message: issue.message, path: issue.path}));

  const archiveManifest = actualEntries.some((entry) => entry.path === `${ARCHIVE_PREFIX}/manifest.json` && entry.data)
    ? extractManifest(actualEntries, archivePath)
    : null;
  if (archiveManifest
    && (archiveManifest.manifest_version !== plan.manifest.manifest_version
      || archiveManifest.version !== plan.manifest.version)) {
    problems.push({
      code: 'stale_manifest',
      message: `Archive manifest is stale: archive has manifest_version=${archiveManifest.manifest_version} `
        + `version=${archiveManifest.version}, current source has manifest_version=${plan.manifest.manifest_version} `
        + `version=${plan.manifest.version}`,
      path: `${ARCHIVE_PREFIX}/manifest.json`
    });
  }

  const expectedPaths = new Set(plan.entries.map((entry) => `${ARCHIVE_PREFIX}/${entry.path}`));
  const actualPaths = new Set();
  for (const entry of actualEntries) {
    if (actualPaths.has(entry.path)) continue; // already reported as duplicate_path
    actualPaths.add(entry.path);
    if (!expectedPaths.has(entry.path)) {
      problems.push({code: 'unexpected_path', message: `Archive contains an unexpected entry: ${entry.path}`, path: entry.path});
    }
  }
  for (const expectedPath of expectedPaths) {
    if (!actualPaths.has(expectedPath)) {
      problems.push({code: 'missing_reference', message: `Archive is missing expected entry: ${expectedPath}`, path: expectedPath});
    }
  }

  const actualSha256 = crypto.createHash('sha256').update(archiveBuffer).digest('hex');
  const bytesMatch = actualSha256 === expectedSummary.sha256;
  if (!bytesMatch && problems.length === 0) {
    // Every structural/content check passed yet the bytes differ: this can only be a
    // difference outside what this packager varies (e.g. a foreign encoder touched the
    // archive without changing any entry we inspect). Surface it rather than reporting clean.
    problems.push({
      code: 'nonreproducible_metadata',
      message: 'Archive bytes do not match the deterministic rebuild, but no entry-level cause was found.',
      path: archivePath
    });
  }

  return {
    ok: problems.length === 0,
    archivePath,
    expected: expectedSummary,
    actual: {
      manifestVersion: archiveManifest ? archiveManifest.manifest_version : null,
      version: archiveManifest ? archiveManifest.version : null,
      entryCount: actualEntries.length,
      byteCount: archiveBuffer.length,
      sha256: actualSha256
    },
    problems
  };
}

module.exports = {
  ARCHIVE_PREFIX,
  buildArchiveBuffer,
  publishArchive,
  verifyArchive
};
