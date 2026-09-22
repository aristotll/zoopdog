'use strict';

// Contracts for the load-cost and hot-path work in openspec/changes/speed-up-userscripts.

const assert = require('node:assert/strict');
const test = require('node:test');

const {jsonParseLiteral, extractAssignedJson} = require('../scripts/lib/userscript');

const SAMPLE = {
  'kiểm tra': '檢查 / 檢查',
  'quote"and\\slash': 'x',
  'constructor': 'y',
  ' line': 'z'
};

test('jsonParseLiteral is valid JS that evaluates back to the same object', () => {
  const literal = jsonParseLiteral(SAMPLE);
  assert.match(literal, /^JSON\.parse\("/);
  assert.deepEqual(new Function(`return ${literal};`)(), SAMPLE);
});

test('extractAssignedJson reads both the JSON.parse form and a plain object literal', () => {
  assert.deepEqual(
    extractAssignedJson(`var NOM_MAP = ${jsonParseLiteral(SAMPLE)};\nvar next = 1;`, 'NOM_MAP'),
    SAMPLE
  );
  assert.deepEqual(
    extractAssignedJson(`var NOM_MAP = ${JSON.stringify(SAMPLE)};\nvar next = 1;`, 'NOM_MAP'),
    SAMPLE
  );
});

const {
  ZD_NOM_WORD_CHAR_PATTERN,
  ZD_NOM_WHITESPACE_PATTERN,
  zdNomIsWordCode,
  zdNomIsWhitespaceCode,
  zdCreateNomMatcher
} = require('../zd-extension/js/zd-nom-match');

test('the character-class lookup tables agree with the regexes for every code unit', () => {
  for (let code = 0; code <= 0xffff; code++) {
    const ch = String.fromCharCode(code);
    assert.equal(zdNomIsWordCode(code), ZD_NOM_WORD_CHAR_PATTERN.test(ch), `word class of U+${code.toString(16)}`);
    assert.equal(zdNomIsWhitespaceCode(code), ZD_NOM_WHITESPACE_PATTERN.test(ch), `whitespace class of U+${code.toString(16)}`);
  }
  assert.equal(zdNomIsWordCode(NaN), false);
  assert.equal(zdNomIsWhitespaceCode(NaN), false);
});

// Best-of-many wall-clock timing is inherently noisy under system load (a scheduler hiccup or
// GC pause can stretch any single attempt); more attempts make it far less likely that every
// attempt at one size gets unlucky while every attempt at the other size gets lucky, which is
// what previously made this test flaky with only 3 attempts.
function scanTime(matcher, words) {
  const text = Array.from({length: words}, (_, i) => `zz${i % 97}`).join(' ');
  let best = Infinity;
  for (let attempt = 0; attempt < 9; attempt++) {
    const start = process.hrtime.bigint();
    let offset = 0;
    let match;
    while ((match = matcher.findNomMatch(text, offset))) {
      offset = match.index + match.length;
    }
    best = Math.min(best, Number(process.hrtime.bigint() - start));
  }
  return best;
}

test('scanning one long run of words costs linear, not quadratic, time', () => {
  const matcher = zdCreateNomMatcher({'zz1 zz2': '二', 'nhà': '茹'}, {annotateAsciiTerms: true});
  scanTime(matcher, 500); // warm up
  const small = scanTime(matcher, 1500);
  const large = scanTime(matcher, 6000);
  // 4x the words: ~4x the time when linear, ~16x when the run is re-segmented per word start.
  // The threshold sits well below the quadratic case but leaves headroom above the ~2-4x
  // typically observed, so a real regression still trips it without noise-driven flakes.
  assert.ok(large / small < 12, `6000 words took ${(large / small).toFixed(1)}x the time of 1500`);
});
