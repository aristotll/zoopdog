'use strict';

const fs = require('node:fs');
const {cleanText} = require('./text');

function readJson(target) {
  return JSON.parse(fs.readFileSync(target, 'utf8'));
}

// `scripts/extract-mdx-nom-data.js` writes a payload with metadata plus an `entries` map,
// but older extractions were a bare map. Both shapes are read through here.
function mdxEntries(payload) {
  return (payload && payload.entries) || payload || {};
}

// Definitions are de-duplicated on the (def, pos) pair; NUL is used as the separator
// because neither field can contain it.
function definitionKey(def, pos) {
  return `${cleanText(def)}\u0000${cleanText(pos)}`;
}

module.exports = {
  readJson,
  mdxEntries,
  definitionKey
};
