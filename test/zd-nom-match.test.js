'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  zdNomIsWordChar,
  zdNomBuildTrie,
  zdCreateNomMatcher,
  zdNomRunWords,
  zdNomWordMatchesAt,
  zdNomBestSegmentation
} = require('../zd-extension/js/zd-nom-match');

test('every accented Vietnamese letter the dictionary can key on counts as a word character', () => {
  // A letter missing here is invisible to findNomMatch: it can never start a match, no matter
  // what the dictionary says about it. This is exactly how "y" (this test as a regression
  // guard reads it as a plain string, not "ý") went unannotated everywhere -- a single
  // precomposed codepoint was dropped from the word-character class while every other
  // accented form of the same letter (ỳ, ỵ, ỷ, ỹ) stayed present.
  const accentedLowercase = 'áàảãạăắằẳẵặâấầẩẫậđéèẻẽẹêếềểễệíìỉĩịóòỏõọôốồổỗộơớờởỡợúùủũụưứừửữựýỳỷỹỵ';
  for (const ch of accentedLowercase) {
    assert.ok(zdNomIsWordChar(ch), `expected "${ch}" (U+${ch.codePointAt(0).toString(16)}) to be a word character`);
  }
});

test('matches the longer of two dictionary entries where one starts with the other', () => {
  const matcher = zdCreateNomMatcher({'ý': '意 / 薏', 'ý tưởng': '意想', 'tưởng': '想'});
  const text = 'những ý tưởng điên rồ';

  const match = matcher.findNomMatch(text, text.indexOf('ý'));

  assert.deepEqual(match, {index: text.indexOf('ý'), length: 'ý tưởng'.length, nom: '意想'});
});

test('findNomMatch never skips a one-character dictionary term at a word boundary', () => {
  // Reproduces the annotation gap directly: without the compound entry, a standalone
  // one-character term must still be found by starting a match exactly on it.
  const matcher = zdCreateNomMatcher({'ý': '意 / 薏', 'tưởng': '想'});
  const text = 'những ý tưởng';

  const match = matcher.findNomMatch(text, text.indexOf('ý'));

  assert.deepEqual(match, {index: text.indexOf('ý'), length: 1, nom: '意 / 薏'});
});

test('findNomMatch resumes scanning past a matched span and finds the next word', () => {
  const matcher = zdCreateNomMatcher({'của': '𧵑', 'bạn': '伴'});
  const text = 'của bạn';

  const first = matcher.findNomMatch(text, 0);
  const second = matcher.findNomMatch(text, first.index + first.length);

  assert.deepEqual(first, {index: 0, length: 3, nom: '𧵑'});
  assert.deepEqual(second, {index: 4, length: 3, nom: '伴'});
});

test('annotateAsciiTerms: false drops every ASCII-only term, even a long one', () => {
  const matcher = zdCreateNomMatcher({hello: '好'}, {annotateAsciiTerms: false});
  assert.equal(matcher.findNomMatch('hello', 0), null);
});

test('annotateAsciiTerms: true annotates a short ASCII term with no Vietnamese context', () => {
  const matcher = zdCreateNomMatcher({no: '無'}, {annotateAsciiTerms: true});
  assert.deepEqual(matcher.findNomMatch('no', 0), {index: 0, length: 2, nom: '無'});
});

test('the default "safe" mode skips a blocklisted short ASCII word with no Vietnamese nearby', () => {
  const matcher = zdCreateNomMatcher({no: '無'});
  assert.equal(matcher.findNomMatch('no thanks', 0), null);
});

test('the default "safe" mode annotates a short ASCII word next to Vietnamese diacritics', () => {
  const matcher = zdCreateNomMatcher({xe: '車'});
  assert.deepEqual(matcher.findNomMatch('chạy xe', 5), {index: 5, length: 2, nom: '車'});
});

test('zdNomRunWords stops a run at a comma, not at extra spaces', () => {
  const text = 'một, hai   ba';
  const words = zdNomRunWords(text, 0);
  assert.deepEqual(words.map(function(w) { return text.substring(w.start, w.end); }), ['một']);

  const secondRun = zdNomRunWords(text, text.indexOf('hai'));
  assert.deepEqual(secondRun.map(function(w) { return text.substring(w.start, w.end); }), ['hai', 'ba']);
});

test('zdNomWordMatchesAt returns every match length at a position, shortest first', () => {
  const trie = zdNomBuildTrie({'mới có': '買固', 'mới': '買 / 貝', 'có': '固'});
  const text = 'mới có duyên';
  const words = zdNomRunWords(text, 0);

  const matches = zdNomWordMatchesAt(trie, text, words, 0, 'safe');

  assert.deepEqual(matches, [
    {length: 1, value: '買 / 貝'},
    {length: 2, value: '買固'}
  ]);
});

test('zdNomBestSegmentation prefers absorbing the more ambiguous word', () => {
  // Same shape as the real "mới có" / "có duyên" bug: two real phrases
  // overlap on "có". "duyên" alone has 3 raw candidates; "mới" alone has
  // only 1. The DP must leave "mới" bare and use the "có duyên" phrase.
  const trie = zdNomBuildTrie({
    'mới có': '買固',
    'mới': '買',
    'có': '固 / 𣎏 / 箇',
    'có duyên': '固緣',
    'duyên': '沿 / 緣 / 椽'
  });
  const text = 'mới có duyên';
  const words = zdNomRunWords(text, 0);

  const segments = zdNomBestSegmentation(trie, text, words, 'safe');

  assert.deepEqual(segments, [
    {index: 0, length: 1, value: '買'},
    {index: 1, length: 2, value: '固緣'}
  ]);
});

test('the nom-ruby matcher resolves mới có duyên via the phrase that covers duyên', () => {
  const matcher = zdCreateNomMatcher({
    'mới có': '買固',
    'mới': '買',
    'có': '固 / 𣎏 / 箇',
    'có duyên': '固緣',
    'duyên': '沿 / 緣 / 椽'
  });
  const text = 'mới có duyên';

  const first = matcher.findNomMatch(text, 0);
  const second = matcher.findNomMatch(text, first.index + first.length);

  assert.deepEqual(first, {index: 0, length: 3, nom: '買'});
  assert.deepEqual(second, {index: 4, length: 8, nom: '固緣'});
});
