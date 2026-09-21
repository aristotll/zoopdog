#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const {
  readUserNomEntries,
  toDictionaryEntries
} = require('./user-nom-entries');
const {readUserNomOrder, applyUserNomOrderToDefinitions} = require('./user-nom-order');
const {cleanText, normalizeTerm} = require('./lib/text');
const {CJK_PATTERN: cjkPattern} = require('./lib/cjk');
const {definitionKey, readJson} = require('./lib/sources');
const repoPaths = require('./lib/paths');
const {
  readRuntime,
  renderRuntime,
  jsonParseLiteral,
  PENDING_VERSION,
  writeVersionedUserscript
} = require('./lib/userscript');

const rootDir = repoPaths.rootDir;
const dictionaryPath = repoPaths.absolute.dictionary;
const userNomPath = repoPaths.absolute.userNomEntries;
const userNomOrderPath = repoPaths.absolute.userNomOrder;

const sourceFiles = [
  // Shared word primitives, inlined ahead of the runtime that calls them. The popup shows no
  // auto-generated pronunciation, so the pron/chroma code is deliberately not embedded.
  'zd-extension/js/zd-words.js'
];

// The -local variant adds the "add/edit Chu Nom entries" ability (docs/local-mode.md) by
// concatenating its runtime + stylesheet into the same build; the github-hosted variant never
// inlines that code, so it never asks for the GM_xmlhttpRequest / 127.0.0.1 grants either. It
// is never committed -- see .gitignore -- and updates from its own file on this machine.
const VARIANTS = [
  {targetKey: 'popupUserscript', nameSuffix: '', localMode: false},
  {targetKey: 'popupLocalUserscript', nameSuffix: ' (Local)', localMode: true}
];

function isCjkDefinition(definition) {
  return cjkPattern.test(definition[0]) && !/[A-Za-z]/.test(definition[0]);
}

function buildDictionary(entries) {
  const dictionary = {};
  let maxWords = 1;

  for (const entry of entries) {
    const key = normalizeTerm(entry.vn);

    if (!key) {
      continue;
    }

    maxWords = Math.max(maxWords, key.split(/\s+/).length);

    const definitions = (entry.en || [])
      .map((item) => [
        cleanText(item.def),
        cleanText(item.pos)
      ])
      .filter((item) => item[0] || item[1]);

    if (!dictionary[key]) {
      dictionary[key] = [[cleanText(entry.vn), []]];
    }

    const existingDefinitions = dictionary[key][0][1];
    const seenDefinitions = new Set(
      existingDefinitions.map((item) => definitionKey(item[0], item[1]))
    );

    const orderedDefinitions = definitions.filter(isCjkDefinition).concat(
      definitions.filter((definition) => !isCjkDefinition(definition))
    );

    for (const definition of orderedDefinitions) {
      const defKey = definitionKey(definition[0], definition[1]);

      if (seenDefinitions.has(defKey)) {
        continue;
      }

      seenDefinitions.add(defKey);
      if (isCjkDefinition(definition)) {
        existingDefinitions.unshift(definition);
      } else {
        existingDefinitions.push(definition);
      }
    }
  }

  return {dictionary, maxWords};
}

// `buildDictionary` has already floated every CJK-only definition ahead of the glosses, so
// the popup leads with a term's Chu Nom renderings. Which of *those* comes first is still
// whatever vnedict2.json happened to list first, and this is where that is corrected --
// stably, so the CJK-before-gloss grouping above survives untouched.
function applyUserNomOrderToDictionary(dictionary, orderEntries) {
  applyUserNomOrderToDefinitions(orderEntries, {
    rowsFor: (key) => (dictionary[key] ? dictionary[key][0][1] : undefined),
    setRows: (key, rows) => {
      dictionary[key][0][1] = rows;
    },
    getText: (definition) => definition[0],
    makeRow: (value) => [value, '']
  });
}

function readRuntimeSources(localMode) {
  const parts = sourceFiles.map((relativePath) => {
    const absolutePath = path.join(rootDir, relativePath);
    return [
      `// ===== ${relativePath} =====`,
      fs.readFileSync(absolutePath, 'utf8')
    ].join('\n');
  });

  if (localMode) {
    parts.push([
      '// ===== scripts/userscript/popupdict-local.runtime.js =====',
      readRuntime('popupdict-local.runtime.js')
    ].join('\n'));
  }

  return parts.join('\n\n');
}

const LOCAL_GRANT_LINES = '\n' + [
  '// @grant       GM_xmlhttpRequest',
  '// @grant       GM_setValue',
  '// @grant       GM_getValue',
  '// @connect     127.0.0.1',
  '// @connect     localhost'
].join('\n');

function buildUserscript(dictionary, maxWords, runtimeSources, variant) {
  const css = variant.localMode
    ? readRuntime('popupdict.css') + '\n' + readRuntime('popupdict-local.css')
    : readRuntime('popupdict.css');
  const updateUrl = variant.localMode
    ? repoPaths.localFileUrl(variant.targetKey)
    : repoPaths.releaseUrl(variant.targetKey);

  return renderRuntime(readRuntime('popupdict.runtime.js'), {
    '"__ZOOPDOG_CSS__"': JSON.stringify(css),
    '__ZOOPDOG_RUNTIME_SOURCES__': runtimeSources,
    '{"__ZOOPDOG_DICTIONARY__": true}': jsonParseLiteral(dictionary),
    '__ZOOPDOG_MAX_WORDS__': maxWords,
    '__ZOOPDOG_KEY_COUNT__': Object.keys(dictionary).length,
    '__ZOOPDOG_NAME_SUFFIX__': variant.nameSuffix,
    '__ZOOPDOG_LOCAL_GRANTS__': variant.localMode ? LOCAL_GRANT_LINES : '',
    '__ZOOPDOG_UPDATE_URL__': updateUrl,
    '__ZOOPDOG_DOWNLOAD_URL__': updateUrl,
    // The real stamp is decided on write, by comparing this draft with the committed file.
    '__ZOOPDOG_VERSION__': PENDING_VERSION
  });
}

// The full merge pipeline -- base dictionary, hand-maintained entries, then display order --
// in one place so the popup userscript builder and Node-side tooling (scripts/nom-inspect.js
// and its tests) can never see two different popup dictionaries for the same repository state.
function buildFullDictionary() {
  const userNomEntries = readUserNomEntries(userNomPath);
  const entries = readJson(dictionaryPath).concat(
    toDictionaryEntries(userNomEntries)
  );
  const {dictionary, maxWords} = buildDictionary(entries);
  // Local entries are an implicit preference layer even when a rendering was already
  // present in the base dictionary. The explicit order file runs last and can override it.
  applyUserNomOrderToDictionary(dictionary, userNomEntries);
  const userNomOrder = readUserNomOrder(userNomOrderPath);
  applyUserNomOrderToDictionary(dictionary, userNomOrder);

  return {dictionary, maxWords, userNomEntries, userNomOrder};
}

function main(argv = process.argv.slice(2)) {
  const localOnly = argv.includes('--local-only');
  const variants = localOnly
    ? VARIANTS.filter((variant) => variant.localMode)
    : VARIANTS;
  const {dictionary, maxWords, userNomEntries, userNomOrder} = buildFullDictionary();

  for (const variant of variants) {
    const targetPath = repoPaths.absolute[variant.targetKey];
    const runtimeSources = readRuntimeSources(variant.localMode);
    const {version, changed} = writeVersionedUserscript(
      targetPath,
      buildUserscript(dictionary, maxWords, runtimeSources, variant)
    );

    console.log(`Wrote ${targetPath}`);
    console.log(`Version ${version}${changed ? ' (content changed)' : ' (unchanged)'}`);

  }

  console.log(`Embedded ${Object.keys(dictionary).length} dictionary keys`);
  if (userNomEntries.length) {
    console.log(`Merged ${userNomEntries.length} user Nom entries from ${userNomPath}`);
  }
  if (userNomOrder.length) {
    console.log(`Applied ${userNomOrder.length} display-order rows from ${userNomOrderPath}`);
  }
  console.log(`Maximum term length: ${maxWords} words`);
}

module.exports = {
  buildDictionary,
  applyUserNomOrderToDictionary,
  isCjkDefinition,
  readRuntimeSources,
  buildFullDictionary,
  main
};

if (require.main === module) {
  main(process.argv.slice(2));
}
