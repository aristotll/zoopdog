#!/usr/bin/env node

// Local validation for the two Chu Nom surfaces (the nom-ruby annotation userscript and the
// popup dictionary) without grepping dictionary sources or installing a userscript in a
// browser. Reuses the exact merge pipelines the real builders run --
// scripts/build-nom-userscript.js's buildFullNomMap and
// scripts/build-popupdict-userscript.js's buildFullDictionary -- and the exact matching
// engine the nom-ruby userscript runs at read time, zd-extension/js/zd-nom-match.js, so a
// result here can never drift from what a rebuilt userscript would actually do.
//
// See docs/nom-validation.md and `make nom-annotate` / `make nom-popup`.

const {buildFullNomMap} = require('./build-nom-userscript');
const {buildFullDictionary} = require('./build-popupdict-userscript');
const {zdCreateNomMatcher} = require('../zd-extension/js/zd-nom-match');
const {normalizeTerm} = require('./lib/text');

// Mirrors the nom-ruby userscript's SETTINGS.annotateAsciiTerms default (see
// scripts/userscript/nom-ruby.runtime.js) so a result here matches what a rebuilt userscript
// would annotate unless the caller deliberately asks about a different mode.
const DEFAULT_ANNOTATE_ASCII_TERMS = 'safe';

// What the nom-ruby userscript would turn `text` into: every matched span, left to right,
// each carrying every known Chu Nom candidate in the order the userscript would render them
// (candidate 0 is the ruby text; the rest only ever show in its title attribute).
function annotate(text, options = {}) {
  const {nomMap, caseSensitiveNomMap} = buildFullNomMap();
  const annotateAsciiTerms = 'annotateAsciiTerms' in options
    ? options.annotateAsciiTerms
    : DEFAULT_ANNOTATE_ASCII_TERMS;
  const matcher = zdCreateNomMatcher(nomMap, {annotateAsciiTerms}, caseSensitiveNomMap);
  const normalized = String(text).normalize('NFC');

  const spans = [];
  let offset = 0;
  let match;
  while ((match = matcher.findNomMatch(normalized, offset))) {
    spans.push({
      index: match.index,
      length: match.length,
      text: normalized.substring(match.index, match.index + match.length),
      nom: match.nom,
      candidates: match.nom.split(' / ')
    });
    offset = match.index + match.length;
  }

  return {text: normalized, spans};
}

// What the popup dictionary would show for `term`: its headword form plus every definition,
// Chu Nom renderings first -- the same grouping/order build-popupdict-userscript.js applies.
function popupLookup(term) {
  const {dictionary} = buildFullDictionary();
  const key = normalizeTerm(term);
  const rows = dictionary[key];

  if (!rows) {
    return null;
  }

  const [vn, definitions] = rows[0];
  return {
    key,
    vn,
    definitions: definitions.map(([def, pos]) => ({def, pos}))
  };
}

function formatAnnotate(result) {
  const lines = [`Text: ${result.text}`];

  if (!result.spans.length) {
    lines.push('(no Chu Nom matches)');
    return lines.join('\n');
  }

  for (const span of result.spans) {
    const ruby = span.candidates[0];
    const rest = span.candidates.slice(1);
    const suffix = rest.length ? ` (other candidates: ${rest.join(' / ')})` : '';
    lines.push(`  [${span.index}..${span.index + span.length}) "${span.text}" -> ${ruby}${suffix}`);
  }

  return lines.join('\n');
}

function formatPopup(term, entry) {
  if (!entry) {
    return `No popup dictionary entry for "${term}" (normalized key: "${normalizeTerm(term)}")`;
  }

  const lines = [`Key: ${entry.key}`, `Headword: ${entry.vn}`, 'Definitions (in display order):'];
  entry.definitions.forEach((definition, index) => {
    const pos = definition.pos ? ` [${definition.pos}]` : '';
    lines.push(`  ${index + 1}. ${definition.def}${pos}`);
  });

  return lines.join('\n');
}

function printUsage(stream) {
  stream.write([
    'Usage:',
    '  node scripts/nom-inspect.js annotate <text>   Show what the nom-ruby userscript',
    '                                                 would annotate in <text>, in order.',
    '  node scripts/nom-inspect.js popup <term>       Show what the popup dictionary would',
    '                                                 display for <term>.',
    ''
  ].join('\n'));
}

function main(argv, io = {stdout: process.stdout, stderr: process.stderr}) {
  const [command, ...rest] = argv;
  const arg = rest.join(' ');

  if (command === 'annotate') {
    if (!arg) {
      printUsage(io.stderr);
      return 1;
    }
    io.stdout.write(`${formatAnnotate(annotate(arg))}\n`);
    return 0;
  }

  if (command === 'popup') {
    if (!arg) {
      printUsage(io.stderr);
      return 1;
    }
    io.stdout.write(`${formatPopup(arg, popupLookup(arg))}\n`);
    return 0;
  }

  printUsage(io.stderr);
  return 1;
}

module.exports = {
  DEFAULT_ANNOTATE_ASCII_TERMS,
  annotate,
  popupLookup,
  formatAnnotate,
  formatPopup,
  main
};

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}
