'use strict';

// The single normalization implementation for every script in this repository.
// `stripNul` exists because the MDX extractor reads binary-ish dictionary payloads that can
// carry embedded NUL characters; it is an option rather than a forked copy of cleanText.
function cleanText(value, options = {}) {
  let text = String(value || '').replace(/^\uFEFF/, '');
  if (options.stripNul) {
    text = text.replace(/\u0000/g, '');
  }
  return text.normalize('NFC').trim();
}

// Plain `toLowerCase()`, not `toLocaleLowerCase('vi-VN')`: Vietnamese has no locale-specific case mapping (only Turkish/Azeri/Lithuanian
// do), so the keys are byte-identical, and this is about 6x faster over the 76k headwords every builder normalizes.
function normalizeTerm(value, options = {}) {
  return cleanText(value, options)
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

// Same as `normalizeTerm` minus the lowercasing -- the key a `caseSensitive`
// `user_nom_order.jsonc` row (see scripts/user-nom-order.js) is read and
// written under, so "Đỗ" and "đỗ" can each carry their own row without
// `normalizeTerm`'s casefold making them collide.
function exactKey(value, options = {}) {
  return cleanText(value, options).replace(/\s+/g, ' ');
}

// Accent folding is only ever used for matching no-diacritic or mistyped input against
// local dictionary keys. It must never produce a stored `vi` value.
function foldAccents(value) {
  return normalizeTerm(value)
    .replace(/đ/g, 'd')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .normalize('NFC');
}

// The other tone-mark placement of the words ending in oa/oe/uy ("hoả" <-> "hỏa", "thuỷ" <-> "thủy"): both spellings are the same word,
// but `normalizeTerm` keeps them as two keys. Returns the variant with the mark moved from the last vowel to the first, or '' when no
// word has one (the placement only varies at the very end of a syllable: "hoàng" has no "hòang").
function toneShiftVariant(value) {
  const variant = normalizeTerm(value).normalize('NFD')
    .replace(/([ou])([ae]|y)([\u0300\u0301\u0303\u0309\u0323])(?=\s|$)/g, '$1$3$2')
    .normalize('NFC');
  return variant === normalizeTerm(value) ? '' : variant;
}

function stableUnique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

module.exports = {
  cleanText,
  normalizeTerm,
  exactKey,
  foldAccents,
  toneShiftVariant,
  stableUnique
};
