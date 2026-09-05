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
  PENDING_VERSION,
  writeVersionedUserscript
} = require('./lib/userscript');

const rootDir = repoPaths.rootDir;
const dictionaryPath = repoPaths.absolute.dictionary;
const userNomPath = repoPaths.absolute.userNomEntries;
const userNomOrderPath = repoPaths.absolute.userNomOrder;
const targetPath = repoPaths.absolute.popupUserscript;

const sourceFiles = [
  'zd-extension/js/lib/chroma.min.js',
  // Shared word primitives, inlined ahead of the runtime that calls them.
  'zd-extension/js/zd-words.js',
  'zd-extension/js/zd-pron-data.js',
  'zd-extension/js/zd-pron-functions.js',
  'zd-extension/js/zd-pron-drawtones.js'
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

function readRuntimeSources() {
  return sourceFiles.map((relativePath) => {
    const absolutePath = path.join(rootDir, relativePath);
    return [
      `// ===== ${relativePath} =====`,
      fs.readFileSync(absolutePath, 'utf8')
    ].join('\n');
  }).join('\n\n');
}


function buildUserscript(dictionary, maxWords, runtimeSources) {
  return renderRuntime(readRuntime('popupdict.runtime.js'), {
    '"__ZOOPDOG_CSS__"': JSON.stringify(readRuntime('popupdict.css')),
    '__ZOOPDOG_RUNTIME_SOURCES__': runtimeSources,
    '{"__ZOOPDOG_DICTIONARY__": true}': JSON.stringify(dictionary),
    '__ZOOPDOG_MAX_WORDS__': maxWords,
    '__ZOOPDOG_KEY_COUNT__': Object.keys(dictionary).length,
    '__ZOOPDOG_UPDATE_URL__': repoPaths.rawUrl('popupUserscript'),
    '__ZOOPDOG_DOWNLOAD_URL__': repoPaths.rawUrl('popupUserscript'),
    // The real stamp is decided on write, by comparing this draft with the committed file.
    '__ZOOPDOG_VERSION__': PENDING_VERSION
  });
}

function main() {
  const userNomEntries = readUserNomEntries(userNomPath);
  const entries = readJson(dictionaryPath).concat(
    toDictionaryEntries(userNomEntries)
  );
  const {dictionary, maxWords} = buildDictionary(entries);
  const userNomOrder = readUserNomOrder(userNomOrderPath);
  applyUserNomOrderToDictionary(dictionary, userNomOrder);
  const runtimeSources = readRuntimeSources();

  const {version, changed} = writeVersionedUserscript(
    targetPath,
    buildUserscript(dictionary, maxWords, runtimeSources)
  );

  console.log(`Wrote ${targetPath}`);
  console.log(`Version ${version}${changed ? ' (content changed)' : ' (unchanged)'}`);
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
  main
};

if (require.main === module) {
  main();
}
