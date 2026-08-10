'use strict';

const {parseUserNomEntries} = require('../user-nom-entries');
const {cleanText, normalizeTerm, stableUnique} = require('../lib/text');
const {WorkflowError} = require('./errors');

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
      if (end < 0) throw new WorkflowError('Unterminated JSONC block comment.');
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
  throw new WorkflowError('Unterminated JSON string.');
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

function findPropertyValueSpan(objectSource, property) {
  let index = skipJsoncTrivia(objectSource, 1);
  while (index < objectSource.length && objectSource[index] !== '}') {
    if (objectSource[index] !== '"') {
      throw new WorkflowError('Expected a JSONC object property.');
    }
    const keyEnd = readJsonStringEnd(objectSource, index);
    const key = JSON.parse(objectSource.slice(index, keyEnd));
    index = skipJsoncTrivia(objectSource, keyEnd);
    if (objectSource[index] !== ':') {
      throw new WorkflowError(`Expected ':' after JSONC property ${key}.`);
    }
    const valueStart = skipJsoncTrivia(objectSource, index + 1);
    const valueEnd = readJsonValueEnd(objectSource, valueStart);
    if (key === property) {
      return {start: valueStart, end: valueEnd};
    }
    index = skipJsoncTrivia(objectSource, valueEnd);
    if (objectSource[index] === ',') {
      index = skipJsoncTrivia(objectSource, index + 1);
    }
  }
  return null;
}

function findTopLevelObjectSpans(source) {
  const spans = [];
  let square = 0;
  let curly = 0;
  let objectStart = null;
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (char === '"') {
      index = readJsonStringEnd(source, index) - 1;
      continue;
    }
    if (char === '/' && (source[index + 1] === '/' || source[index + 1] === '*')) {
      index = skipJsoncTrivia(source, index) - 1;
      continue;
    }
    if (char === '[') square++;
    else if (char === ']') square--;
    else if (char === '{') {
      if (square === 1 && curly === 0) objectStart = index;
      curly++;
    } else if (char === '}') {
      curly--;
      if (square === 1 && curly === 0 && objectStart !== null) {
        spans.push({start: objectStart, end: index + 1});
        objectStart = null;
      }
    }
  }
  return spans;
}

// The single serialization style for user-entry property values. Both the update path and
// the append path go through this so one file cannot accumulate two formatting styles.
function serializeValue(value) {
  return JSON.stringify(value);
}

function updateObjectValues(objectSource, entry) {
  const replacements = [];
  const missing = [];
  for (const [property, value] of [
    ['vi', entry.vi],
    ['nom', entry.nom],
    ['explain', entry.explain || []]
  ]) {
    const span = findPropertyValueSpan(objectSource, property);
    if (span) {
      replacements.push({...span, value: serializeValue(value)});
    } else {
      missing.push([property, value]);
    }
  }
  replacements.sort((a, b) => b.start - a.start);
  for (const replacement of replacements) {
    objectSource = objectSource.slice(0, replacement.start) + replacement.value + objectSource.slice(replacement.end);
  }
  for (const [property, value] of missing) {
    const existingSpans = ['vi', 'nom', 'explain']
      .map((name) => findPropertyValueSpan(objectSource, name))
      .filter(Boolean)
      .sort((a, b) => b.end - a.end);
    if (!existingSpans.length) throw new WorkflowError('Cannot insert into an empty user entry object.');
    const lastValueEnd = existingSpans[0].end;
    if (objectSource[skipJsoncTrivia(objectSource, lastValueEnd)] !== ',') {
      objectSource = objectSource.slice(0, lastValueEnd) + ',' + objectSource.slice(lastValueEnd);
    }
    const newline = objectSource.includes('\r\n') ? '\r\n' : '\n';
    const propertyIndent = (objectSource.match(/\r?\n([ \t]+)"/) || [null, '  '])[1];
    const close = objectSource.lastIndexOf('}');
    const trailing = objectSource.slice(0, close).match(/(?:\r\n|\n)([ \t]*)$/);
    const insertionPoint = trailing ? close - trailing[0].length : close;
    const closingIndent = trailing ? trailing[1] : '';
    objectSource = objectSource.slice(0, insertionPoint) +
      `${newline}${propertyIndent}${JSON.stringify(property)}: ${serializeValue(value)}` +
      `${newline}${closingIndent}${objectSource.slice(close)}`;
  }
  return objectSource;
}

function upsertUserEntriesJsonc(source, incomingEntries) {
  let updated = String(source);
  const spans = findTopLevelObjectSpans(updated);
  const indexed = new Map();
  for (const span of spans) {
    const objectSource = updated.slice(span.start, span.end);
    const [entry] = parseUserNomEntries(`[${objectSource}]`, 'user_nom_entries.jsonc');
    if (indexed.has(entry.key)) {
      throw new WorkflowError(`Duplicate existing user entry key: ${entry.key}`);
    }
    indexed.set(entry.key, {...span, entry});
  }

  const replacements = [];
  const additions = [];
  const groupedIncoming = new Map();
  for (const entry of incomingEntries) {
    const key = normalizeTerm(entry.vi);
    if (!groupedIncoming.has(key)) {
      groupedIncoming.set(key, {
        ...entry,
        nom: stableUnique((entry.nom || []).map(cleanText)),
        explain: stableUnique((entry.explain || []).map(cleanText))
      });
      continue;
    }
    const existing = groupedIncoming.get(key);
    existing.nom = stableUnique([...existing.nom, ...(entry.nom || []).map(cleanText)]);
    existing.explain = stableUnique([
      ...existing.explain,
      ...(entry.explain || []).map(cleanText)
    ]);
    existing.replace = Boolean(existing.replace || entry.replace);
  }
  for (const [key, entry] of groupedIncoming) {
    if (indexed.has(key)) {
      const span = indexed.get(key);
      // Updating an existing entry is additive: the reviewer approves candidates without
      // seeing the file's current values, so replacing outright would silently drop Nom
      // variants they never had a chance to restate. `replace: true` is the explicit
      // opt-in for removing stored values.
      const merged = entry.replace ? entry : {
        ...entry,
        nom: stableUnique([...span.entry.nom, ...entry.nom]),
        explain: stableUnique([...span.entry.explain, ...entry.explain])
      };
      if (cleanText(span.entry.vi) === cleanText(merged.vi) &&
          JSON.stringify(span.entry.nom) === JSON.stringify(merged.nom) &&
          JSON.stringify(span.entry.explain) === JSON.stringify(merged.explain)) {
        continue;
      }
      replacements.push({
        ...span,
        value: updateObjectValues(updated.slice(span.start, span.end), merged)
      });
    } else {
      additions.push({vi: entry.vi, nom: entry.nom, explain: entry.explain || []});
    }
  }
  replacements.sort((a, b) => b.start - a.start);
  for (const replacement of replacements) {
    updated = updated.slice(0, replacement.start) + replacement.value + updated.slice(replacement.end);
  }

  if (additions.length) {
    const newline = updated.includes('\r\n') ? '\r\n' : '\n';
    const close = updated.lastIndexOf(']');
    if (close < 0) throw new WorkflowError('User entry JSONC must contain a top-level array.');
    const entryIndent = (updated.match(/\r?\n([ \t]+)\{/) || [null, '  '])[1];
    const propertyIndent = (updated.match(/\r?\n([ \t]+)"/) || [null, `${entryIndent}  `])[1];
    const indentUnit = propertyIndent.startsWith(entryIndent)
      ? propertyIndent.slice(entryIndent.length) || '  '
      : '  ';
    const properties = ['vi', 'nom', 'explain'];
    const blocks = additions.map((entry) => [
      `${entryIndent}{`,
      ...properties.map((property, index) =>
        `${entryIndent}${indentUnit}${JSON.stringify(property)}: ` +
        `${serializeValue(entry[property])}${index === properties.length - 1 ? '' : ','}`),
      `${entryIndent}}`
    ].join(newline));
    const block = `${newline}${blocks.join(`,${newline}`)}`;

    // Place the separating comma structurally, right after the last entry's closing brace,
    // so comments or other trivia sitting between that entry and `]` are preserved instead
    // of swallowing the comma into a line comment and producing invalid JSONC.
    const entrySpans = findTopLevelObjectSpans(updated);
    if (entrySpans.length) {
      const lastEnd = entrySpans[entrySpans.length - 1].end;
      const trivia = updated.slice(lastEnd, close);
      const separator = /^\s*,/.test(trivia) ? '' : ',';
      updated = updated.slice(0, lastEnd) + separator +
        trivia.replace(/\s*$/, '') + block + newline + updated.slice(close);
    } else {
      updated = updated.slice(0, close).replace(/\s*$/, '') +
        block + newline + updated.slice(close);
    }
  }

  parseUserNomEntries(updated, 'user_nom_entries.jsonc');
  return updated;
}

module.exports = {
  serializeValue,
  skipJsoncTrivia,
  readJsonStringEnd,
  readJsonValueEnd,
  findPropertyValueSpan,
  findTopLevelObjectSpans,
  updateObjectValues,
  upsertUserEntriesJsonc
};
