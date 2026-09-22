'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  groupEntries,
  validateGroupedEntries,
  buildCollisionReport,
  formatCollisionDiagnostics
} = require('../scripts/lib/dictionary-identity');

test('groups an ordinary entry with a single headword and no redundant association', () => {
  const groups = groupEntries([
    {vn: 'nhà', en: [{def: 'house', pos: 'n'}]}
  ]);
  assert.deepEqual(groups, [
    {key: 'nhà', headwords: ['nhà'], en: [{def: 'house', pos: 'n'}]}
  ]);
});

test('removes exact duplicate source rows without losing distinct senses', () => {
  const groups = groupEntries([
    {vn: 'đi', en: [{def: 'to go', pos: 'v'}]},
    {vn: 'đi', en: [{def: 'to go', pos: 'v'}]},
    {vn: 'đi', en: [{def: 'go away (imperative)', pos: 'v'}]}
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].headwords.length, 1);
  assert.deepEqual(groups[0].en, [
    {def: 'to go', pos: 'v'},
    {def: 'go away (imperative)', pos: 'v'}
  ]);
});

test('preserves both display variants and every sense on a capitalization collision', () => {
  const groups = groupEntries([
    {vn: 'Ba Lê', en: [{def: 'Paris (proper name)', pos: 'n'}]},
    {vn: 'ba lê', en: [{def: 'ballet', pos: 'n'}]}
  ]);
  assert.equal(groups.length, 1);
  const [group] = groups;
  assert.equal(group.key, 'ba lê');
  assert.deepEqual(group.headwords, ['Ba Lê', 'ba lê']);
  assert.deepEqual(group.en, [
    {def: 'Paris (proper name)', pos: 'n'},
    {def: 'ballet', pos: 'n', headword: 'ba lê'}
  ]);
});

test('is deterministic across reruns on the same fixture', () => {
  const source = [
    {vn: 'Ba Lê', en: [{def: 'Paris (proper name)', pos: 'n'}]},
    {vn: 'ba lê', en: [{def: 'ballet', pos: 'n'}]},
    {vn: 'nhà', en: [{def: 'house', pos: 'n'}]}
  ];
  const first = groupEntries(source);
  const second = groupEntries(source);
  assert.deepEqual(first, second);
});

test('keeps stable first-source-occurrence order across three-way collisions', () => {
  const groups = groupEntries([
    {vn: 'Đỗ', en: [{def: 'surname Do', pos: 'n'}]},
    {vn: 'đỗ', en: [{def: 'to pass (an exam)', pos: 'v'}]},
    {vn: 'ĐỖ', en: [{def: 'shouty variant', pos: 'n'}]}
  ]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].headwords, ['Đỗ', 'đỗ', 'ĐỖ']);
  assert.deepEqual(groups[0].en.map((sense) => sense.headword), [undefined, 'đỗ', 'ĐỖ']);
});

test('skips rows with an empty normalized headword', () => {
  const groups = groupEntries([
    {vn: '   ', en: [{def: 'whitespace only', pos: ''}]},
    {vn: 'nhà', en: [{def: 'house', pos: 'n'}]}
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].key, 'nhà');
});

test('rejects malformed source rows', () => {
  assert.throws(() => groupEntries([{vn: 'nhà'}]), TypeError);
  assert.throws(() => groupEntries([{vn: 1, en: []}]), TypeError);
  assert.throws(() => groupEntries('not an array'), TypeError);
  assert.throws(() => groupEntries([{vn: 'nhà', en: [{def: 1, pos: 'n'}]}]), TypeError);
});

test('validateGroupedEntries accepts grouped output and rejects the legacy {vn, en} shape', () => {
  const groups = groupEntries([{vn: 'nhà', en: [{def: 'house', pos: 'n'}]}]);
  assert.deepEqual(validateGroupedEntries(groups), groups);
  assert.throws(() => validateGroupedEntries([{vn: 'nhà', en: []}]), TypeError);
});

test('builds a compact collision report with no definitions dumped', () => {
  const groups = groupEntries([
    {vn: 'Ba Lê', en: [{def: 'Paris (proper name)', pos: 'n'}]},
    {vn: 'ba lê', en: [{def: 'ballet', pos: 'n'}]},
    {vn: 'nhà', en: [{def: 'house', pos: 'n'}]}
  ]);
  const report = buildCollisionReport(groups);
  assert.equal(report.totalKeys, 2);
  assert.equal(report.collisionCount, 1);
  assert.deepEqual(report.collisions, [
    {key: 'ba lê', headwordCount: 2, senseCount: 2}
  ]);
  assert.equal(JSON.stringify(report).includes('Paris'), false);
  assert.equal(JSON.stringify(report).includes('ballet'), false);

  const diagnostics = formatCollisionDiagnostics(report);
  assert.deepEqual(diagnostics, ['ba lê=2/2']);
});

test('buildCollisionReport and groupEntries are deterministic across reruns (byte stability)', () => {
  const source = [
    {vn: 'Ba Lê', en: [{def: 'Paris (proper name)', pos: 'n'}]},
    {vn: 'ba lê', en: [{def: 'ballet', pos: 'n'}]},
    {vn: 'nhà', en: [{def: 'house', pos: 'n'}]}
  ];
  const reportA = buildCollisionReport(groupEntries(source));
  const reportB = buildCollisionReport(groupEntries(source));
  assert.equal(JSON.stringify(reportA), JSON.stringify(reportB));
});
