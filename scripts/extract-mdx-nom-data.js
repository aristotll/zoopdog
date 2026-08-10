#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// js-mdict is an optional, out-of-repo dependency used only when actually extracting.
// Loading it lazily keeps this module importable (and testable) without it installed.
function loadMdx() {
  try {
    return require('js-mdict').MDX;
  } catch (error) {
    console.error('Missing dependency: js-mdict');
    console.error('Install it in a temporary directory and expose NODE_PATH, for example:');
    console.error('  tmp=$(mktemp -d /tmp/mdx-extract.XXXXXX)');
    console.error('  cd "$tmp" && npm init -y >/dev/null && npm install js-mdict@6.0.6 >/dev/null');
    console.error('  NODE_PATH="$tmp/node_modules" node /path/to/scripts/extract-mdx-nom-data.js /path/to/dict.mdx');
    process.exit(1);
  }
}

const sharedText = require('./lib/text');
const {CJK_PATTERN: cjkPattern, CJK_SEQUENCE_PATTERN: cjkSequencePattern} = require('./lib/cjk');
const repoPaths = require('./lib/paths');

const vietnameseKeyPattern = /[A-Za-zÀÁÂÃÈÉÊÌÍÒÓÔÕÙÚĂĐĨŨƠƯàáâãèéêìíòóôõùúăđĩũơưẠẢẤẦẨẪẬẮẰẲẴẶẸẺẼỀẾỂỄỆỈỊỌỎỐỒỔỖỘỚỜỞỠỢỤỦỨỪỬỮỰỲỴÝỶỸạảấầẩẫậắằẳẵặẹẻẽềếểễệỉịọỏốồổỗộớờởỡợụúủứừửữựỳýỵỷỹ]/u;

// MDX payloads can carry embedded NUL bytes, so this script always strips them. These are
// the shared helpers with one option set, not a second implementation.
const MDX_TEXT = {stripNul: true};
const cleanMdxText = (value) => sharedText.cleanText(value, MDX_TEXT);
const normalizeMdxTerm = (value) => sharedText.normalizeTerm(value, MDX_TEXT);


function stripHtml(value) {
  return cleanMdxText(value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ');
}

function isVietnameseKey(key) {
  return vietnameseKeyPattern.test(key) && !cjkPattern.test(key);
}

function extractCandidates(definition, key) {
  let text = stripHtml(definition);
  const normalizedKey = normalizeMdxTerm(key);

  if (text.toLocaleLowerCase('vi-VN').startsWith(normalizedKey)) {
    text = text.slice(key.length).trim();
  }

  return Array.from(new Set(text.match(cjkSequencePattern) || []));
}

function addEntry(entries, key, candidates) {
  const normalizedKey = normalizeMdxTerm(key);

  if (!normalizedKey || Array.from(normalizedKey.replace(/\s/g, '')).length < 2) {
    return;
  }

  entries[normalizedKey] = Array.from(new Set([
    ...(entries[normalizedKey] || []),
    ...candidates
  ]));
}

function main() {
  const sourcePath = process.argv[2];
  const outputPath = process.argv[3]
    ? path.resolve(process.argv[3])
    : repoPaths.absolute.mdxNom;

  if (!sourcePath) {
    console.error('Usage: node scripts/extract-mdx-nom-data.js <dict.mdx> [output.json]');
    process.exit(1);
  }

  const MDX = loadMdx();
  const mdx = new MDX(sourcePath);
  const entries = {};
  let fetched = 0;
  let withCandidates = 0;
  let skippedNonVietnamese = 0;

  for (const item of mdx.keywordList) {
    const key = cleanMdxText(item.keyText);

    if (!isVietnameseKey(key)) {
      skippedNonVietnamese++;
      continue;
    }

    const record = mdx.fetch(item);
    fetched++;

    if (!record || !record.definition) {
      continue;
    }

    const candidates = extractCandidates(record.definition, key);
    if (!candidates.length) {
      continue;
    }

    withCandidates++;
    addEntry(entries, key, candidates);
  }

  const payload = {
    source: sourcePath,
    generatedBy: 'scripts/extract-mdx-nom-data.js',
    keywordCount: mdx.keywordList.length,
    fetched,
    withCandidates,
    skippedNonVietnamese,
    entryCount: Object.keys(entries).length,
    entries
  };

  fs.mkdirSync(path.dirname(outputPath), {recursive: true});
  fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2), 'utf8');

  console.log(`Wrote ${outputPath}`);
  console.log(`Extracted ${payload.entryCount} Vietnamese keys with CJK/Nom candidates`);
  console.log(`Fetched ${fetched} records from ${payload.keywordCount} MDX keywords`);
}

module.exports = {
  stripHtml,
  isVietnameseKey,
  extractCandidates,
  addEntry,
  cleanMdxText,
  normalizeMdxTerm,
  main
};

if (require.main === module) {
  main();
}
