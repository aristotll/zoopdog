'use strict';

// A minimal RFC 4180 CSV codec plus the `user_nom_entries` shard row shape on top of it. No
// external dependency is used (this repo has no package.json/npm dependency, per AGENTS.md), and
// the format is small enough (three columns, no header/quoting edge case beyond RFC 4180 itself)
// that a hand-written codec is less risk than adding a first dependency for it.
const {cleanText, normalizeTerm} = require('./text');

const HEADER = ['vi', 'nom', 'explain'];
const LIST_SEPARATOR = '|';

function needsQuoting(field) {
  return field.includes(',') || field.includes('"') || field.includes('\n') || field.includes('\r');
}

function quoteField(field) {
  return needsQuoting(field) ? `"${field.replace(/"/g, '""')}"` : field;
}

function serializeRow(fields) {
  return fields.map(quoteField).join(',');
}

// Parses one full CSV document into rows of raw string fields. Handles quoted fields, doubled
// `""` escapes, and commas/newlines embedded inside quotes -- a plain `line.split(',')` would
// break on any of those, which this format's `explain` column already exercises today (e.g.
// "manager, manage, administer").
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const push = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    push();
    rows.push(row);
    row = [];
  };
  while (i < text.length) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += char;
      i++;
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (char === ',') {
      push();
      i++;
      continue;
    }
    if (char === '\r' && text[i + 1] === '\n') {
      endRow();
      i += 2;
      continue;
    }
    if (char === '\n' || char === '\r') {
      endRow();
      i++;
      continue;
    }
    field += char;
    i++;
  }
  if (field !== '' || row.length) {
    endRow();
  }
  return rows;
}

function joinList(values) {
  return (values || []).join(LIST_SEPARATOR);
}

function splitList(value) {
  return value === '' ? [] : value.split(LIST_SEPARATOR);
}

// Throws rather than silently joining two values into one ambiguous cell -- no `nom`/`explain`
// value has ever contained `|` in this dataset (see design.md Decision 3), so this only fires on
// genuinely new, unexpected input.
function assertNoListSeparator(values, field, vi) {
  for (const value of values || []) {
    if (value.includes(LIST_SEPARATOR)) {
      throw new Error(
        `Cannot store "${vi}": ${field} value ${JSON.stringify(value)} contains the reserved ` +
        `list separator "${LIST_SEPARATOR}"`
      );
    }
  }
}

// One shard file's rows -> entries, sorted by normalized `vi` (the order shards are always
// written in). Blank lines and the header are skipped so a hand-created empty file (header only)
// parses to an empty array.
function parseShardCsv(text) {
  const rows = parseCsv(String(text || ''));
  const entries = [];
  for (const row of rows) {
    if (!row.length || (row.length === 1 && row[0] === '')) continue;
    const [vi, nom, explain] = row;
    if (vi === HEADER[0] && nom === HEADER[1] && explain === HEADER[2]) continue;
    entries.push({
      vi: cleanText(vi),
      nom: splitList(nom).map((value) => cleanText(value)),
      explain: splitList(explain).map((value) => cleanText(value))
    });
  }
  return entries;
}

// Plain codepoint comparison, not `localeCompare` -- `localeCompare()` with no explicit locale
// resolves against the runtime's default locale and ICU data, which differ across Node builds
// and machines (observed: the same input sorted differently on two ordinary `node -e` runs on
// this same machine). A shard's sort order only needs to be *some* fixed order stable enough
// that one insertion is a one-line diff (design.md Decision 4); it was never meant to be
// linguistically correct Vietnamese alphabetical order, so there is nothing to lose by pinning
// it to something that can never depend on the environment.
function compareNormalized(a, b) {
  const left = normalizeTerm(a.vi);
  const right = normalizeTerm(b.vi);
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function serializeShardCsv(entries) {
  const sorted = [...entries].sort(compareNormalized);
  const lines = [serializeRow(HEADER)];
  for (const entry of sorted) {
    assertNoListSeparator(entry.nom, 'nom', entry.vi);
    assertNoListSeparator(entry.explain, 'explain', entry.vi);
    lines.push(serializeRow([entry.vi, joinList(entry.nom), joinList(entry.explain)]));
  }
  return `${lines.join('\n')}\n`;
}

module.exports = {
  HEADER,
  LIST_SEPARATOR,
  parseCsv,
  serializeRow,
  parseShardCsv,
  serializeShardCsv
};
