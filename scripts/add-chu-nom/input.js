'use strict';

const {cleanText} = require('../lib/text');
const {CJK_SEQUENCE_PATTERN} = require('../lib/cjk');
const {WorkflowError} = require('./errors');

function parseFileMention(value) {
  const match = String(value || '').match(/^(.*?)(?:#L(\d+)(?:-(?:L)?(\d+))?)?$/);
  if (!match || !match[1]) {
    throw new WorkflowError('file_mention_invalid', `Invalid file mention: ${value}`);
  }
  const startLine = match[2] ? Number(match[2]) : null;
  const endLine = match[3] ? Number(match[3]) : startLine;
  if (startLine !== null && (startLine < 1 || endLine < startLine)) {
    throw new WorkflowError('file_range_invalid', `Invalid file line range: ${value}`);
  }
  return {path: match[1], startLine, endLine};
}

function isIgnoredMarkdownLine(line) {
  return /^\s*#{1,6}\s/.test(line) ||
    /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line) ||
    /^\s*```/.test(line);
}

// The single source of truth for how a line divides into items. `parseInputText` and
// `cleanupInputContent` MUST both index items through this function so that removing an
// applied item removes exactly the text that produced it.
function splitLineRecords(line) {
  const records = [];
  const majorParts = line.split(/([;|])/);
  for (let majorIndex = 0; majorIndex < majorParts.length; majorIndex += 2) {
    const segment = majorParts[majorIndex];
    const majorSeparator = majorParts[majorIndex + 1] || '';
    if (!segment.trim()) continue;
    const slashCount = (segment.match(/\//g) || []).length;
    if (slashCount === 2) {
      records.push({
        itemIndex: records.length + 1,
        raw: segment,
        text: segment.trim(),
        separator: majorSeparator
      });
      continue;
    }
    const commaParts = segment.split(/([,])/);
    for (let commaIndex = 0; commaIndex < commaParts.length; commaIndex += 2) {
      if (!commaParts[commaIndex].trim()) continue;
      records.push({
        itemIndex: records.length + 1,
        raw: commaParts[commaIndex],
        text: commaParts[commaIndex].trim(),
        separator: commaParts[commaIndex + 1] || majorSeparator
      });
    }
  }
  return records;
}

function parseMixedAnnotatedLine(line) {
  if (line.includes('/')) return undefined;
  if (!(String(line).match(CJK_SEQUENCE_PATTERN) || []).length) return undefined;

  let latinRun = false;
  const vietnamese = cleanText(Array.from(String(line).normalize('NFC'), (character) => {
    if (/\p{Script=Latin}/u.test(character)) {
      latinRun = true;
      return character;
    }
    if (/\p{Mark}/u.test(character) && latinRun) return character;
    latinRun = false;
    return ' ';
  }).join('')).replace(/\s+/g, ' ');
  if (!/\p{Script=Latin}/u.test(vietnamese)) return null;

  return {
    original: vietnamese,
    rawInput: cleanText(line),
    inlineNom: [],
    inlineExplain: [],
    filteredInput: true
  };
}

function parseInputText(source, options = {}) {
  const startLine = options.startLine || 1;
  const endLine = options.endLine || Number.POSITIVE_INFINITY;
  const items = [];

  String(source || '').split(/\r?\n/).forEach((line, index) => {
    const lineNumber = index + 1;
    if (lineNumber < startLine || lineNumber > endLine || !line.trim() || isIgnoredMarkdownLine(line)) {
      return;
    }

    // Split first, then test each record for CJK annotation. Deriving every item from a
    // `splitLineRecords` record is what keeps `itemIndex` meaningful to
    // `cleanupInputContent`; parsing the whole line ahead of the split used to produce one
    // item for several separated phrases, which then left the unremoved segments behind.
    splitLineRecords(line).forEach((record) => {
      const annotated = parseMixedAnnotatedLine(record.raw);
      if (annotated !== undefined) {
        if (annotated) {
          items.push({
            id: `L${lineNumber}:I${record.itemIndex}`,
            line: lineNumber,
            itemIndex: record.itemIndex,
            ...annotated
          });
        }
        return;
      }

      const trimmed = record.text;
      const triple = trimmed.split(/\s*\/\s*/);
      const hasTriple = triple.length === 3 && triple.every(Boolean);
      items.push({
        id: `L${lineNumber}:I${record.itemIndex}`,
        line: lineNumber,
        itemIndex: record.itemIndex,
        original: cleanText(hasTriple ? triple[0] : trimmed),
        inlineNom: hasTriple ? [cleanText(triple[1])] : [],
        inlineExplain: hasTriple ? [cleanText(triple[2])] : []
      });
    });
  });

  return items;
}

function cleanupInputContent(source, sourceItems, appliedItemIds) {
  const hadFinalNewline = /\r?\n$/.test(source);
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const removalsByLine = new Map();
  for (const item of sourceItems) {
    if (!appliedItemIds.has(item.id)) continue;
    if (!removalsByLine.has(item.line)) removalsByLine.set(item.line, new Set());
    removalsByLine.get(item.line).add(item.itemIndex);
  }

  const lines = source.split(/\r?\n/);
  if (hadFinalNewline) lines.pop();
  const keptLines = [];
  lines.forEach((line, lineIndex) => {
    const removals = removalsByLine.get(lineIndex + 1);
    if (!removals) {
      keptLines.push(line);
      return;
    }
    const records = splitLineRecords(line);
    const remaining = records.filter((record) => !removals.has(record.itemIndex));
    if (!remaining.length) return;
    const rebuilt = remaining.map((record, index) => {
      if (index === remaining.length - 1) return record.raw;
      return `${record.raw}${record.separator || ','}`;
    }).join('');
    keptLines.push(rebuilt);
  });
  return keptLines.join(newline) + (hadFinalNewline ? newline : '');
}

module.exports = {
  parseFileMention,
  isIgnoredMarkdownLine,
  splitLineRecords,
  parseMixedAnnotatedLine,
  parseInputText,
  cleanupInputContent
};
