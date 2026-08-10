'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {readUserNomEntries} = require('../user-nom-entries');
const {cleanText, normalizeTerm, stableUnique} = require('../lib/text');
const {CJK_ONLY_PATTERN} = require('../lib/cjk');
const repoPaths = require('../lib/paths');
const {EXIT_CODES, WorkflowError} = require('./errors');
const {hashFile, resolveInsideRoot} = require('./fsutil');
const {parseInputText, parseMixedAnnotatedLine} = require('./input');

function validateManifest(manifest, options = {}) {
  const repoRoot = path.resolve(options.repoRoot || path.join(__dirname, '../..'));
  if (!options.approved) {
    throw new WorkflowError('apply requires explicit --approve.');
  }
  if (!manifest || manifest.schemaVersion !== 1 || !Array.isArray(manifest.entries)) {
    throw new WorkflowError('Unsupported or malformed manifest schema.');
  }
  if (!Array.isArray(manifest.sourceHashes)) {
    throw new WorkflowError('Manifest is missing source hashes.');
  }

  if (!manifest.source || !['inline', 'file'].includes(manifest.source.kind) ||
      !Array.isArray(manifest.source.items)) {
    throw new WorkflowError('Manifest has an invalid input source.');
  }

  const snapshotPaths = new Set();
  for (const snapshot of manifest.sourceHashes) {
    if (!snapshot || typeof snapshot.path !== 'string' || snapshotPaths.has(snapshot.path)) {
      throw new WorkflowError('Manifest contains an invalid or duplicate source hash path.');
    }
    if (snapshot.hash !== null &&
        (typeof snapshot.hash !== 'string' || !/^[a-f0-9]{64}$/.test(snapshot.hash))) {
      throw new WorkflowError(`Manifest contains an invalid source hash: ${snapshot.path}`);
    }
    resolveInsideRoot(repoRoot, snapshot.path);
    snapshotPaths.add(snapshot.path);
  }
  const requiredPaths = [
    repoPaths.relative.userNomEntries,
    repoPaths.relative.dictionary,
    repoPaths.relative.mdxNom
  ];
  if (manifest.source.kind === 'file') {
    if (!manifest.source.path) throw new WorkflowError('File input manifest is missing its source path.');
    requiredPaths.push(manifest.source.path);
  }
  for (const requiredPath of requiredPaths) {
    if (!snapshotPaths.has(requiredPath)) {
      throw new WorkflowError(`Manifest is missing required source hash: ${requiredPath}`);
    }
  }

  for (const snapshot of manifest.sourceHashes) {
    const target = resolveInsideRoot(repoRoot, snapshot.path);
    const actual = hashFile(target);
    if (actual !== snapshot.hash) {
      throw new WorkflowError(
        `Source changed after planning: ${snapshot.path}`,
        EXIT_CODES.STALE,
        {path: snapshot.path, expected: snapshot.hash, actual}
      );
    }
  }
  if (manifest.source && manifest.source.path) {
    resolveInsideRoot(repoRoot, manifest.source.path);
  }

  function assertTextArray(value, label) {
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
      throw new WorkflowError(`${label} must contain only text values.`);
    }
  }

  const existingUserKeys = new Set(readUserNomEntries(resolveInsideRoot(
    repoRoot,
    repoPaths.relative.userNomEntries
  )).map((entry) => entry.key));
  const sourceItems = new Map();
  for (const item of manifest.source.items) {
    if (!item || typeof item.id !== 'string' || !/^L\d+:I\d+$/.test(item.id) ||
        !Number.isInteger(item.line) || item.line < 1 ||
        !Number.isInteger(item.itemIndex) || item.itemIndex < 1 ||
        typeof item.original !== 'string' ||
        (item.rawInput !== undefined && typeof item.rawInput !== 'string') ||
        (item.filteredInput !== undefined && typeof item.filteredInput !== 'boolean') ||
        sourceItems.has(item.id)) {
      throw new WorkflowError('Manifest contains invalid source item metadata.');
    }
    assertTextArray(item.inlineNom, `Source item ${item.id} inlineNom`);
    assertTextArray(item.inlineExplain, `Source item ${item.id} inlineExplain`);
    const reparsedFiltered = item.rawInput === undefined
      ? undefined
      : parseMixedAnnotatedLine(item.rawInput);
    if ((reparsedFiltered !== undefined || item.filteredInput) &&
        (!reparsedFiltered || item.filteredInput !== true ||
         reparsedFiltered.original !== item.original ||
         item.inlineNom.length || item.inlineExplain.length)) {
      throw new WorkflowError(`Source item ${item.id} has invalid filtered input metadata.`);
    }
    sourceItems.set(item.id, item);
  }

  if (manifest.source.kind === 'inline') {
    if (typeof manifest.source.input !== 'string' ||
        JSON.stringify(parseInputText(manifest.source.input)) !==
          JSON.stringify(manifest.source.items)) {
      throw new WorkflowError('Manifest inline source items do not match the planned input.');
    }
  }

  if (manifest.source.kind === 'file') {
    const range = manifest.source.range;
    if (range !== null && (!range || !Number.isInteger(range.startLine) ||
        !Number.isInteger(range.endLine) || range.startLine < 1 || range.endLine < range.startLine)) {
      throw new WorkflowError('Manifest contains an invalid source range.');
    }
    const inputPath = resolveInsideRoot(repoRoot, manifest.source.path);
    const currentItems = parseInputText(fs.readFileSync(inputPath, 'utf8'), {
      startLine: range ? range.startLine : null,
      endLine: range ? range.endLine : null
    });
    if (JSON.stringify(currentItems) !== JSON.stringify(manifest.source.items)) {
      throw new WorkflowError('Manifest source items do not match the planned input bytes.');
    }
  }

  const approvedKeys = new Set();
  const primaryItemIds = new Set();
  const seenEntryKeys = new Set();
  for (const entry of manifest.entries) {
    if (!entry || !['proposed', 'needs-review', 'skipped'].includes(entry.status)) {
      throw new WorkflowError(`Entry ${entry && entry.id ? entry.id : '(unknown)'} has invalid status.`);
    }
    if (typeof entry.id !== 'string' || typeof entry.sourceItemId !== 'string' ||
        !sourceItems.has(entry.sourceItemId) || typeof entry.primary !== 'boolean' ||
        typeof entry.original !== 'string' || typeof entry.vi !== 'string') {
      throw new WorkflowError(`Entry ${entry.id || '(unknown)'} has invalid field shapes.`);
    }
    assertTextArray(entry.nom, `Entry ${entry.id} nom`);
    assertTextArray(entry.explain || [], `Entry ${entry.id} explain`);
    assertTextArray(entry.provenance || [], `Entry ${entry.id} provenance`);
    assertTextArray(entry.choices || [], `Entry ${entry.id} choices`);
    assertTextArray(entry.notes || [], `Entry ${entry.id} notes`);
    const sourceItem = sourceItems.get(entry.sourceItemId);
    if (entry.original !== (sourceItem.rawInput || sourceItem.original)) {
      throw new WorkflowError(`Entry ${entry.id} no longer matches its source item.`);
    }
    if (sourceItem.filteredInput && (!entry.primary ||
        !entry.provenance.includes('input-filtered') ||
        !['needs-review', 'skipped'].includes(entry.status))) {
      throw new WorkflowError(`Entry ${entry.id} has invalid filtered input metadata.`);
    }
    if (entry.primary) {
      if (entry.id !== `${entry.sourceItemId}:full` || primaryItemIds.has(entry.sourceItemId)) {
        throw new WorkflowError(`Entry ${entry.id} has invalid primary source metadata.`);
      }
      primaryItemIds.add(entry.sourceItemId);
    }
    if (entry.status === 'skipped') {
      const skippedKey = normalizeTerm(entry.vi);
      if (!existingUserKeys.has(skippedKey) && !seenEntryKeys.has(skippedKey)) {
        throw new WorkflowError(`Entry ${entry.id} has invalid skipped status.`);
      }
      seenEntryKeys.add(skippedKey);
      if (entry.decision === 'apply') {
        throw new WorkflowError(`Skipped entry ${entry.id} cannot be applied.`);
      }
      continue;
    }
    seenEntryKeys.add(normalizeTerm(entry.vi));
    if (!['apply', 'reject'].includes(entry.decision)) {
      throw new WorkflowError(`Entry ${entry.id || entry.vi} requires a final apply/reject decision.`);
    }
    if (entry.decision === 'reject') {
      continue;
    }
    const key = normalizeTerm(entry.vi);
    if (!key) {
      throw new WorkflowError(`Entry ${entry.id || '(unknown)'} is missing vi.`);
    }
    if (!Array.isArray(entry.nom) || !entry.nom.length ||
        entry.nom.some((candidate) => !CJK_ONLY_PATTERN.test(cleanText(candidate)))) {
      throw new WorkflowError(`Entry ${entry.id || key} must contain valid Nom/CJK values.`);
    }
    if (entry.explain !== undefined && !Array.isArray(entry.explain)) {
      throw new WorkflowError(`Entry ${entry.id || key} has invalid explain values.`);
    }
    if (entry.replace !== undefined) {
      if (typeof entry.replace !== 'boolean') {
        throw new WorkflowError(`Entry ${entry.id || key} has an invalid replace flag.`);
      }
      // Shrinking a stored entry is only reachable from an entry the reviewer actually
      // looked at; an auto-resolved `proposed` entry may never drop existing values.
      if (entry.replace && entry.status !== 'needs-review') {
        throw new WorkflowError(
          `Entry ${entry.id || key} may only replace stored values from a reviewed entry.`
        );
      }
    }
    if (approvedKeys.has(key)) {
      throw new WorkflowError(`Duplicate approved key: ${key}`);
    }
    approvedKeys.add(key);
    entry.key = key;
    entry.vi = cleanText(entry.vi);
    entry.nom = stableUnique(entry.nom.map(cleanText));
    entry.explain = stableUnique((entry.explain || []).map(cleanText));
  }
  return manifest.entries.filter((entry) => entry.status !== 'skipped' && entry.decision === 'apply');
}

module.exports = {
  validateManifest
};
