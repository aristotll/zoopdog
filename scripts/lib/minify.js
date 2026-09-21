'use strict';

const fs = require('node:fs');
const path = require('node:path');

const HEADER_END = '// ==/UserScript==';

// Minifies a generated userscript for release. The metadata block is kept verbatim -- the
// userscript manager reads it as plain text, and esbuild would drop its comments -- and only the
// code after it is minified. esbuild is a devDependency, so it is required lazily: the readable
// build and the test suite never need it.
function minifyUserscript(source) {
  const end = source.indexOf(HEADER_END);
  if (end < 0) {
    throw new Error(`Userscript has no ${HEADER_END} line`);
  }
  const headerEnd = end + HEADER_END.length;

  let esbuild;
  try {
    esbuild = require('esbuild');
  } catch (error) {
    throw new Error('esbuild is not installed: run `npm install` (see docs/build.md)');
  }
  const {code} = esbuild.transformSync(source.slice(headerEnd), {
    minify: true,
    legalComments: 'none',
    target: 'es2020',
    charset: 'utf8'
  });
  return `${source.slice(0, headerEnd)}\n${code}`;
}

// Writes the minified copy of an already-written userscript into dist/ under the same name.
function writeMinifiedUserscript(sourcePath, distFile) {
  const source = fs.readFileSync(sourcePath, 'utf8');
  const minified = minifyUserscript(source);
  fs.mkdirSync(path.dirname(distFile), {recursive: true});
  fs.writeFileSync(distFile, minified, 'utf8');
  return {before: Buffer.byteLength(source), after: Buffer.byteLength(minified)};
}

module.exports = {minifyUserscript, writeMinifiedUserscript};
