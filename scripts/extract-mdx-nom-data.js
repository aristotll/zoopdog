#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

let MDX;
try {
  ({MDX} = require('js-mdict'));
} catch (error) {
  console.error('Missing dependency: js-mdict');
  console.error('Install it in a temporary directory and expose NODE_PATH, for example:');
  console.error('  tmp=$(mktemp -d /tmp/mdx-extract.XXXXXX)');
  console.error('  cd "$tmp" && npm init -y >/dev/null && npm install js-mdict@6.0.6 >/dev/null');
  console.error('  NODE_PATH="$tmp/node_modules" node /path/to/scripts/extract-mdx-nom-data.js /path/to/dict.mdx');
  process.exit(1);
}

const rootDir = path.resolve(__dirname, '..');
const sourcePath = process.argv[2];
const outputPath = process.argv[3]
  ? path.resolve(process.argv[3])
  : path.join(rootDir, 'zd-extension/db_src/mdx_nom.json');

const cjkPattern = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u{20000}-\u{323AF}]/u;
const cjkSequencePattern = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u{20000}-\u{323AF}]+/gu;
const vietnameseKeyPattern = /[A-Za-zÀÁÂÃÈÉÊÌÍÒÓÔÕÙÚĂĐĨŨƠƯàáâãèéêìíòóôõùúăđĩũơưẠẢẤẦẨẪẬẮẰẲẴẶẸẺẼỀẾỂỄỆỈỊỌỎỐỒỔỖỘỚỜỞỠỢỤỦỨỪỬỮỰỲỴÝỶỸạảấầẩẫậắằẳẵặẹẻẽềếểễệỉịọỏốồổỗộớờởỡợụúủứừửữựỳýỵỷỹ]/u;

function cleanText(value) {
  return String(value || '')
    .replace(/^\uFEFF/, '')
    .replace(/\u0000/g, '')
    .normalize('NFC')
    .trim();
}

function normalizeTerm(value) {
  return cleanText(value)
    .toLocaleLowerCase('vi-VN')
    .replace(/\s+/g, ' ');
}

function stripHtml(value) {
  return cleanText(value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ');
}

function isVietnameseKey(key) {
  return vietnameseKeyPattern.test(key) && !cjkPattern.test(key);
}

function extractCandidates(definition, key) {
  let text = stripHtml(definition);
  const normalizedKey = normalizeTerm(key);

  if (text.toLocaleLowerCase('vi-VN').startsWith(normalizedKey)) {
    text = text.slice(key.length).trim();
  }

  return Array.from(new Set(text.match(cjkSequencePattern) || []));
}

function addEntry(entries, key, candidates) {
  const normalizedKey = normalizeTerm(key);

  if (!normalizedKey || Array.from(normalizedKey.replace(/\s/g, '')).length < 2) {
    return;
  }

  entries[normalizedKey] = Array.from(new Set([
    ...(entries[normalizedKey] || []),
    ...candidates
  ]));
}

if (!sourcePath) {
  console.error('Usage: node scripts/extract-mdx-nom-data.js <dict.mdx> [output.json]');
  process.exit(1);
}

const mdx = new MDX(sourcePath);
const entries = {};
let fetched = 0;
let withCandidates = 0;
let skippedNonVietnamese = 0;

for (const item of mdx.keywordList) {
  const key = cleanText(item.keyText);

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
