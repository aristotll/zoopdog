'use strict';

const {WorkflowError} = require('./errors');

// Generic JS-source-value-span scanning, used by `apply.js`'s `extractAssignedJson` to find
// where a `var NOM_MAP = {...}` / `var ZOO_DICTIONARY = {...}` assignment's value ends inside a
// generated userscript. This module used to also own `user_nom_entries.jsonc`'s JSONC-splicing
// upsert logic; that moved to `scripts/lib/nom-entries-store.js` when the store became sharded
// CSV (see openspec/changes/shard-user-nom-entries-csv) -- these two scanning primitives had no
// dependency on that format and are kept here since `apply.js` still needs them for generated
// userscript output, which remains hand-rolled JS, not JSONC.
function skipJsoncTrivia(source, start) {
  let index = start;
  while (index < source.length) {
    if (/\s/.test(source[index])) {
      index++;
      continue;
    }
    if (source[index] === '/' && source[index + 1] === '/') {
      index += 2;
      while (index < source.length && source[index] !== '\n') index++;
      continue;
    }
    if (source[index] === '/' && source[index + 1] === '*') {
      const end = source.indexOf('*/', index + 2);
      if (end < 0) throw new WorkflowError('jsonc_unterminated_comment', 'Unterminated JSONC block comment.');
      index = end + 2;
      continue;
    }
    break;
  }
  return index;
}

function readJsonStringEnd(source, start) {
  let escaped = false;
  for (let index = start + 1; index < source.length; index++) {
    const char = source[index];
    if (escaped) {
      escaped = false;
    } else if (char === '\\') {
      escaped = true;
    } else if (char === '"') {
      return index + 1;
    }
  }
  throw new WorkflowError('jsonc_unterminated_string', 'Unterminated JSON string.');
}

function readJsonValueEnd(source, start) {
  if (source[start] === '"') {
    return readJsonStringEnd(source, start);
  }
  let square = 0;
  let curly = 0;
  let index = start;
  while (index < source.length) {
    const char = source[index];
    if (char === '"') {
      index = readJsonStringEnd(source, index);
      continue;
    }
    if (char === '/' && (source[index + 1] === '/' || source[index + 1] === '*')) {
      index = skipJsoncTrivia(source, index);
      continue;
    }
    if (char === '[') square++;
    else if (char === ']') {
      square--;
      if (square === 0 && curly === 0) return index + 1;
    }
    else if (char === '{') curly++;
    else if (char === '}') {
      if (square === 0 && curly === 0) return index;
      curly--;
      if (square === 0 && curly === 0) return index + 1;
    } else if (char === ',' && square === 0 && curly === 0) {
      return index;
    }
    index++;
  }
  return index;
}

module.exports = {
  skipJsoncTrivia,
  readJsonStringEnd,
  readJsonValueEnd
};
