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

test('folds a plural/case variant of the same sense into the longer form', () => {
  const groups = groupEntries([
    {vn: 'tin đồn', en: [{def: 'rumor', pos: ''}]},
    {vn: 'tin đồn', en: [{def: 'Rumors', pos: ''}]}
  ]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].en, [{def: 'Rumors', pos: ''}]);
});

test('folds a plural/case variant regardless of which one appears first', () => {
  const groups = groupEntries([
    {vn: 'tin đồn', en: [{def: 'Rumors', pos: ''}]},
    {vn: 'tin đồn', en: [{def: 'rumor', pos: ''}]}
  ]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].en, [{def: 'Rumors', pos: ''}]);
});

test('folds a plural sense into a comma-separated synonym bundle that already contains it', () => {
  const groups = groupEntries([
    {vn: 'người khác', en: [{def: 'other, different person, people', pos: ''}]},
    {vn: 'người khác', en: [{def: 'others', pos: ''}]}
  ]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].en, [{def: 'other, different person, people', pos: ''}]);
});

test('does not fold unrelated definitions that merely share characters', () => {
  const groups = groupEntries([
    {vn: 'Cu Ba', en: [{def: 'Cuba', pos: ''}, {def: 'ba', pos: ''}]}
  ]);
  assert.deepEqual(groups[0].en, [
    {def: 'Cuba', pos: ''},
    {def: 'ba', pos: ''}
  ]);
});

test('does not fold a Chu Nom rendering into a longer gloss that happens to contain it', () => {
  const groups = groupEntries([
    {vn: 'tu luyện', en: [{def: '修練 (修练)', pos: ''}]},
    {vn: 'tu luyện', en: [{def: '修練', pos: ''}]}
  ]);
  assert.deepEqual(groups[0].en, [
    {def: '修練 (修练)', pos: ''},
    {def: '修練', pos: ''}
  ]);
});

test('does not fold variants across different parts of speech', () => {
  const groups = groupEntries([
    {vn: 'rumors', en: [{def: 'rumor', pos: 'n'}, {def: 'Rumors', pos: 'v'}]}
  ]);
  assert.deepEqual(groups[0].en, [
    {def: 'rumor', pos: 'n'},
    {def: 'Rumors', pos: 'v'}
  ]);
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
