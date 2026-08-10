'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {normalizeTerm, stableUnique} = require('../lib/text');
const repoPaths = require('../lib/paths');
const {WorkflowError} = require('./errors');
const {hashFile, resolveInsideRoot} = require('./fsutil');
const {parseFileMention, parseInputText} = require('./input');
const {composeNom, loadLocalSources, resolveSpelling} = require('./sources');

function makeCandidate(item, vi, key, sources, options = {}) {
  const local = sources.index.get(key);
  const inlineNom = options.primary ? item.inlineNom : [];
  const inlineExplain = options.primary ? item.inlineExplain : [];
  let nom = stableUnique([...inlineNom, ...(local ? local.nom : [])]);
  const explain = stableUnique([...inlineExplain, ...(local ? local.explain : [])]);
  const notes = [];
  let composed = false;

  if (!nom.length && key.includes(' ')) {
    const variants = composeNom(vi.split(/\s+/), sources.index);
    if (variants.length) {
      nom = variants;
      composed = true;
      notes.push(variants.length > 1
        ? 'Multiple compositions from locally supported components are preserved in Vietnamese order; review required.'
        : 'Composed from locally supported components in Vietnamese order; review required.');
    }
  }

  if (local && !sources.userKeys.has(key)) {
    notes.push(`Local overlap from ${local.sources.join(', ')} will merge and de-duplicate during generation.`);
  }

  const choices = options.choices || [];
  const skipped = sources.userKeys.has(key);
  if (item.filteredInput && options.primary) {
    notes.push('Non-Vietnamese annotations were filtered before dictionary lookup; AI review required.');
  }
  const needsReview = !skipped && (!nom.length || choices.length > 0 || composed ||
    (item.filteredInput && options.primary));
  return {
    id: `${item.id}:${options.primary ? 'full' : key}`,
    sourceItemId: item.id,
    primary: Boolean(options.primary),
    original: item.rawInput || item.original,
    vi,
    key,
    nom,
    explain,
    provenance: stableUnique([
      ...(item.filteredInput && options.primary ? ['input-filtered'] : []),
      ...(inlineNom.length || inlineExplain.length ? ['inline'] : []),
      ...(local ? local.sources : []),
      ...(composed ? ['composed'] : [])
    ]),
    choices,
    notes: skipped ? ['Already exists in user_nom_entries.jsonc.'] : notes,
    status: skipped ? 'skipped' : (needsReview ? 'needs-review' : 'proposed'),
    decision: null
  };
}

function resolveItems(items, sources) {
  const entries = [];
  const seen = new Set();

  function addCandidate(candidate) {
    if (seen.has(candidate.key)) {
      // A suppressed duplicate is a record that the key was already claimed, not this
      // item's full-phrase entry. Clearing `primary` keeps the manifest validator's
      // one-primary-per-item identity rule strict instead of teaching it about suffixes.
      entries.push({
        ...candidate,
        id: `${candidate.sourceItemId}:duplicate:${candidate.key}`,
        primary: false,
        status: 'skipped',
        notes: [`Duplicate candidate encountered earlier in this batch: ${candidate.key}.`],
        decision: null
      });
      return;
    }
    seen.add(candidate.key);
    entries.push(candidate);
  }

  for (const item of items) {
    const spelling = resolveSpelling(item.original, sources);
    addCandidate(makeCandidate(item, spelling.vi, spelling.key, sources, {
      primary: true,
      choices: spelling.choices
    }));

    if (spelling.choices.length || item.filteredInput) {
      continue;
    }
    const tokens = spelling.vi.split(/\s+/);
    for (let length = tokens.length - 1; length >= 2; length--) {
      for (let start = 0; start + length <= tokens.length; start++) {
        const phrase = tokens.slice(start, start + length).join(' ');
        const key = normalizeTerm(phrase);
        if (!sources.index.has(key)) {
          continue;
        }
        addCandidate(makeCandidate(item, sources.index.get(key).vi, key, sources));
      }
    }
  }
  return entries;
}

function createPlan(options = {}) {
  const repoRoot = path.resolve(options.repoRoot || path.join(__dirname, '../..'));
  if (options.words !== undefined && options.file !== undefined) {
    throw new WorkflowError('Use either inline words or a file, not both.');
  }

  let items;
  let source;
  let inputPath = null;
  if (options.words !== undefined) {
    const input = String(options.words);
    items = parseInputText(input);
    source = {kind: 'inline', path: null, range: null, input, items};
  } else {
    const mention = parseFileMention(options.file || repoPaths.relative.defaultInput);
    inputPath = resolveInsideRoot(repoRoot, mention.path);
    if (!fs.existsSync(inputPath)) {
      throw new WorkflowError(`Input file does not exist: ${mention.path}`);
    }
    items = parseInputText(fs.readFileSync(inputPath, 'utf8'), mention);
    source = {
      kind: 'file',
      path: path.relative(repoRoot, inputPath),
      range: mention.startLine ? {startLine: mention.startLine, endLine: mention.endLine} : null,
      items
    };
  }

  const localSources = loadLocalSources(repoRoot);
  const snapshotPaths = [...localSources.sourcePaths];
  if (inputPath) {
    snapshotPaths.push(inputPath);
  }
  const sourceHashes = snapshotPaths.map((target) => ({
    path: path.relative(repoRoot, target),
    hash: hashFile(target)
  }));

  return {
    schemaVersion: 1,
    source,
    sourceHashes,
    entries: resolveItems(items, localSources)
  };
}

module.exports = {
  makeCandidate,
  resolveItems,
  createPlan
};
