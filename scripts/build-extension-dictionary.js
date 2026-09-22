'use strict';

const fs = require('node:fs');
const {atomicWrite} = require('./lib/fsutil');
const {absolute} = require('./lib/paths');

const SENSE_MARKER_PATTERN = /\(\d+\)/g;
const LEADING_WHITESPACE = /^\p{White_Space}+/u;
const TRAILING_WHITESPACE = /\p{White_Space}+$/u;

// Python's `str.strip()` trims Unicode whitespace (the `White_Space` property) but, unlike
// JavaScript's `String.prototype.trim`, does NOT treat U+FEFF (byte-order mark) as whitespace.
// `vnedict.txt` has a handful of lines carrying a stray leading BOM, and `make_dict.py` passed
// those through untouched -- matching that here keeps this port's output byte-identical to the
// original except for the intended colon-split fix.
function pythonStrip(value) {
  return value.replace(LEADING_WHITESPACE, '').replace(TRAILING_WHITESPACE, '');
}

// Node.js port of `zd-extension/db_src/make_dict.py`. The original split each line with
// `line.split(":")`, which for a definition containing more than one colon silently drops
// every sense after the second colon -- this splits on the first colon only, so multi-colon
// definitions keep every sense. Otherwise byte-identical to the Python output: `.strip()`
// whitespace trimming (including a source line's own leading `﻿`, which the original
// also passed through unstripped), `(N)` sense-marker removal, and a `pos` of `"verb"` for
// any definition starting with `"to "`.
function parseDictionaryLine(line) {
  if (line.startsWith('#')) {
    return null;
  }
  const colonIndex = line.indexOf(':');
  if (colonIndex === -1) {
    return null;
  }

  const vn = pythonStrip(line.slice(0, colonIndex));
  const definitionsText = pythonStrip(line.slice(colonIndex + 1));

  const en = definitionsText.split(';').map((definition) => {
    const trimmedDef = pythonStrip(definition.replace(SENSE_MARKER_PATTERN, ''));
    return {
      def: trimmedDef,
      pos: trimmedDef.startsWith('to ') ? 'verb' : ''
    };
  });

  return {en, vn};
}

function parseDictionarySource(text) {
  return text.split('\n')
    .map(parseDictionaryLine)
    .filter(Boolean);
}

function serializeBaseDictionary(entries) {
  return JSON.stringify(entries, null, 4);
}

function buildBaseDictionary({
  sourcePath = absolute.baseDictionarySource,
  outputPath = absolute.baseDictionary,
  write = atomicWrite
} = {}) {
  const source = fs.readFileSync(sourcePath, 'utf8');
  const entries = parseDictionarySource(source);
  const bytes = serializeBaseDictionary(entries);
  write(outputPath, bytes);
  return {outputPath, entryCount: entries.length};
}

function main() {
  const result = buildBaseDictionary();
  console.log(`Built ${result.outputPath}`);
  console.log(`Entries: ${result.entryCount}`);
}

if (require.main === module) {
  main();
}

module.exports = {
  buildBaseDictionary,
  parseDictionaryLine,
  parseDictionarySource,
  serializeBaseDictionary
};
