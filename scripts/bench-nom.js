#!/usr/bin/env node

// Measures the load and scan costs the userscripts pay: evaluating each embedded map, building
// the nom matcher, and scanning a fixed Vietnamese sample. Prints milliseconds; writes nothing
// and is not part of `make verify` (timings are machine-dependent). Run it before and after a
// performance change on the same machine. `--json` prints one JSON object with the same numbers
// instead of the human-readable lines.

const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const repoPaths = require('./lib/paths');
const {zdCreateNomMatcher} = require('../zd-extension/js/zd-nom-match');

function ms(start) {
  return (Number(process.hrtime.bigint() - start) / 1e6).toFixed(1);
}

function timeIt(fn) {
  const start = process.hrtime.bigint();
  const result = fn();
  return {result, ms: ms(start)};
}

// The value of `var NAME_JSON = <string literal>;` in a generated userscript, as source text.
function assignedExpression(source, name) {
  const marker = `var ${name}_JSON = `;
  const start = source.indexOf(marker);
  if (start < 0) {
    throw new Error(`Missing ${name}`);
  }
  const end = source.indexOf(';\n', start);
  return source.slice(start + marker.length, end);
}

function evalMap(file, name) {
  const expression = assignedExpression(fs.readFileSync(file, 'utf8'), name);
  // Evaluating the string literal and parsing its JSON is what the runtime now does on first use.
  return timeIt(() => JSON.parse(vm.runInNewContext(`(${expression})`)));
}

function main(argv = process.argv.slice(2)) {
  const asJson = argv.includes('--json');
  const log = asJson ? () => {} : (...parts) => console.log(...parts);
  const result = {scans: []};
  const nom = evalMap(repoPaths.absolute.nomUserscript, 'NOM_MAP');
  const popup = evalMap(repoPaths.absolute.popupUserscript, 'ZOO_DICTIONARY');
  result.parseNomMap = {terms: Object.keys(nom.result).length, ms: Number(nom.ms)};
  result.parseDictionary = {keys: Object.keys(popup.result).length, ms: Number(popup.ms)};
  log(`parse NOM_MAP (${Object.keys(nom.result).length} terms): ${nom.ms} ms`);
  log(`parse ZOO_DICTIONARY (${Object.keys(popup.result).length} keys): ${popup.ms} ms`);

  const built = timeIt(() => zdCreateNomMatcher(nom.result, {annotateAsciiTerms: 'safe'}));
  result.buildMatcherMs = Number(built.ms);
  log(`build matcher: ${built.ms} ms`);

  const sample = 'Tôi có duyên gặp anh ấy ở Hà Nội vào một buổi chiều mùa thu, khi những chiếc lá vàng rơi ' +
    'đầy trên phố cổ và người ta vẫn kể cho nhau nghe những câu chuyện cũ. ';
  const text = sample.repeat(150);
  const long = sample.replace(/, /g, ' ').repeat(40);
  for (const [label, body] of [['clauses', text], ['one long run', long]]) {
    const scan = timeIt(() => {
      let count = 0;
      let offset = 0;
      let match;
      while ((match = built.result.findNomMatch(body, offset))) {
        count++;
        offset = match.index + match.length;
      }
      return count;
    });
    result.scans.push({label, chars: body.length, matches: scan.result, ms: Number(scan.ms)});
    log(`scan ${label} (${body.length} chars, ${scan.result} matches): ${scan.ms} ms`);
  }
  result.userscript = path.basename(repoPaths.absolute.nomUserscript);
  if (asJson) {
    console.log(JSON.stringify(result));
  } else {
    console.log(result.userscript, 'benchmarked');
  }
  return result;
}

if (require.main === module) {
  main();
}

module.exports = {main};
