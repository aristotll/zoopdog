#!/usr/bin/env node
// Generate zd-extension/js/realwords.js (the compact browser lexicon artifact) from the
// readable, provenance-documented source list at zd-extension/db_src/realwords-source.txt.
//
// One word per source line; comment lines (`#`) and blank lines are ignored. Words are
// NFC-normalized, deduplicated, and sorted in stable code-point order so the generated
// artifact is byte-identical across runs given the same source -- the "byte-stable rebuild"
// check in test/scripts-structure.test.js and the reproducibility test in
// test/zd-pron-core.test.js both rely on this determinism.
//
// Usage: node scripts/build-realwords-lexicon.js

'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const SOURCE_PATH = path.join(repoRoot, 'zd-extension/db_src/realwords-source.txt');
const OUTPUT_PATH = path.join(repoRoot, 'zd-extension/js/realwords.js');

function readWordList(sourcePath) {
  const raw = fs.readFileSync(sourcePath, 'utf8');
  const words = raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map((word) => word.normalize('NFC'));

  const seen = new Set();
  const deduped = [];
  for (const word of words) {
    if (seen.has(word)) continue;
    seen.add(word);
    deduped.push(word);
  }
  // Stable, locale-independent ordering: plain code-point comparison, not localeCompare
  // (whose collation rules can vary by ICU version/platform and would break byte stability).
  deduped.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return deduped;
}

function renderLexicon(words) {
  const arrayLiteral = JSON.stringify(words);
  const digest = crypto.createHash('sha256').update(arrayLiteral).digest('hex');
  return `// GENERATED FILE -- do not edit directly.
// Source: zd-extension/db_src/realwords-source.txt
// Regenerate with: node scripts/build-realwords-lexicon.js
//
// word count: ${words.length}
// sha256(JSON array): ${digest}
//
// The accepted real-word set used by the pronunciation engine's homophone search
// (zd-extension/js/zd-pron-core.js) to filter generated candidate spellings down to words
// that actually exist in Vietnamese.
const allPossibleRealWords = ${arrayLiteral}

// Present only under Node, matching zd-pron-core.js and zd-words.js: a classic <script> has
// no \`module\`, and \`typeof\` on an undeclared name is safe.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { allPossibleRealWords };
}
`;
}

function buildLexicon(sourcePath = SOURCE_PATH) {
  const words = readWordList(sourcePath);
  return { words, source: renderLexicon(words) };
}

function main() {
  const { words, source } = buildLexicon();
  fs.writeFileSync(OUTPUT_PATH, source);
  console.log(`Wrote ${OUTPUT_PATH} (${words.length} words).`);
}

if (require.main === module) {
  main();
}

module.exports = { readWordList, renderLexicon, buildLexicon, SOURCE_PATH, OUTPUT_PATH };
