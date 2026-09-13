'use strict';

// Strips `//` and `/* */` comments (and trailing commas) from a JSONC document so it can be
// handed to `JSON.parse`. Split out of `user-nom-entries.js` when that file stopped being
// JSONC-backed (see openspec/changes/shard-user-nom-entries-csv) -- `user_nom_order.jsonc` is
// still a single hand-maintained JSONC file and is this function's only remaining caller.
function stripJsonComments(source) {
  let result = '';
  let inString = false;
  let quote = '';
  let escaped = false;

  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    const next = source[i + 1];

    if (inString) {
      result += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === quote) {
        inString = false;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      inString = true;
      quote = ch;
      result += ch;
      continue;
    }

    if (ch === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') {
        i++;
      }
      result += '\n';
      continue;
    }

    if (ch === '/' && next === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
        if (source[i] === '\n') {
          result += '\n';
        }
        i++;
      }
      i++;
      continue;
    }

    result += ch;
  }

  return result.replace(/,\s*([}\]])/g, '$1');
}

module.exports = {stripJsonComments};
