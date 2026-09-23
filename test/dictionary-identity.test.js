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
    {vn: 'đi', en: [{def: 'to walk unsteadily, stumble', pos: 'v'}]}
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].headwords.length, 1);
  assert.deepEqual(groups[0].en, [
    {def: 'to go', pos: 'v'},
    {def: 'to walk unsteadily, stumble', pos: 'v'}
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

test('folds a parenthetical gloss with its unparenthesized equivalent', () => {
  const groups = groupEntries([
    {vn: 'tiếng Anh', en: [{def: 'English (language)', pos: ''}]},
    {vn: 'tiếng Anh', en: [{def: 'English language', pos: ''}]}
  ]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].en, [{def: 'English (language)', pos: ''}]);
});

test('folds a gerund sense into a synonym bundle that already contains its verb form', () => {
  const groups = groupEntries([
    {vn: 'chặn', en: [
      {def: '浱', pos: ''},
      {def: 'blocking', pos: ''},
      {def: 'to block, stop', pos: 'verb'}
    ]}
  ]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].en, [
    {def: '浱', pos: ''},
    {def: 'to block, stop', pos: 'verb'}
  ]);
});

test('folds a gerund sense into a synonym bundle via the silent-e spelling rule', () => {
  const groups = groupEntries([
    {vn: 'bao gồm', en: [
      {def: 'to consist of, include, embrace, have, be made up of, comprise', pos: 'verb'}
    ]},
    {vn: 'bao gồm', en: [{def: 'including', pos: ''}]}
  ]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].en, [
    {def: 'to consist of, include, embrace, have, be made up of, comprise', pos: 'verb'}
  ]);
});

test('folds a plural sense into the bare head word of a parenthesized gloss', () => {
  const groups = groupEntries([
    {vn: 'người dùng', en: [{def: 'user (person)', pos: ''}]},
    {vn: 'người dùng', en: [{def: 'Users', pos: ''}]}
  ]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].en, [{def: 'user (person)', pos: ''}]);
});

test('does not split synonyms on a comma inside a parenthetical note', () => {
  const groups = groupEntries([
    {vn: 'bản dịch', en: [{def: 'translation (of a book, etc.)', pos: ''}]},
    {vn: 'bản dịch', en: [{def: 'Translation', pos: ''}]}
  ]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].en, [{def: 'translation (of a book, etc.)', pos: ''}]);
});

test('folds a past-participle phrase into a synonym bundle via the silent-e spelling rule', () => {
  const groups = groupEntries([
    {vn: 'dựa trên', en: [
      {def: 'to found on, base on', pos: 'verb'},
      {def: 'to rely on', pos: 'verb'}
    ]},
    {vn: 'dựa trên', en: [{def: 'based on', pos: ''}]}
  ]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].en, [
    {def: 'to found on, base on', pos: 'verb'},
    {def: 'to rely on', pos: 'verb'}
  ]);
});

test('does not fold phrases that differ by more than one suffixed word', () => {
  const groups = groupEntries([
    {vn: 'a', en: [{def: 'walk slowly', pos: ''}]},
    {vn: 'a', en: [{def: 'walked quickly', pos: ''}]}
  ]);
  assert.deepEqual(groups[0].en, [
    {def: 'walk slowly', pos: ''},
    {def: 'walked quickly', pos: ''}
  ]);
});

test('folds a full-sentence gloss into its matching bundle despite trailing punctuation', () => {
  const groups = groupEntries([
    {vn: 'diễn ra', en: [{def: 'to take place, occur, happen, unfold', pos: ''}]},
    {vn: 'diễn ra', en: [{def: 'happened.', pos: ''}]}
  ]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].en, [{def: 'to take place, occur, happen, unfold', pos: ''}]);
});

test('folds a contraction sense into its base word', () => {
  const groups = groupEntries([
    {vn: 'chuyện gì', en: [{def: 'what (thing, issue)', pos: ''}]},
    {vn: 'chuyện gì', en: [{def: "what's going on", pos: ''}]}
  ]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].en, [{def: 'what (thing, issue)', pos: ''}]);
});

test('folds a middle-word sense via suffix morphology, not just literal substring match', () => {
  const groups = groupEntries([
    {vn: 'nghiện', en: [{def: 'addict', pos: ''}]},
    {vn: 'nghiện', en: [{def: 'be addicted to', pos: ''}]}
  ]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].en, [{def: 'be addicted to', pos: ''}]);
});

test('folds a candidate into every existing sense it independently matches, not just the first', () => {
  const groups = groupEntries([
    {vn: 'cung cấp', en: [
      {def: '供給 (供给)', pos: ''},
      {def: 'supply (in a market)', pos: ''},
      {def: 'provide', pos: ''}
    ]},
    {vn: 'cung cấp', en: [{def: 'to furnish, supply, provide', pos: 'verb'}]}
  ]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].en, [
    {def: '供給 (供给)', pos: ''},
    {def: 'to furnish, supply, provide', pos: 'verb'}
  ]);
});

test('does not merge two existing senses together just because a bridging candidate matches both', () => {
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

test('folds a lone word into a bundle where it is the repeated prefix of every synonym', () => {
  const groups = groupEntries([
    {vn: 'cho đến khi', en: [
      {def: '朱𦤾崎', pos: ''},
      {def: 'until when, until that time', pos: ''}
    ]},
    {vn: 'cho đến khi', en: [{def: 'until', pos: ''}]}
  ]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].en, [
    {def: '朱𦤾崎', pos: ''},
    {def: 'until when, until that time', pos: ''}
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

test('folds a lone word into a single-token sense it prefixes, even with no other senses', () => {
  const groups = groupEntries([
    {vn: 'không đúng', en: [{def: 'not correct', pos: ''}]},
    {vn: 'không đúng', en: [{def: 'not', pos: ''}]}
  ]);
  assert.deepEqual(groups[0].en, [{def: 'not correct', pos: ''}]);
});

test('folds a lone word into an unrelated-looking phrase that it prefixes -- a single prefix hit is trusted outright', () => {
  const groups = groupEntries([
    {vn: 'đi', en: [{def: 'to go', pos: 'v'}]},
    {vn: 'đi', en: [{def: 'go away (imperative)', pos: 'v'}]}
  ]);
  assert.deepEqual(groups[0].en, [{def: 'go away (imperative)', pos: 'v'}]);
});

test('folds a lone word into a phrase it suffixes once, when the word is not a risky one', () => {
  const groups = groupEntries([
    {vn: 'hầu cận', en: [{def: 'trusted servant', pos: ''}]},
    {vn: 'hầu cận', en: [{def: 'Servant', pos: ''}]}
  ]);
  assert.deepEqual(groups[0].en, [{def: 'trusted servant', pos: ''}]);
});

test('does not fold a phrasal-verb particle suffix from just one corroborating phrase', () => {
  const groups = groupEntries([
    {vn: 'qua', en: [{def: 'after, by, through, over', pos: ''}]},
    {vn: 'qua', en: [{def: 'to pass by, go across, cross over', pos: ''}]}
  ]);
  assert.deepEqual(groups[0].en, [
    {def: 'after, by, through, over', pos: ''},
    {def: 'to pass by, go across, cross over', pos: ''}
  ]);
});

test('does not fold a lone adverb into a phrase it only suffixes once (no repeated corroboration)', () => {
  const groups = groupEntries([
    {vn: 'rõ', en: [
      {def: '𤑟', pos: ''},
      {def: 'clearly, distinctly', pos: ''},
      {def: 'to know well, understand clearly', pos: 'verb'}
    ]}
  ]);
  assert.deepEqual(groups[0].en, [
    {def: '𤑟', pos: ''},
    {def: 'clearly, distinctly', pos: ''},
    {def: 'to know well, understand clearly', pos: 'verb'}
  ]);
});

test('folds a lone adverb into a phrase it suffixes once, when a generic verb precedes it', () => {
  const groups = groupEntries([
    {vn: 'bỗng', en: [{def: 'to act suddenly', pos: ''}]},
    {vn: 'bỗng', en: [{def: 'suddenly', pos: ''}]}
  ]);
  assert.deepEqual(groups[0].en, [{def: 'to act suddenly', pos: ''}]);
});

test('folds a lone adverb into a phrase it suffixes once, when a pronoun precedes it', () => {
  const groups = groupEntries([
    {vn: 'cá nhân tôi', en: [{def: 'personally (I feel, think, etc)', pos: ''}]},
    {vn: 'cá nhân tôi', en: [{def: 'I personally', pos: ''}]}
  ]);
  assert.deepEqual(groups[0].en, [{def: 'personally (I feel, think, etc)', pos: ''}]);
});

test('does not fold a lone adverb suffixing a phrase headed by a real content verb', () => {
  const groups = groupEntries([
    {vn: 'cẩn cáo', en: [{def: 'to inform respectfully', pos: ''}]},
    {vn: 'cẩn cáo', en: [{def: 'respectfully, sincerely yours (letter closing form)', pos: ''}]}
  ]);
  assert.deepEqual(groups[0].en, [
    {def: 'to inform respectfully', pos: ''},
    {def: 'respectfully, sincerely yours (letter closing form)', pos: ''}
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
