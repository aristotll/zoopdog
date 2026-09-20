'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  zdNomIsWordChar,
  zdNomBuildIndex,
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
  const termIndex = zdNomBuildIndex({'mới có': '買固', 'mới': '買 / 貝', 'có': '固'});
  const text = 'mới có duyên';
  const words = zdNomRunWords(text, 0);

  const matches = zdNomWordMatchesAt(termIndex, text, words, 0, 'safe');

  assert.deepEqual(matches, [
    {length: 1, value: '買 / 貝'},
    {length: 2, value: '買固'}
  ]);
});

test('zdNomBestSegmentation prefers absorbing the more ambiguous word', () => {
  // Same shape as the real "mới có" / "có duyên" bug: two real phrases
  // overlap on "có". "duyên" alone has 3 raw candidates; "mới" alone has
  // only 1. The DP must leave "mới" bare and use the "có duyên" phrase.
  const termIndex = zdNomBuildIndex({
    'mới có': '買固',
    'mới': '買',
    'có': '固 / 𣎏 / 箇',
    'có duyên': '固緣',
    'duyên': '沿 / 緣 / 椽'
  });
  const text = 'mới có duyên';
  const words = zdNomRunWords(text, 0);

  const segments = zdNomBestSegmentation(termIndex, text, words, 'safe');

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

// -- the caseSensitive option ("Đỗ" the surname vs "đỗ" the word) --------

test('a case-sensitive map overrides only the occurrence with its exact spelling', () => {
  const matcher = zdCreateNomMatcher({'đỗ': '逗 / 度 / 杜'}, {}, {'Đỗ': '杜 / 逗 / 度'});

  const lower = matcher.findNomMatch('đỗ đây', 0);
  assert.deepEqual(lower, {index: 0, length: 2, nom: '逗 / 度 / 杜'});

  const upper = matcher.findNomMatch('Đỗ đây', 0);
  assert.deepEqual(upper, {index: 0, length: 2, nom: '杜 / 逗 / 度'});
});

test('a term with no caseSensitiveMap argument behaves exactly as before', () => {
  const matcher = zdCreateNomMatcher({'đỗ': '逗 / 度'});
  assert.deepEqual(matcher.findNomMatch('Đỗ đây', 0), {index: 0, length: 2, nom: '逗 / 度'});
});

test('a caseSensitiveMap with no entry for the matched text changes nothing', () => {
  const matcher = zdCreateNomMatcher({'đỗ': '逗 / 度'}, {}, {'Khác': '別'});
  assert.deepEqual(matcher.findNomMatch('đỗ đây', 0), {index: 0, length: 2, nom: '逗 / 度'});
});

// Regression: "Đại tá Đỗ Ngọc Minh" kept annotating "Đỗ" as 逗 even after a
// caseSensitive row was added, because the row's `vi` was typed as "đỗ" (the
// lowercase word) instead of "Đỗ" (the surname) -- see the identical guard
// in book-translator's tests/test_reader_nom_order.py, which this mirrors so
// the two annotate engines can never quietly drift apart on this again.
test('a case-sensitive override still applies to a name embedded in a longer phrase', () => {
  const matcher = zdCreateNomMatcher(
    {'đại tá': '大佐', 'đỗ': '逗 / 度', 'ngọc': '玉', 'minh': '明'},
    {},
    {'Đỗ': '杜 / 逗 / 度'}
  );
  const text = 'Đại tá Đỗ Ngọc Minh';

  const first = matcher.findNomMatch(text, 0);
  const second = matcher.findNomMatch(text, first.index + first.length);

  assert.deepEqual(first, {index: 0, length: 'Đại tá'.length, nom: '大佐'});
  assert.deepEqual(second, {index: text.indexOf('Đỗ'), length: 'Đỗ'.length, nom: '杜 / 逗 / 度'});
});

test('a row typed with the wrong case does not silently apply to the capitalized name', () => {
  // The mistake the regression above guards against: authoring the surname's
  // row with the lowercase spelling. It must not affect the capitalized name.
  const matcher = zdCreateNomMatcher(
    {'đỗ': '逗 / 度', 'ngọc': '玉', 'minh': '明'},
    {},
    {'đỗ': '杜 / 逗 / 度'}
  );
  const text = 'Đỗ Ngọc Minh';

  const match = matcher.findNomMatch(text, 0);

  assert.deepEqual(match, {index: 0, length: 'Đỗ'.length, nom: '逗 / 度'});
});

test('zdNomBuildIndex answers term and word-prefix questions', () => {
  const index = zdNomBuildIndex({'hà nội': '河內', 'hà': '河', 'a b c': '三', 'constructor': '構造'});

  assert.equal(index.get('hà nội'), '河內');
  assert.ok(index.has('hà'));
  assert.ok(index.hasPrefix('hà'), 'a proper word-prefix of "hà nội"');
  assert.ok(index.hasPrefix('a'));
  assert.ok(index.hasPrefix('a b'));
  assert.ok(!index.hasPrefix('a b c'), 'a whole entry is a term, not a prefix of a longer one');
  assert.ok(!index.hasPrefix('hà n'), 'prefixes end on a word boundary');
  assert.ok(!index.has('a b'));
});

test('zdNomBuildIndex never mistakes an Object.prototype name for a term', () => {
  const index = zdNomBuildIndex({'xe': '車'});

  for (const name of ['constructor', 'toString', 'hasOwnProperty', '__proto__', 'valueOf']) {
    assert.equal(index.has(name), false, name);
    assert.equal(index.get(name), undefined, name);
  }
});

test('zdNomBuildIndex drops ASCII-only terms, and their prefixes, when annotateAsciiTerms is false', () => {
  const index = zdNomBuildIndex({'xe ôm': '車𠶢', 'the end': 'x'}, false);

  assert.ok(index.has('xe ôm'));
  assert.ok(index.hasPrefix('xe'));
  assert.ok(!index.has('the end'));
  assert.ok(!index.hasPrefix('the'));
});

test('canContinuePast is true only when the text ends inside a longer entry', () => {
  const matcher = zdCreateNomMatcher({'chỉ trích': '指責', 'chỉ': '指', 'a b c': '三'});

  assert.equal(matcher.canContinuePast('lời chỉ'), true, 'ends on the first word of an entry');
  assert.equal(matcher.canContinuePast('lời chỉ '), true, 'a trailing space still continues it');
  assert.equal(matcher.canContinuePast('lời chỉ  '), false, 'two trailing spaces do not');
  assert.equal(matcher.canContinuePast('lời chỉ trích'), false, 'the entry is already complete');
  assert.equal(matcher.canContinuePast('lời chỉ, '), false, 'a comma ends the run');
  assert.equal(matcher.canContinuePast('a b'), true);
  assert.equal(matcher.canContinuePast('CHỈ'), true, 'case-insensitive');
  assert.equal(matcher.canContinuePast('lời chỉ '), true, 'a non-breaking space counts as whitespace');
  assert.equal(matcher.canContinuePast(''), false);
  assert.equal(matcher.canContinuePast('...'), false);
});
