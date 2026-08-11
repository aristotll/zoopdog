'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {readUserNomEntries} = require('../user-nom-entries');
const {cleanText, normalizeTerm, stableUnique} = require('../lib/text');
const {CJK_ONLY_PATTERN} = require('../lib/cjk');
const repoPaths = require('../lib/paths');
const {WorkflowError} = require('./errors');
const {hashFile, resolveInsideRoot} = require('./fsutil');
const {parseInputText, parseMixedAnnotatedLine} = require('./input');

// Collection reports every independent defect in one pass so a reviewer fixes them together
// instead of discovering them one apply at a time. It never writes to the manifest it inspects;
// the normalization the apply path needs is a separate, explicit step.
function collectManifestIssues(manifest, options = {}) {
  const repoRoot = path.resolve(options.repoRoot || path.join(__dirname, '../..'));
  const errors = [];
  const add = (code, message, details = {}) => {
    errors.push(new WorkflowError(code, message, details));
  };
  // A malformed shape makes every later check meaningless, so these stop collection rather
  // than cascade into misleading follow-on errors.
  const fatal = (code, message) => {
    add(code, message);
    return {errors, applicable: []};
  };

  if (!manifest || manifest.schemaVersion !== 1 || !Array.isArray(manifest.entries)) {
    return fatal('manifest_schema_unsupported', 'Unsupported or malformed manifest schema.');
  }
  if (!Array.isArray(manifest.sourceHashes)) {
    return fatal('source_hashes_missing', 'Manifest is missing source hashes.');
  }
  if (!manifest.source || !['inline', 'file'].includes(manifest.source.kind) ||
      !Array.isArray(manifest.source.items)) {
    return fatal('source_invalid', 'Manifest has an invalid input source.');
  }

  const snapshotPaths = new Set();
  for (const snapshot of manifest.sourceHashes) {
    if (!snapshot || typeof snapshot.path !== 'string' || snapshotPaths.has(snapshot.path)) {
      return fatal('source_hash_path_invalid', 'Manifest contains an invalid or duplicate source hash path.');
    }
    if (snapshot.hash !== null &&
        (typeof snapshot.hash !== 'string' || !/^[a-f0-9]{64}$/.test(snapshot.hash))) {
      return fatal('source_hash_invalid', `Manifest contains an invalid source hash: ${snapshot.path}`);
    }
    try {
      resolveInsideRoot(repoRoot, snapshot.path);
    } catch (error) {
      errors.push(error);
      return {errors, applicable: []};
    }
    snapshotPaths.add(snapshot.path);
  }

  const requiredPaths = [
    repoPaths.relative.userNomEntries,
    repoPaths.relative.dictionary,
    repoPaths.relative.mdxNom
  ];
  if (manifest.source.kind === 'file') {
    if (!manifest.source.path) {
      return fatal('source_path_missing', 'File input manifest is missing its source path.');
    }
    requiredPaths.push(manifest.source.path);
  }
  for (const requiredPath of requiredPaths) {
    if (!snapshotPaths.has(requiredPath)) {
      return fatal('source_hash_required_missing', `Manifest is missing required source hash: ${requiredPath}`);
    }
  }

  for (const snapshot of manifest.sourceHashes) {
    const target = resolveInsideRoot(repoRoot, snapshot.path);
    const actual = hashFile(target);
    if (actual !== snapshot.hash) {
      add('stale_source', `Source changed after planning: ${snapshot.path}`,
        {path: snapshot.path, expected: snapshot.hash, actual});
    }
  }
  if (errors.length) {
    return {errors, applicable: []};
  }
  if (manifest.source && manifest.source.path) {
    resolveInsideRoot(repoRoot, manifest.source.path);
  }

  function textArrayIssue(value, label) {
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
      return {code: 'text_array_invalid', message: `${label} must contain only text values.`};
    }
    return null;
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
      return fatal('source_item_invalid', 'Manifest contains invalid source item metadata.');
    }
    const nomIssue = textArrayIssue(item.inlineNom, `Source item ${item.id} inlineNom`);
    if (nomIssue) return fatal(nomIssue.code, nomIssue.message);
    const explainIssue = textArrayIssue(item.inlineExplain, `Source item ${item.id} inlineExplain`);
    if (explainIssue) return fatal(explainIssue.code, explainIssue.message);

    const reparsedFiltered = item.rawInput === undefined
      ? undefined
      : parseMixedAnnotatedLine(item.rawInput);
    if ((reparsedFiltered !== undefined || item.filteredInput) &&
        (!reparsedFiltered || item.filteredInput !== true ||
         reparsedFiltered.original !== item.original ||
         item.inlineNom.length || item.inlineExplain.length)) {
      return fatal('source_item_filter_invalid', `Source item ${item.id} has invalid filtered input metadata.`);
    }
    sourceItems.set(item.id, item);
  }

  if (manifest.source.kind === 'inline') {
    if (typeof manifest.source.input !== 'string' ||
        JSON.stringify(parseInputText(manifest.source.input)) !==
          JSON.stringify(manifest.source.items)) {
      return fatal('inline_source_mismatch', 'Manifest inline source items do not match the planned input.');
    }
  }

  if (manifest.source.kind === 'file') {
    const range = manifest.source.range;
    if (range !== null && (!range || !Number.isInteger(range.startLine) ||
        !Number.isInteger(range.endLine) || range.startLine < 1 || range.endLine < range.startLine)) {
      return fatal('source_range_invalid', 'Manifest contains an invalid source range.');
    }
    const inputPath = resolveInsideRoot(repoRoot, manifest.source.path);
    const currentItems = parseInputText(fs.readFileSync(inputPath, 'utf8'), {
      startLine: range ? range.startLine : null,
      endLine: range ? range.endLine : null
    });
    if (JSON.stringify(currentItems) !== JSON.stringify(manifest.source.items)) {
      return fatal('source_bytes_mismatch', 'Manifest source items do not match the planned input bytes.');
    }
  }

  const context = {
    sourceItems,
    existingUserKeys,
    approvedKeys: new Set(),
    primaryItemIds: new Set(),
    seenEntryKeys: new Set()
  };
  const applicable = [];
  for (const entry of manifest.entries) {
    const issue = checkEntry(entry, context, textArrayIssue);
    if (issue) {
      add(issue.code, issue.message);
      continue;
    }
    if (entry.status !== 'skipped' && entry.decision === 'apply') {
      applicable.push(entry);
    }
  }

  return {errors, applicable};
}

// Returns the first defect in this entry, or null. Stopping at the first keeps the report one
// line per entry while still covering every entry, and mirrors the order the original
// throw-on-first validator used so its messages are reproduced exactly.
function checkEntry(entry, context, textArrayIssue) {
  const {sourceItems, existingUserKeys, approvedKeys, primaryItemIds, seenEntryKeys} = context;

  if (!entry || !['proposed', 'needs-review', 'skipped'].includes(entry.status)) {
    return {
      code: 'entry_status_invalid',
      message: `Entry ${entry && entry.id ? entry.id : '(unknown)'} has invalid status.`
    };
  }
  if (typeof entry.id !== 'string' || typeof entry.sourceItemId !== 'string' ||
      !sourceItems.has(entry.sourceItemId) || typeof entry.primary !== 'boolean' ||
      typeof entry.original !== 'string' || typeof entry.vi !== 'string') {
    return {code: 'entry_shape_invalid', message: `Entry ${entry.id || '(unknown)'} has invalid field shapes.`};
  }
  for (const [value, label] of [
    [entry.nom, `Entry ${entry.id} nom`],
    [entry.explain || [], `Entry ${entry.id} explain`],
    [entry.provenance || [], `Entry ${entry.id} provenance`],
    [entry.choices || [], `Entry ${entry.id} choices`],
    [entry.notes || [], `Entry ${entry.id} notes`]
  ]) {
    const issue = textArrayIssue(value, label);
    if (issue) return issue;
  }

  const sourceItem = sourceItems.get(entry.sourceItemId);
  if (entry.original !== (sourceItem.rawInput || sourceItem.original)) {
    return {code: 'entry_source_mismatch', message: `Entry ${entry.id} no longer matches its source item.`};
  }
  if (sourceItem.filteredInput && (!entry.primary ||
      !entry.provenance.includes('input-filtered') ||
      !['needs-review', 'skipped'].includes(entry.status))) {
    return {code: 'entry_filter_invalid', message: `Entry ${entry.id} has invalid filtered input metadata.`};
  }
  if (entry.primary) {
    if (entry.id !== `${entry.sourceItemId}:full` || primaryItemIds.has(entry.sourceItemId)) {
      return {code: 'entry_primary_invalid', message: `Entry ${entry.id} has invalid primary source metadata.`};
    }
    primaryItemIds.add(entry.sourceItemId);
  }

  if (entry.status === 'skipped') {
    const skippedKey = normalizeTerm(entry.vi);
    if (!existingUserKeys.has(skippedKey) && !seenEntryKeys.has(skippedKey)) {
      return {code: 'entry_skip_invalid', message: `Entry ${entry.id} has invalid skipped status.`};
    }
    seenEntryKeys.add(skippedKey);
    if (entry.decision === 'apply') {
      return {code: 'skipped_entry_applied', message: `Skipped entry ${entry.id} cannot be applied.`};
    }
    return null;
  }

  seenEntryKeys.add(normalizeTerm(entry.vi));
  if (!['apply', 'reject'].includes(entry.decision)) {
    return {
      code: 'decision_missing',
      message: `Entry ${entry.id || entry.vi} requires a final apply/reject decision.`
    };
  }
  if (entry.decision === 'reject') {
    return null;
  }

  const key = normalizeTerm(entry.vi);
  if (!key) {
    return {code: 'entry_vi_missing', message: `Entry ${entry.id || '(unknown)'} is missing vi.`};
  }
  if (!Array.isArray(entry.nom) || !entry.nom.length ||
      entry.nom.some((candidate) => !CJK_ONLY_PATTERN.test(cleanText(candidate)))) {
    return {code: 'entry_nom_invalid', message: `Entry ${entry.id || key} must contain valid Nom/CJK values.`};
  }
  if (entry.explain !== undefined && !Array.isArray(entry.explain)) {
    return {code: 'entry_explain_invalid', message: `Entry ${entry.id || key} has invalid explain values.`};
  }
  if (entry.replace !== undefined) {
    if (typeof entry.replace !== 'boolean') {
      return {code: 'entry_replace_invalid', message: `Entry ${entry.id || key} has an invalid replace flag.`};
    }
    // Shrinking a stored entry is only reachable from an entry the reviewer actually
    // looked at; an auto-resolved `proposed` entry may never drop existing values.
    if (entry.replace && entry.status !== 'needs-review') {
      return {
        code: 'entry_replace_unreviewed',
        message: `Entry ${entry.id || key} may only replace stored values from a reviewed entry.`
      };
    }
  }
  if (approvedKeys.has(key)) {
    return {code: 'duplicate_approved_key', message: `Duplicate approved key: ${key}`};
  }
  approvedKeys.add(key);
  return null;
}

// The apply path is the only caller that writes, so normalization lives here rather than
// inside collection, which callers run purely to report.
function normalizeApprovedEntries(entries) {
  for (const entry of entries) {
    entry.key = normalizeTerm(entry.vi);
    entry.vi = cleanText(entry.vi);
    entry.nom = stableUnique(entry.nom.map(cleanText));
    entry.explain = stableUnique((entry.explain || []).map(cleanText));
  }
  return entries;
}

function validateManifest(manifest, options = {}) {
  if (!options.approved) {
    throw new WorkflowError('approval_required', 'apply requires explicit --approve.');
  }
  const {errors, applicable} = collectManifestIssues(manifest, options);
  if (errors.length) {
    throw errors[0];
  }
  return normalizeApprovedEntries(applicable);
}

module.exports = {
  collectManifestIssues,
  normalizeApprovedEntries,
  validateManifest
};
