'use strict';

// Exercises scripts/nom-inspect.js against the real, current repository dictionaries -- the
// same buildFullNomMap/buildFullDictionary pipelines the userscript builders run -- so a
// passing test here is proof the *actual* generated userscripts would behave this way too,
// not just a hand-picked fixture map.

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  annotate,
  popupLookup,
  formatAnnotate,
  formatPopup,
  main
} = require('../scripts/nom-inspect');

test('annotate matches a standalone one-character term at a word boundary', () => {
  // Regression guard for the bug this tool was built to catch without grepping dictionary
  // sources by hand: "ý" (idea/thought) sitting on its own between two other words.
  const result = annotate('những ý tưởng điên rồ');
  const span = result.spans.find((candidate) => candidate.text === 'ý' || candidate.text === 'ý tưởng');

  assert.ok(span, `expected a span covering "ý", got: ${JSON.stringify(result.spans)}`);
});

test('annotate prefers the longer of two overlapping dictionary entries', () => {
  const result = annotate('ý tưởng');
  assert.deepEqual(result.spans.map((span) => span.text), ['ý tưởng']);
});

test('annotate returns spans left to right, each carrying every known candidate in order', () => {
  const result = annotate('của bạn');
  assert.ok(result.spans.length >= 2);
  for (const span of result.spans) {
    assert.equal(span.nom, span.candidates.join(' / '));
    assert.ok(span.candidates.length >= 1);
  }
});

test('annotate finds nothing in text with no dictionary term', () => {
  const result = annotate('xyzxyzxyz123');
  assert.deepEqual(result.spans, []);
});

test('popupLookup finds the repository entry for a common headword', () => {
  const entry = popupLookup('ý');
  assert.ok(entry, 'expected a popup entry for "ý"');
  assert.equal(entry.key, 'ý');
  assert.ok(entry.definitions.length >= 1);
});

test('popupLookup normalizes case and whitespace the same way the popup dictionary does', () => {
  const spaced = popupLookup('  Ý  ');
  const plain = popupLookup('ý');
  assert.deepEqual(spaced, plain);
});

test('popupLookup returns null for a term with no dictionary entry', () => {
  assert.equal(popupLookup('khong-mot-tu-nao-nhu-the-nay-ton-tai'), null);
});

test('formatAnnotate reports "no matches" for text with nothing to annotate', () => {
  const output = formatAnnotate({text: 'xyzxyz', spans: []});
  assert.match(output, /no Chu Nom matches/);
});

test('formatAnnotate lists the ruby candidate first and the rest as alternatives', () => {
  const output = formatAnnotate({
    text: 'bạn',
    spans: [{index: 0, length: 3, text: 'bạn', nom: '伴 / 拌', candidates: ['伴', '拌']}]
  });
  assert.match(output, /"bạn" -> 伴 \(other candidates: 拌\)/);
});

test('formatPopup lists definitions in display order', () => {
  const output = formatPopup('ý', {
    key: 'ý',
    vn: 'ý',
    definitions: [{def: '意 / 薏', pos: ''}, {def: 'idea', pos: 'n'}]
  });
  assert.match(output, /1\. 意 \/ 薏/);
  assert.match(output, /2\. idea \[n\]/);
});

test('formatPopup reports a missing entry by its normalized key', () => {
  const output = formatPopup('Không Có', null);
  assert.match(output, /No popup dictionary entry for "Không Có" \(normalized key: "không có"\)/);
});

test('the CLI prints usage and exits 1 with no arguments', () => {
  let stderr = '';
  const exitCode = main([], {stdout: {write: () => {}}, stderr: {write: (v) => { stderr += v; }}});
  assert.equal(exitCode, 1);
  assert.match(stderr, /Usage:/);
});

test('the CLI annotate command prints spans and exits 0', () => {
  let stdout = '';
  const exitCode = main(['annotate', 'của bạn'], {
    stdout: {write: (v) => { stdout += v; }},
    stderr: {write: () => {}}
  });
  assert.equal(exitCode, 0);
  assert.match(stdout, /Text: của bạn/);
});

test('the CLI popup command prints an entry and exits 0', () => {
  let stdout = '';
  const exitCode = main(['popup', 'ý'], {
    stdout: {write: (v) => { stdout += v; }},
    stderr: {write: () => {}}
  });
  assert.equal(exitCode, 0);
  assert.match(stdout, /Key: ý/);
});
