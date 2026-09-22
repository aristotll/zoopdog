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

test('folds an infinitive gloss with a bare hand-maintained one despite differing pos tags', () => {
  const groups = groupEntries([
    {vn: 'mỉm cười', en: [{def: 'to smile', pos: 'verb'}]},
    {vn: 'mỉm cười', en: [{def: 'smile', pos: ''}]}
  ]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].en, [{def: 'to smile', pos: 'verb'}]);
});

test('does not fold senses that carry two distinct, non-empty pos tags', () => {
  const groups = groupEntries([
    {vn: 'smile', en: [{def: 'smile', pos: 'noun'}, {def: 'to smile', pos: 'verb'}]}
  ]);
  assert.deepEqual(groups[0].en, [
    {def: 'smile', pos: 'noun'},
    {def: 'to smile', pos: 'verb'}
  ]);
});

test('folds a shorter phrase into a synonym bundle that already contains it as a prefix', () => {
  const groups = groupEntries([
    {vn: 'về phía', en: [{def: 'on the side of, on the part of', pos: ''}]},
    {vn: 'về phía', en: [{def: 'on the side', pos: ''}]}
  ]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].en, [{def: 'on the side of, on the part of', pos: ''}]);
});

test('folds an adverb sense into a synonym bundle that already contains its adjective form', () => {
  const groups = groupEntries([
    {vn: 'gần đây', en: [{def: 'last, previous, not far from here, recently', pos: ''}]},
    {vn: 'gần đây', en: [{def: 'Recent', pos: ''}]}
  ]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].en, [{def: 'last, previous, not far from here, recently', pos: ''}]);
});

test('folds a plural sense into a comma-separated synonym bundle that already contains it', () => {
  const groups = groupEntries([
    {vn: 'người khác', en: [{def: 'other, different person, people', pos: ''}]},
    {vn: 'người khác', en: [{def: 'others', pos: ''}]}
  ]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].en, [{def: 'other, different person, people', pos: ''}]);
});

test('keeps a multi-synonym bundle intact instead of collapsing it to one longer redundant sense', () => {
  const groups = groupEntries([
    {vn: 'e', en: [{def: 'to fear, be afraid, be shy', pos: 'verb'}]},
    {vn: 'e', en: [
      {def: 'to fear', pos: ''},
      {def: 'be afraid', pos: ''},
      {def: "be shy (vnedict2.json's own recorded rendering)", pos: ''}
    ]}
  ]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].en, [{def: 'to fear, be afraid, be shy', pos: 'verb'}]);
});

test('folds a lone generic word into a longer sense once the group has enough other senses', () => {
  const groups = groupEntries([
    {vn: 'không phải', en: [
      {def: '空沛', pos: ''},
      {def: 'there is not, there are not', pos: ''},
      {def: 'not correct', pos: ''}
    ]},
    {vn: 'không phải', en: [{def: 'not', pos: ''}]}
  ]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].en, [
    {def: '空沛', pos: ''},
    {def: 'there is not, there are not', pos: ''},
    {def: 'not correct', pos: ''}
  ]);
});

test('does not fold a word at the end of an unrelated phrase even with enough other senses', () => {
  const groups = groupEntries([
    {vn: 'rõ', en: [
      {def: '𤑟', pos: ''},
      {def: '𠓑', pos: ''},
      {def: '𤍊', pos: ''},
      {def: 'clear, distinct', pos: ''},
      {def: 'clearly, distinctly', pos: ''},
      {def: 'to know well, understand clearly', pos: 'verb'}
    ]}
  ]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].en, [
    {def: '𤑟', pos: ''},
    {def: '𠓑', pos: ''},
    {def: '𤍊', pos: ''},
    {def: 'clearly, distinctly', pos: ''},
    {def: 'to know well, understand clearly', pos: 'verb'}
  ]);
});

test('does not fold a lone generic word into a longer sense when the group has too few other senses', () => {
  const groups = groupEntries([
    {vn: 'không đúng', en: [{def: 'not correct', pos: ''}]},
    {vn: 'không đúng', en: [{def: 'not', pos: ''}]}
  ]);
  assert.deepEqual(groups[0].en, [
    {def: 'not correct', pos: ''},
    {def: 'not', pos: ''}
  ]);
});

test('does not fold a short word into an unrelated longer phrase that starts with it', () => {
  const groups = groupEntries([
    {vn: 'đi', en: [{def: 'to go', pos: 'v'}]},
    {vn: 'đi', en: [{def: 'go away (imperative)', pos: 'v'}]}
  ]);
  assert.deepEqual(groups[0].en, [
    {def: 'to go', pos: 'v'},
    {def: 'go away (imperative)', pos: 'v'}
  ]);
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
