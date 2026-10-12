#!/usr/bin/env node
'use strict';

// Fetches chunom.org's standard-character list and writes it as data (docs/chunom-standard.md):
//
//   node scripts/import-chunom-standard.js --fetch          # https://chunom.org/pages/standard-list/?max=2000
//   node scripts/import-chunom-standard.js --file list.txt  # a saved copy of the same text
//
// Writes ONE file, `zd-extension/db_src/chunom_standard.json` (the shape of mdx_nom.json plus meanings and the standard
// character of each reading). It is generated data: gitignored, and published as a GitHub Release asset with the userscripts. It
// never touches vnedict2.json or any user file: the builders fold it in memory (scripts/chunom-standard-layer.js).

const fs = require('node:fs');
const https = require('node:https');
const {atomicWrite} = require('./lib/fsutil');
const repoPaths = require('./lib/paths');
const {STANDARD_LIST_URL, parseStandardList, buildPayload} = require('./lib/chunom-standard');

const MIN_ROWS = 3000;
const TIMEOUT_MS = 30000;
const MAX_REDIRECTS = 5;

function fetchText(url, redirects = MAX_REDIRECTS) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {headers: {'Accept-Encoding': 'identity'}, timeout: TIMEOUT_MS}, (response) => {
      const {statusCode, headers} = response;
      if (statusCode >= 300 && statusCode < 400 && headers.location && redirects > 0) {
        response.resume();
        resolve(fetchText(new URL(headers.location, url).href, redirects - 1));
        return;
      }
      if (statusCode !== 200) {
        reject(new Error(`${url}: HTTP ${statusCode}`));
        response.resume();
        return;
      }
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      response.on('error', reject);
    });
    request.on('timeout', () => request.destroy(new Error(`${url}: no response in ${TIMEOUT_MS}ms`)));
    request.on('error', reject);
  });
}

async function main(argv = process.argv.slice(2), paths = repoPaths.absolute) {
  const fileAt = argv.indexOf('--file');
  if (fileAt < 0 && !argv.includes('--fetch')) {
    throw new Error('usage: import-chunom-standard.js --fetch | --file <standard-list.txt>');
  }
  const text = fileAt >= 0 ? fs.readFileSync(argv[fileAt + 1], 'utf8') : await fetchText(STANDARD_LIST_URL);
  const rows = parseStandardList(text);
  if (rows.length < MIN_ROWS) {
    throw new Error(`only ${rows.length} rows read: this is not the standard list (expected about 3930)`);
  }
  const payload = buildPayload(rows);
  atomicWrite(paths.chunomStandard, `${JSON.stringify(payload, null, 1)}\n`);
  console.log(`Wrote ${paths.chunomStandard}: ${rows.length} rows (${payload.characterCount} characters, ${payload.entryCount} terms)`);
  return {rows: rows.length, payload};
}

module.exports = {main};

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
