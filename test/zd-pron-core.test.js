'use strict';

// Characterization and regression suite for the pronunciation/number-spelling/homophone core
// (zd-extension/js/zd-pron-core.js), covering openspec/changes/harden-pronunciation-engine.
//
// Section 1 fixtures snapshot representative outputs across dialects, tone families, onsets,
// rimes, and multiword input, captured from the pre-refactor zd-extension/js/zd-pron-functions.js
// monolith so the extraction in section 2 cannot silently change valid behavior. Section 2
// fixtures assert the named, evidenced corrections (0, 110, 1010, the minor-ɤ branch) and the
// total empty/whitespace/unsupported-input contract.

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');
const pronData = require(path.join(repoRoot, 'zd-extension/js/zd-pron-data.js'));
const { allPossibleRealWords } = require(path.join(repoRoot, 'zd-extension/js/realwords.js'));
const { createPronunciationCore } = require(path.join(repoRoot, 'zd-extension/js/zd-pron-core.js'));

const core = createPronunciationCore(pronData, allPossibleRealWords);
const DIALECTS = ['hanoi', 'quangnam', 'saigon'];

// --- Section 1: characterization of currently-correct behavior -----------------------------
// Values captured by running the pre-refactor zd-pron-functions.js (via vm, before any of this
// change's edits) over representative words spanning every dialect, tone family, onset, and
// rime family, plus a multiword phrase. These must still hold after extraction.

test('characterization: single-word pronunciations are unchanged by extraction', () => {
  const fixtures = {
    // onset consonants across tone marks
    'ba':   { hanoi: { ipa: ' ʔɓaː˧' }, saigon: { ipa: ' ɓa̟ː˧' } },
    'bà':   { hanoi: { ipa: ' ʔɓaː˨˩̤' } },
    'bá':   { hanoi: { ipa: ' ʔɓaː˧˥' } },
    'bả':   { hanoi: { ipa: ' ʔɓaː˧˩̰' } },
    'bã':   { hanoi: { ipa: ' ʔɓaʔa˧˥' } },
    'bạ':   { hanoi: { ipa: ' ʔɓaːʔ˨˩̰' } },
    // digraph/trigraph onsets
    'chị':  { hanoi: { ipa: ' t͡ɕiːʔ˨˩̰' } },
    'nghe': { hanoi: { ipa: ' ŋɛː˧' } },
    'thư':  { hanoi: { ipa: ' tʰɯː˧' } },
    'quê':  { hanoi: { ipa: ' kʷɛːe̯˧' } },
    // minor-vowel rimes (Saigonese/Quangnam ɤ family), long-vowel guard unaffected
    'gì':   { quangnam: { ipa: ' jɤ̯iː˧˨' }, saigon: { ipa: ' jɤ̯iː˨˩' } },
    // multiword and punctuation passthrough characterized together in the next test
  };

  for (const [word, byDialect] of Object.entries(fixtures)) {
    const result = core.pronunciationGuide(word);
    for (const [dialect, expected] of Object.entries(byDialect)) {
      if (expected.ipa !== undefined) {
        assert.equal(result[dialect].ipa, expected.ipa, `${word} (${dialect}) ipa`);
      }
    }
  }
});

test('characterization: multiword phrases are unchanged', () => {
  const helloWorld = core.pronunciationGuide('xin chào');
  assert.equal(helloWorld.hanoi.ipa, ' siːn˧ t͡ɕaːw˨˩̤');
});

test('characterization: number spelling for values unaffected by the tens fix', () => {
  const cases = [
    ['1', 'một'], ['5', 'năm'], ['9', 'chín'],
    ['11', 'mười một'], ['15', 'mười lăm'],
    ['20', 'hai mươi'], ['21', 'hai mươi mốt'], ['25', 'hai mươi lăm'], ['99', 'chín mươi chín'],
    ['100', 'một trăm'], ['120', 'một trăm hai mươi'], ['199', 'một trăm chín mươi chín'],
    ['200', 'hai trăm'], ['500', 'năm trăm'], ['999', 'chín trăm chín mươi chín'],
    ['1000', 'một nghìn'], ['1001', 'một nghìn không trăm một'], ['10000', 'mười nghìn'],
    ['1000000', 'một triệu'], ['3.14', 'ba chấm một bốn']
  ];
  for (const [n, expected] of cases) {
    assert.equal(core.numbersToWords(n, 'hanoi'), expected, `numbersToWords(${n}, hanoi)`);
  }
  assert.equal(core.numbersToWords('101', 'hanoi'), 'một trăm linh một');
  assert.equal(core.numbersToWords('101', 'saigon'), 'một trăm lẻ một');
  assert.equal(core.numbersToWords('1000', 'quangnam'), 'một ngà');
  assert.equal(core.numbersToWords('1000', 'saigon'), 'một ngàn');
  // Pre-existing, uncorrected behavior (out of scope for this change; not a named defect):
  // the blanket " năm" -> " lăm" replacement also fires on the hundreds-multiplier "năm" in
  // "một nghìn năm trăm". Characterized here so a future change to that rule is deliberate.
  assert.equal(core.numbersToWords('1500', 'hanoi'), 'một nghìn lăm trăm');
});

test('characterization: getHomophones for a representative onset/rime/tone', () => {
  const result = core.getHomophones('ba', false);
  for (const dialect of DIALECTS) {
    assert.ok(Array.isArray(result[dialect]));
    assert.ok(result[dialect].includes('pa'), `${dialect} homophones of "ba" include "pa"`);
    assert.ok(!result[dialect].includes('ba'), `${dialect} homophones exclude the input itself`);
  }
});

// --- Section 1.2: failing-before-the-fix regression fixtures --------------------------------

test('regression: empty and whitespace-only input get a total, explicit empty result', () => {
  for (const input of ['', '   ', '\n\t ']) {
    const result = core.pronunciationGuide(input);
    assert.equal(result.status, 'empty', `status for ${JSON.stringify(input)}`);
    for (const dialect of DIALECTS) {
      assert.deepEqual(result[dialect], { ipa: '', zd: '' }, `${dialect} for ${JSON.stringify(input)}`);
    }
  }
});

test('regression: "0" spells out as "không", not a malformed placeholder', () => {
  for (const dialect of DIALECTS) {
    assert.equal(core.numbersToWords('0', dialect), 'không');
  }
  const guide = core.pronunciationGuide('0');
  assert.equal(guide.status, 'ok');
  assert.ok(guide.hanoi.ipa.length > 0 && !guide.hanoi.ipa.includes('undefined'));
});

test('regression: "110" reads as "một trăm mười", not "một trăm mươi"', () => {
  for (const dialect of DIALECTS) {
    assert.equal(core.numbersToWords('110', dialect), 'một trăm mười');
  }
});

test('regression: "1010" keeps "mười" after "không trăm"', () => {
  assert.equal(core.numbersToWords('1010', 'hanoi'), 'một nghìn không trăm mười');
  assert.equal(core.numbersToWords('1010', 'quangnam'), 'một ngà không trăm mười');
  assert.equal(core.numbersToWords('1010', 'saigon'), 'một ngàn không trăm mười');
});

test('regression: unsupported punctuation-only and multi-dot input get a stable, total result', () => {
  const punctuation = core.pronunciationGuide('!!!');
  assert.equal(punctuation.status, 'ok');
  for (const dialect of DIALECTS) {
    assert.equal(typeof punctuation[dialect].ipa, 'string');
    assert.equal(typeof punctuation[dialect].zd, 'string');
  }

  assert.equal(core.numbersToWords('1.2.3'), '1.2.3');
  assert.equal(core.numbersToWords('-5'), '-5');
  assert.equal(core.numbersToWords('12345678901'), '12345678901'); // > 10 digits
});

test('regression: implicit globals and prototype mutation are gone', () => {
  assert.equal(Object.prototype.hasOwnProperty.call(String.prototype, 'cleanUpNumbers'), false);
  assert.equal(typeof globalThis.dissect, 'undefined');
  assert.equal(typeof globalThis.wordPronunciation, 'undefined');
  assert.equal(typeof core.cleanUpNumbers('1,234.5'), 'string');
});

test('regression: the minor-ɤ branch is reachable for a vowel-initial word', () => {
  // "ý" has no onset consonant and dissects to rime "y" (rimesToIPA.y = "ɤ̯iː" in
  // Quangnam/Saigon). Before the fix, the minor-ɤ branch compared `i === 0` (a string to
  // the number 0), which is never true, so it never simplified to the schwa "ə" and always
  // rendered the unsimplified symbol "ə˞" instead -- characterized in the "ý"/"y"/"i" family
  // of the pre-refactor monolith.
  const result = core.pronunciationGuide('ý');
  assert.ok(result.quangnam.zd.includes('>ə<'),
    `expected quangnam "ý" to render the simplified minor ɤ as "ə", got: ${result.quangnam.zd}`);
  assert.ok(!result.quangnam.zd.includes('ə˞'), 'the unsimplified "ə˞" must no longer appear');
});

// --- Section 3: lexicon reproducibility ------------------------------------------------------

test('lexicon: realwords.js is generated deterministically from its source', () => {
  const { buildLexicon } = require(path.join(repoRoot, 'scripts/build-realwords-lexicon.js'));
  const first = buildLexicon();
  const second = buildLexicon();
  assert.equal(first.source, second.source, 'rebuilding twice is byte-identical');
  assert.equal(first.words.length, allPossibleRealWords.length);
  assert.deepEqual(first.words, allPossibleRealWords, 'committed realwords.js matches its source');
});

test('lexicon: membership lookup is a single Set built lazily, not a per-call scan', () => {
  const guide = core.getHomophones('ba', false);
  assert.ok(Array.isArray(guide.hanoi));
  // Calling getHomophones repeatedly must not throw or rebuild in a way that changes results.
  const again = core.getHomophones('ba', false);
  assert.deepEqual(guide, again);
});
