'use strict';

const {cleanText} = require('./text');

// The one place these CJK code-point ranges are written down. Every script that recognizes
// Nom/CJK characters imports from here.
const CJK_PATTERN = /[㐀-䶿一-鿿豈-﫿\u{20000}-\u{323AF}]/u;
const CJK_SEQUENCE_PATTERN = /[㐀-䶿一-鿿豈-﫿\u{20000}-\u{323AF}]+/gu;
const CJK_ONLY_PATTERN = /^[㐀-䶿一-鿿豈-﫿\u{20000}-\u{323AF}]+$/u;

const DEFAULT_SEPARATORS = /[|/,;，、]+/u;

// Nom candidate extraction, with the divergences between the historical copies expressed as
// options instead of separate functions:
//   requireCjk           skip text with no CJK at all (the Nom builder's guard)
//   stripParentheticals  drop "(...)" / "（...）" glosses before matching
//   separators           split on these before matching, or null to skip splitting
// The defaults reproduce scripts/build-nom-userscript.js, the strictest existing caller.
function extractNomCandidates(value, options = {}) {
  const {
    requireCjk = true,
    stripParentheticals = true,
    separators = DEFAULT_SEPARATORS,
    cleanOptions = {}
  } = options;

  const text = cleanText(value, cleanOptions);
  if (requireCjk && !CJK_PATTERN.test(text)) {
    return [];
  }

  const stripped = stripParentheticals
    ? text.replace(/[（(][^）)]*[）)]/gu, '')
    : text;

  if (!separators) {
    return stripped.match(CJK_SEQUENCE_PATTERN) || [];
  }

  return stripped
    .split(separators)
    .flatMap((piece) => piece.match(CJK_SEQUENCE_PATTERN) || []);
}

// A term is embedded in NOM_MAP only if it is long enough or non-ASCII; short ASCII words
// would otherwise annotate ordinary English prose.
function isEmbeddableTerm(term) {
  return Boolean(term) && (
    Array.from(term.replace(/\s/g, '')).length >= 2 ||
    /[^\x00-\x7F]/.test(term)
  );
}

module.exports = {
  CJK_PATTERN,
  CJK_SEQUENCE_PATTERN,
  CJK_ONLY_PATTERN,
  DEFAULT_SEPARATORS,
  extractNomCandidates,
  isEmbeddableTerm
};
