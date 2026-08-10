#!/usr/bin/env node

'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {
  cleanText,
  normalizeTerm,
  parseUserNomEntries,
  readUserNomEntries
} = require('./user-nom-entries');

const EXIT_CODES = Object.freeze({
  SUCCESS: 0,
  VALIDATION: 2,
  STALE: 3,
  APPLY_FAILED: 4
});

const CJK_SEQUENCE_PATTERN = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u{20000}-\u{323AF}]+/gu;
const CJK_ONLY_PATTERN = /^[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u{20000}-\u{323AF}]+$/u;

class WorkflowError extends Error {
  constructor(message, exitCode = EXIT_CODES.VALIDATION, details = {}) {
    super(message);
    this.name = 'WorkflowError';
    this.exitCode = exitCode;
    this.details = details;
  }
}

function stableUnique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function hashFile(target) {
  if (!fs.existsSync(target)) {
    return null;
  }
  return crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');
}

function parseFileMention(value) {
  const match = String(value || '').match(/^(.*?)(?:#L(\d+)(?:-(?:L)?(\d+))?)?$/);
  if (!match || !match[1]) {
    throw new WorkflowError(`Invalid file mention: ${value}`);
  }
  const startLine = match[2] ? Number(match[2]) : null;
  const endLine = match[3] ? Number(match[3]) : startLine;
  if (startLine !== null && (startLine < 1 || endLine < startLine)) {
    throw new WorkflowError(`Invalid file line range: ${value}`);
  }
  return {path: match[1], startLine, endLine};
}

function isIgnoredMarkdownLine(line) {
  return /^\s*#{1,6}\s/.test(line) ||
    /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line) ||
    /^\s*```/.test(line);
}

function splitLineRecords(line) {
  const records = [];
  const majorParts = line.split(/([;|])/);
  for (let majorIndex = 0; majorIndex < majorParts.length; majorIndex += 2) {
    const segment = majorParts[majorIndex];
    const majorSeparator = majorParts[majorIndex + 1] || '';
    if (!segment.trim()) continue;
    const slashCount = (segment.match(/\//g) || []).length;
    if (slashCount === 2) {
      records.push({
        itemIndex: records.length + 1,
        raw: segment,
        text: segment.trim(),
        separator: majorSeparator
      });
      continue;
    }
    const commaParts = segment.split(/([,])/);
    for (let commaIndex = 0; commaIndex < commaParts.length; commaIndex += 2) {
      if (!commaParts[commaIndex].trim()) continue;
      records.push({
        itemIndex: records.length + 1,
        raw: commaParts[commaIndex],
        text: commaParts[commaIndex].trim(),
        separator: commaParts[commaIndex + 1] || majorSeparator
      });
    }
  }
  return records;
}

function parseMixedAnnotatedLine(line) {
  if (line.includes('/')) return undefined;
  if (!(String(line).match(CJK_SEQUENCE_PATTERN) || []).length) return undefined;

  let latinRun = false;
  const vietnamese = cleanText(Array.from(String(line).normalize('NFC'), (character) => {
    if (/\p{Script=Latin}/u.test(character)) {
      latinRun = true;
      return character;
    }
    if (/\p{Mark}/u.test(character) && latinRun) return character;
    latinRun = false;
    return ' ';
  }).join('')).replace(/\s+/g, ' ');
  if (!/\p{Script=Latin}/u.test(vietnamese)) return null;

  return {
    original: vietnamese,
    rawInput: cleanText(line),
    inlineNom: [],
    inlineExplain: [],
    filteredInput: true
  };
}

function parseInputText(source, options = {}) {
  const startLine = options.startLine || 1;
  const endLine = options.endLine || Number.POSITIVE_INFINITY;
  const items = [];

  String(source || '').split(/\r?\n/).forEach((line, index) => {
    const lineNumber = index + 1;
    if (lineNumber < startLine || lineNumber > endLine || !line.trim() || isIgnoredMarkdownLine(line)) {
      return;
    }

    const annotated = parseMixedAnnotatedLine(line);
    if (annotated !== undefined) {
      if (annotated) {
        items.push({
          id: `L${lineNumber}:I1`,
          line: lineNumber,
          itemIndex: 1,
          ...annotated
        });
      }
      return;
    }

    splitLineRecords(line).forEach((record) => {
      const trimmed = record.text;
      const triple = trimmed.split(/\s*\/\s*/);
      const hasTriple = triple.length === 3 && triple.every(Boolean);
      items.push({
        id: `L${lineNumber}:I${record.itemIndex}`,
        line: lineNumber,
        itemIndex: record.itemIndex,
        original: cleanText(hasTriple ? triple[0] : trimmed),
        inlineNom: hasTriple ? [cleanText(triple[1])] : [],
        inlineExplain: hasTriple ? [cleanText(triple[2])] : []
      });
    });
  });

  return items;
}

function foldAccents(value) {
  return normalizeTerm(value)
    .replace(/đ/g, 'd')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .normalize('NFC');
}

function levenshtein(left, right) {
  const a = Array.from(String(left));
  const b = Array.from(String(right));
  const row = Array.from({length: b.length + 1}, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const previous = row[j];
      row[j] = Math.min(
        row[j] + 1,
        row[j - 1] + 1,
        diagonal + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
      diagonal = previous;
    }
  }
  return row[b.length];
}

function extractNomCandidates(value) {
  const text = cleanText(value).replace(/[（(][^）)]*[）)]/gu, '');
  return text.match(CJK_SEQUENCE_PATTERN) || [];
}

function addIndexedEntry(index, vi, nom, explain, source) {
  const key = normalizeTerm(vi);
  if (!key) {
    return;
  }
  if (!index.has(key)) {
    index.set(key, {key, vi: cleanText(vi), nom: [], explain: [], sources: []});
  }
  const entry = index.get(key);
  entry.nom = stableUnique([...entry.nom, ...nom]);
  entry.explain = stableUnique([...entry.explain, ...explain]);
  if (!entry.sources.includes(source)) {
    entry.sources.push(source);
  }
}

function loadLocalSources(repoRoot) {
  const userPath = path.join(repoRoot, 'zd-extension/db_src/user_nom_entries.jsonc');
  const dictionaryPath = path.join(repoRoot, 'zd-extension/db_src/vnedict2.json');
  const mdxPath = path.join(repoRoot, 'zd-extension/db_src/mdx_nom.json');
  if (!fs.existsSync(dictionaryPath)) {
    throw new WorkflowError(`Missing dictionary source: ${dictionaryPath}`);
  }

  const userEntries = readUserNomEntries(userPath);
  const userKeys = new Set(userEntries.map((entry) => entry.key));
  const index = new Map();
  const dictionary = JSON.parse(fs.readFileSync(dictionaryPath, 'utf8'));

  for (const entry of userEntries) {
    addIndexedEntry(index, entry.vi, entry.nom, entry.explain, 'user_nom_entries');
  }

  for (const entry of dictionary) {
    const nom = [];
    const explain = [];
    for (const definition of entry.en || []) {
      const text = cleanText(definition.def);
      const candidates = extractNomCandidates(text);
      if (candidates.length) {
        nom.push(...candidates);
      } else if (text) {
        explain.push(text);
      }
    }
    addIndexedEntry(index, entry.vn, nom, explain, 'vnedict2');
  }

  if (fs.existsSync(mdxPath)) {
    const payload = JSON.parse(fs.readFileSync(mdxPath, 'utf8'));
    for (const [term, values] of Object.entries(payload.entries || payload)) {
      const candidates = Array.isArray(values) ? values : [values];
      addIndexedEntry(index, term, candidates.flatMap(extractNomCandidates), [], 'mdx_nom');
    }
  }

  const folded = new Map();
  for (const key of index.keys()) {
    const foldedKey = foldAccents(key);
    if (!folded.has(foldedKey)) {
      folded.set(foldedKey, []);
    }
    folded.get(foldedKey).push(key);
  }
  for (const keys of folded.values()) {
    keys.sort();
  }

  return {
    index,
    folded,
    userKeys,
    sourcePaths: [userPath, dictionaryPath, mdxPath]
  };
}

function resolveSpelling(value, sources) {
  const key = normalizeTerm(value);
  if (sources.index.has(key)) {
    return {key, vi: cleanText(value), choices: []};
  }

  const foldedKey = foldAccents(value);
  const foldedMatches = sources.folded.get(foldedKey) || [];
  if (foldedMatches.length === 1) {
    const resolvedKey = foldedMatches[0];
    return {key: resolvedKey, vi: sources.index.get(resolvedKey).vi, choices: []};
  }
  if (foldedMatches.length > 1) {
    return {
      key,
      vi: cleanText(value),
      choices: foldedMatches.map((match) => sources.index.get(match).vi)
    };
  }

  const wordCount = foldedKey.split(/\s+/).length;
  const threshold = Math.max(1, Math.min(2, Math.floor(Array.from(foldedKey).length / 5)));
  const suggestions = [];
  for (const candidate of sources.index.keys()) {
    const foldedCandidate = foldAccents(candidate);
    if (foldedCandidate.split(/\s+/).length !== wordCount) {
      continue;
    }
    const distance = levenshtein(foldedKey, foldedCandidate);
    if (distance <= threshold) {
      suggestions.push({candidate, distance});
    }
  }
  suggestions.sort((a, b) => a.distance - b.distance || (a.candidate < b.candidate ? -1 : 1));
  return {
    key,
    vi: cleanText(value),
    choices: suggestions.map(({candidate}) => sources.index.get(candidate).vi)
  };
}

function composeNom(tokens, index, start = 0, memo = new Map()) {
  if (start === tokens.length) {
    return [''];
  }
  if (memo.has(start)) return memo.get(start);
  const variants = [];
  for (let end = tokens.length; end > start; end--) {
    const key = normalizeTerm(tokens.slice(start, end).join(' '));
    const entry = index.get(key);
    if (!entry || entry.nom.length !== 1) {
      continue;
    }
    for (const remainder of composeNom(tokens, index, end, memo)) {
      variants.push(`${entry.nom[0]}${remainder}`);
    }
  }
  const result = stableUnique(variants);
  memo.set(start, result);
  return result;
}

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
      entries.push({
        ...candidate,
        id: `${candidate.id}:duplicate`,
        status: 'skipped',
        notes: ['Duplicate candidate encountered earlier in this batch.'],
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

function resolveInsideRoot(repoRoot, relativePath) {
  const root = path.resolve(repoRoot);
  const target = path.resolve(root, relativePath);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new WorkflowError(`Path escapes repository root: ${relativePath}`);
  }
  const realRoot = fs.realpathSync(root);
  let existingAncestor = target;
  const missingParts = [];
  while (!fs.existsSync(existingAncestor)) {
    const parent = path.dirname(existingAncestor);
    if (parent === existingAncestor) {
      throw new WorkflowError(`Cannot resolve repository path: ${relativePath}`);
    }
    missingParts.unshift(path.basename(existingAncestor));
    existingAncestor = parent;
  }
  const realTarget = path.join(fs.realpathSync(existingAncestor), ...missingParts);
  if (realTarget !== realRoot && !realTarget.startsWith(`${realRoot}${path.sep}`)) {
    throw new WorkflowError(`Path resolves outside repository root: ${relativePath}`);
  }
  return target;
}

function createPlan(options = {}) {
  const repoRoot = path.resolve(options.repoRoot || path.join(__dirname, '..'));
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
    const mention = parseFileMention(options.file || '.idea/newfile.md');
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

function validateManifest(manifest, options = {}) {
  const repoRoot = path.resolve(options.repoRoot || path.join(__dirname, '..'));
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
    'zd-extension/db_src/user_nom_entries.jsonc',
    'zd-extension/db_src/vnedict2.json',
    'zd-extension/db_src/mdx_nom.json'
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
    'zd-extension/db_src/user_nom_entries.jsonc'
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

function skipJsoncTrivia(source, start) {
  let index = start;
  while (index < source.length) {
    if (/\s/.test(source[index])) {
      index++;
      continue;
    }
    if (source[index] === '/' && source[index + 1] === '/') {
      index += 2;
      while (index < source.length && source[index] !== '\n') index++;
      continue;
    }
    if (source[index] === '/' && source[index + 1] === '*') {
      const end = source.indexOf('*/', index + 2);
      if (end < 0) throw new WorkflowError('Unterminated JSONC block comment.');
      index = end + 2;
      continue;
    }
    break;
  }
  return index;
}

function readJsonStringEnd(source, start) {
  let escaped = false;
  for (let index = start + 1; index < source.length; index++) {
    const char = source[index];
    if (escaped) {
      escaped = false;
    } else if (char === '\\') {
      escaped = true;
    } else if (char === '"') {
      return index + 1;
    }
  }
  throw new WorkflowError('Unterminated JSON string.');
}

function readJsonValueEnd(source, start) {
  if (source[start] === '"') {
    return readJsonStringEnd(source, start);
  }
  let square = 0;
  let curly = 0;
  let index = start;
  while (index < source.length) {
    const char = source[index];
    if (char === '"') {
      index = readJsonStringEnd(source, index);
      continue;
    }
    if (char === '/' && (source[index + 1] === '/' || source[index + 1] === '*')) {
      index = skipJsoncTrivia(source, index);
      continue;
    }
    if (char === '[') square++;
    else if (char === ']') {
      square--;
      if (square === 0 && curly === 0) return index + 1;
    }
    else if (char === '{') curly++;
    else if (char === '}') {
      if (square === 0 && curly === 0) return index;
      curly--;
      if (square === 0 && curly === 0) return index + 1;
    } else if (char === ',' && square === 0 && curly === 0) {
      return index;
    }
    index++;
  }
  return index;
}

function findPropertyValueSpan(objectSource, property) {
  let index = skipJsoncTrivia(objectSource, 1);
  while (index < objectSource.length && objectSource[index] !== '}') {
    if (objectSource[index] !== '"') {
      throw new WorkflowError('Expected a JSONC object property.');
    }
    const keyEnd = readJsonStringEnd(objectSource, index);
    const key = JSON.parse(objectSource.slice(index, keyEnd));
    index = skipJsoncTrivia(objectSource, keyEnd);
    if (objectSource[index] !== ':') {
      throw new WorkflowError(`Expected ':' after JSONC property ${key}.`);
    }
    const valueStart = skipJsoncTrivia(objectSource, index + 1);
    const valueEnd = readJsonValueEnd(objectSource, valueStart);
    if (key === property) {
      return {start: valueStart, end: valueEnd};
    }
    index = skipJsoncTrivia(objectSource, valueEnd);
    if (objectSource[index] === ',') {
      index = skipJsoncTrivia(objectSource, index + 1);
    }
  }
  return null;
}

function findTopLevelObjectSpans(source) {
  const spans = [];
  let square = 0;
  let curly = 0;
  let objectStart = null;
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (char === '"') {
      index = readJsonStringEnd(source, index) - 1;
      continue;
    }
    if (char === '/' && (source[index + 1] === '/' || source[index + 1] === '*')) {
      index = skipJsoncTrivia(source, index) - 1;
      continue;
    }
    if (char === '[') square++;
    else if (char === ']') square--;
    else if (char === '{') {
      if (square === 1 && curly === 0) objectStart = index;
      curly++;
    } else if (char === '}') {
      curly--;
      if (square === 1 && curly === 0 && objectStart !== null) {
        spans.push({start: objectStart, end: index + 1});
        objectStart = null;
      }
    }
  }
  return spans;
}

function updateObjectValues(objectSource, entry) {
  const replacements = [];
  const missing = [];
  for (const [property, value] of [
    ['vi', entry.vi],
    ['nom', entry.nom],
    ['explain', entry.explain || []]
  ]) {
    const span = findPropertyValueSpan(objectSource, property);
    if (span) {
      replacements.push({...span, value: JSON.stringify(value)});
    } else {
      missing.push([property, value]);
    }
  }
  replacements.sort((a, b) => b.start - a.start);
  for (const replacement of replacements) {
    objectSource = objectSource.slice(0, replacement.start) + replacement.value + objectSource.slice(replacement.end);
  }
  for (const [property, value] of missing) {
    const existingSpans = ['vi', 'nom', 'explain']
      .map((name) => findPropertyValueSpan(objectSource, name))
      .filter(Boolean)
      .sort((a, b) => b.end - a.end);
    if (!existingSpans.length) throw new WorkflowError('Cannot insert into an empty user entry object.');
    const lastValueEnd = existingSpans[0].end;
    if (objectSource[skipJsoncTrivia(objectSource, lastValueEnd)] !== ',') {
      objectSource = objectSource.slice(0, lastValueEnd) + ',' + objectSource.slice(lastValueEnd);
    }
    const newline = objectSource.includes('\r\n') ? '\r\n' : '\n';
    const propertyIndent = (objectSource.match(/\r?\n([ \t]+)"/) || [null, '  '])[1];
    const close = objectSource.lastIndexOf('}');
    const trailing = objectSource.slice(0, close).match(/(?:\r\n|\n)([ \t]*)$/);
    const insertionPoint = trailing ? close - trailing[0].length : close;
    const closingIndent = trailing ? trailing[1] : '';
    objectSource = objectSource.slice(0, insertionPoint) +
      `${newline}${propertyIndent}${JSON.stringify(property)}: ${JSON.stringify(value)}` +
      `${newline}${closingIndent}${objectSource.slice(close)}`;
  }
  return objectSource;
}

function upsertUserEntriesJsonc(source, incomingEntries) {
  let updated = String(source);
  const spans = findTopLevelObjectSpans(updated);
  const indexed = new Map();
  for (const span of spans) {
    const objectSource = updated.slice(span.start, span.end);
    const [entry] = parseUserNomEntries(`[${objectSource}]`, 'user_nom_entries.jsonc');
    if (indexed.has(entry.key)) {
      throw new WorkflowError(`Duplicate existing user entry key: ${entry.key}`);
    }
    indexed.set(entry.key, span);
  }

  const replacements = [];
  const additions = [];
  for (const entry of incomingEntries) {
    const key = normalizeTerm(entry.vi);
    if (indexed.has(key)) {
      const span = indexed.get(key);
      replacements.push({
        ...span,
        value: updateObjectValues(updated.slice(span.start, span.end), entry)
      });
    } else {
      additions.push({vi: entry.vi, nom: entry.nom, explain: entry.explain || []});
    }
  }
  replacements.sort((a, b) => b.start - a.start);
  for (const replacement of replacements) {
    updated = updated.slice(0, replacement.start) + replacement.value + updated.slice(replacement.end);
  }

  if (additions.length) {
    const newline = updated.includes('\r\n') ? '\r\n' : '\n';
    const close = updated.lastIndexOf(']');
    if (close < 0) throw new WorkflowError('User entry JSONC must contain a top-level array.');
    let prefix = updated.slice(0, close).replace(/\s*$/, '');
    const hasEntries = findTopLevelObjectSpans(updated).length > 0;
    if (hasEntries && !prefix.endsWith(',')) prefix += ',';
    const entryIndent = (updated.match(/\r?\n([ \t]+)\{/) || [null, '  '])[1];
    const propertyIndent = (updated.match(/\r?\n([ \t]+)"/) || [null, `${entryIndent}  `])[1];
    const indentUnit = propertyIndent.startsWith(entryIndent)
      ? propertyIndent.slice(entryIndent.length) || '  '
      : '  ';
    const blocks = additions.map((entry) => JSON.stringify(entry, null, 2)
      .split('\n').map((line) => {
        const leading = line.match(/^ */)[0].length;
        return `${entryIndent}${indentUnit.repeat(leading / 2)}${line.trimStart()}`;
      }).join(newline));
    updated = `${prefix}${newline}${blocks.join(`,${newline}`)}${newline}${updated.slice(close)}`;
  }

  parseUserNomEntries(updated, 'user_nom_entries.jsonc');
  return updated;
}

function cleanupInputContent(source, sourceItems, appliedItemIds) {
  const hadFinalNewline = /\r?\n$/.test(source);
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const removalsByLine = new Map();
  for (const item of sourceItems) {
    if (!appliedItemIds.has(item.id)) continue;
    if (!removalsByLine.has(item.line)) removalsByLine.set(item.line, new Set());
    removalsByLine.get(item.line).add(item.itemIndex);
  }

  const lines = source.split(/\r?\n/);
  if (hadFinalNewline) lines.pop();
  const keptLines = [];
  lines.forEach((line, lineIndex) => {
    const removals = removalsByLine.get(lineIndex + 1);
    if (!removals) {
      keptLines.push(line);
      return;
    }
    const records = splitLineRecords(line);
    const remaining = records.filter((record) => !removals.has(record.itemIndex));
    if (!remaining.length) return;
    const rebuilt = remaining.map((record, index) => {
      if (index === remaining.length - 1) return record.raw;
      return `${record.raw}${record.separator || ','}`;
    }).join('');
    keptLines.push(rebuilt);
  });
  return keptLines.join(newline) + (hadFinalNewline ? newline : '');
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
    throw new WorkflowError(
      `${stage} failed${result && result.stderr ? `: ${String(result.stderr).trim()}` : '.'}`,
      EXIT_CODES.APPLY_FAILED,
      {stage}
    );
  }
}

function extractAssignedJson(source, variableName) {
  const marker = `var ${variableName} =`;
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) throw new WorkflowError(`Missing generated ${variableName}.`, EXIT_CODES.APPLY_FAILED);
  let start = markerIndex + marker.length;
  while (start < source.length && /\s/.test(source[start])) start++;
  const end = readJsonValueEnd(source, start);
  return JSON.parse(source.slice(start, end));
}

function applyManifest(manifest, options = {}) {
  const repoRoot = path.resolve(options.repoRoot || path.join(__dirname, '..'));
  const approvedEntries = validateManifest(manifest, {repoRoot, approved: options.approved});
  if (!approvedEntries.length) {
    return {
      ok: true,
      action: 'apply',
      updated: [],
      removedItems: [],
      rebuilt: [],
      checks: []
    };
  }
  const commandRunner = options.commandRunner || defaultCommandRunner;
  const userPath = path.join(repoRoot, 'zd-extension/db_src/user_nom_entries.jsonc');
  const nomTarget = path.join(repoRoot, 'zoopdog-nom-ruby.user.js');
  const popupTarget = path.join(repoRoot, 'zoopdog-popupdict.user.js');
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
    for (const entry of approvedEntries) {
      if (!Object.hasOwn(nomMap, entry.key) || !Object.hasOwn(popupMap, entry.key)) {
        throw new WorkflowError(`Generated dictionaries are missing approved key: ${entry.key}`, EXIT_CODES.APPLY_FAILED);
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
      rebuilt: ['zoopdog-nom-ruby.user.js', 'zoopdog-popupdict.user.js'],
      checks: ['NOM_MAP', 'ZOO_DICTIONARY', 'node --check']
    };
  } catch (error) {
    restoreSnapshot(snapshot);
    if (error instanceof WorkflowError && error.exitCode === EXIT_CODES.APPLY_FAILED) {
      throw error;
    }
    throw new WorkflowError(error.message, EXIT_CODES.APPLY_FAILED);
  }
}

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

function atomicWrite(target, content) {
  fs.mkdirSync(path.dirname(target), {recursive: true});
  const temporary = `${target}.tmp-${process.pid}`;
  try {
    fs.writeFileSync(temporary, content);
    fs.renameSync(temporary, target);
  } finally {
    if (fs.existsSync(temporary)) {
      fs.unlinkSync(temporary);
    }
  }
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
