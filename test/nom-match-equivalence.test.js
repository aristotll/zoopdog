'use strict';

// Differential test: the live engine (zd-extension/js/zd-nom-match.js) must produce exactly the
// matches and canContinuePast answers of the frozen character-trie reference, for arbitrary
// text over the real dictionary and over a small dictionary that exercises the edge cases.

const assert = require('node:assert/strict');
const test = require('node:test');

const live = require('../zd-extension/js/zd-nom-match');
const reference = require('./support/reference-nom-match');
const {buildFullNomMap} = require('../scripts/build-nom-userscript');

function prng(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function pick(random, list) {
  return list[Math.floor(random() * list.length)];
}

function makeText(random, terms, vocabulary) {
  const separators = [' ', ' ', ' ', ' ', '  ', ', ', '. ', '\n', ' ', ' - ', '; '];
  const pieces = [];
  const length = 1 + Math.floor(random() * 40);
  for (let i = 0; i < length; i++) {
    let piece = random() < 0.45 ? pick(random, terms) : pick(random, vocabulary);
    const roll = random();
    if (roll < 0.1) {
      piece = piece.toUpperCase();
    } else if (roll < 0.2) {
      piece = piece.charAt(0).toUpperCase() + piece.slice(1);
    } else if (roll < 0.25) {
      piece = piece.normalize('NFD');
    }
    pieces.push(piece, pick(random, separators));
  }
  return pieces.join('');
}

function matchStream(matcher, text) {
  const out = [];
  let offset = 0;
  let match;
  while ((match = matcher.findNomMatch(text, offset))) {
    out.push(match);
    offset = match.index + match.length;
  }
  return out;
}

function assertEquivalent(map, options, caseSensitiveMap, texts, label) {
  const expected = reference.zdCreateNomMatcher(map, options, caseSensitiveMap);
  const actual = live.zdCreateNomMatcher(map, options, caseSensitiveMap);
  for (const text of texts) {
    assert.deepEqual(matchStream(actual, text), matchStream(expected, text), `${label}: matches for ${JSON.stringify(text)}`);
    // Every prefix that ends at or just after a word boundary, plus a few arbitrary cuts.
    const cuts = new Set([text.length]);
    for (let i = 0; i < text.length; i++) {
      if (/[\s,.;-]/.test(text.charAt(i)) || i % 7 === 0) {
        cuts.add(i);
        cuts.add(i + 1);
      }
    }
    for (const cut of cuts) {
      const head = text.slice(0, cut);
      assert.equal(actual.canContinuePast(head), expected.canContinuePast(head),
        `${label}: canContinuePast for ${JSON.stringify(head)}`);
    }
  }
}

test('live engine equals the trie reference on a dictionary built for the edge cases', () => {
  const map = {
    'ý': '意 / 薏',
    'ý tưởng': '意想',
    'tưởng': '想',
    'có duyên': '有緣',
    'duyên': '緣 / 沿 / 延',
    'mới': '𣈜',
    'constructor': '構造',
    'toString': 'x',
    'hasOwnProperty': 'x',
    '__proto__': 'x',
    'xe': '車',
    'an': 'x',
    'xe ôm': '車𠶢',
    'hà nội': '河內',
    'hà': '河',
    'a b c d e': '五',
    'a b': '二'
  };
  const random = prng(7);
  const terms = Object.keys(map);
  const vocabulary = ['nhà', 'người', 'Đỗ', 'constructor', 'valueOf', 'the', 'ok', 'xe', 'an', 'a', 'b', 'c', '123', 'x-y', 'ΟΔΥΣΣΕΥΣ', 'İstanbul', '𐐀𐐁'];
  const texts = [];
  for (let i = 0; i < 400; i++) {
    texts.push(makeText(random, terms, vocabulary));
  }
  for (const ascii of ['safe', true, false]) {
    assertEquivalent(map, {annotateAsciiTerms: ascii}, null, texts, `small/${ascii}`);
  }
  assertEquivalent(map, {annotateAsciiTerms: 'safe'}, {'Duyên': '緣'}, texts, 'small/case-sensitive');
});

test('live engine equals the trie reference on the real dictionary', () => {
  const {nomMap, caseSensitiveNomMap} = buildFullNomMap();
  const terms = Object.keys(nomMap);
  const random = prng(20260920);
  const vocabulary = ['nhà', 'người', 'và', 'của', 'là', 'không', 'the', 'and', 'xin', 'chào', 'Việt', 'Nam', 'đỗ', 'Đỗ'];
  const texts = [];
  for (let i = 0; i < 300; i++) {
    texts.push(makeText(random, terms, vocabulary));
  }
  assertEquivalent(nomMap, {annotateAsciiTerms: 'safe'}, caseSensitiveNomMap, texts, 'real');
});
