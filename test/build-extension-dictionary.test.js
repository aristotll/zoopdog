'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  buildBaseDictionary,
  parseDictionaryLine,
  parseDictionarySource,
  serializeBaseDictionary
} = require('../scripts/build-extension-dictionary');

test('import performs no I/O', () => {
  // Requiring the module must not read vnedict.txt or write vnedict.json; only calling
  // buildBaseDictionary()/main() should touch the filesystem.
  assert.equal(typeof buildBaseDictionary, 'function');
});

test('a comment or colon-less line is dropped', () => {
  assert.equal(parseDictionaryLine('# a comment'), null);
  assert.equal(parseDictionaryLine('no colon here'), null);
  assert.equal(parseDictionaryLine(''), null);
});

test('parsing matches the expected entry shape', () => {
  assert.deepEqual(parseDictionaryLine('chào : hello; to greet'), {
    en: [
      {def: 'hello', pos: ''},
      {def: 'to greet', pos: 'verb'}
    ],
    vn: 'chào'
  });
});

test('sense-number markers are stripped from each definition', () => {
  assert.deepEqual(parseDictionaryLine('đi : (1) to go; (2) to walk'), {
    en: [
      {def: 'to go', pos: 'verb'},
      {def: 'to walk', pos: 'verb'}
    ],
    vn: 'đi'
  });
});

// The historical bug: `line.split(":")[1]` only keeps the text between the first and second
// colon, so a definition containing more than one colon silently drops every sense after the
// second one. Splitting on the first colon only preserves the rest of the line.
test('a definition containing more than one colon preserves every sense', () => {
  const parsed = parseDictionaryLine('sói : (1) wolf: (2) bald; (3) chloranth');
  assert.deepEqual(parsed.vn, 'sói');
  assert.deepEqual(parsed.en.map((item) => item.def), ['wolf:  bald', 'chloranth']);
});

test('a stray leading BOM on a line is passed through untouched, matching the Python original', () => {
  const parsed = parseDictionaryLine('﻿A Căn Đình : Argentina');
  assert.equal(parsed.vn, '﻿A Căn Đình');
});

test('parseDictionarySource filters comments and colon-less lines across a whole file', () => {
  const source = [
    '﻿# VNEDICT header',
    'a : first',
    '',
    'not a dictionary line',
    'b : second; third'
  ].join('\n');

  assert.deepEqual(parseDictionarySource(source).map((entry) => entry.vn), ['a', 'b']);
});

test('serializeBaseDictionary matches make_dict.py\'s pretty-printed, sorted-key JSON format', () => {
  const bytes = serializeBaseDictionary([{en: [{def: 'dog', pos: ''}], vn: 'chó'}]);
  assert.equal(bytes, JSON.stringify([{en: [{def: 'dog', pos: ''}], vn: 'chó'}], null, 4));
  assert.ok(!bytes.endsWith('\n'), 'no trailing newline, matching json.dump\'s output');
});

test('buildBaseDictionary writes via the injected writer and reports the entry count', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zoopdog-base-dict-'));
  const sourcePath = path.join(dir, 'vnedict.txt');
  const outputPath = path.join(dir, 'vnedict.json');
  fs.writeFileSync(sourcePath, '# header\na : one\nb : two; three\n', 'utf8');

  const result = buildBaseDictionary({sourcePath, outputPath});

  assert.equal(result.entryCount, 2);
  const written = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
  assert.deepEqual(written.map((entry) => entry.vn), ['a', 'b']);

  fs.rmSync(dir, {recursive: true, force: true});
});

test('the real vnedict.txt regenerates vnedict.json with only the colon-split fix as a difference', () => {
  const repoRoot = path.resolve(__dirname, '..');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zoopdog-base-dict-real-'));
  const outputPath = path.join(dir, 'vnedict.json');

  const result = buildBaseDictionary({
    sourcePath: path.join(repoRoot, 'zd-extension/db_src/vnedict.txt'),
    outputPath
  });

  const committed = JSON.parse(fs.readFileSync(
    path.join(repoRoot, 'zd-extension/db_src/vnedict.json'), 'utf8'
  ));
  const regenerated = JSON.parse(fs.readFileSync(outputPath, 'utf8'));

  assert.equal(result.entryCount, committed.length);
  assert.deepEqual(regenerated.map((entry) => entry.vn), committed.map((entry) => entry.vn),
    'every headword and its position must match exactly -- only definitions may differ');

  fs.rmSync(dir, {recursive: true, force: true});
});
