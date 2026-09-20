#!/usr/bin/env node

// Measures the load and scan costs the userscripts pay: evaluating each embedded map, building
// the nom matcher, and scanning a fixed Vietnamese sample. Prints milliseconds; writes nothing
// and is not part of `make verify` (timings are machine-dependent). Run it before and after a
// performance change on the same machine.

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

// The value of `var NAME = <expr>;` in a generated userscript, as source text.
function assignedExpression(source, name) {
  const marker = `var ${name} = `;
  const start = source.indexOf(marker);
  if (start < 0) {
    throw new Error(`Missing ${name}`);
  }
  const end = source.indexOf(';\n', start);
  return source.slice(start + marker.length, end);
}

function evalMap(file, name) {
  const expression = assignedExpression(fs.readFileSync(file, 'utf8'), name);
  return timeIt(() => vm.runInNewContext(`(${expression})`));
}

function main() {
  const nom = evalMap(repoPaths.absolute.nomUserscript, 'NOM_MAP');
  const popup = evalMap(repoPaths.absolute.popupUserscript, 'ZOO_DICTIONARY');
  console.log(`eval NOM_MAP (${Object.keys(nom.result).length} terms): ${nom.ms} ms`);
  console.log(`eval ZOO_DICTIONARY (${Object.keys(popup.result).length} keys): ${popup.ms} ms`);

  const built = timeIt(() => zdCreateNomMatcher(nom.result, {annotateAsciiTerms: 'safe'}));
  console.log(`build matcher: ${built.ms} ms`);

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
    console.log(`scan ${label} (${body.length} chars, ${scan.result} matches): ${scan.ms} ms`);
  }
  console.log(path.basename(repoPaths.absolute.nomUserscript), 'benchmarked');
}

if (require.main === module) {
  main();
}

module.exports = {main};
