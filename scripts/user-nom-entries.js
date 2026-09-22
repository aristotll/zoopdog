const fs = require('fs');
const {cleanText, normalizeTerm} = require('./lib/text');
const {readAllEntries} = require('./lib/nom-entries-store');

// `readUserNomEntries` used to parse a single hand-maintained JSONC file; it now reads the
// sharded CSV store under `sourcePath` (a directory) instead. The function's signature and
// return shape (`{vi, key, nom, explain}[]`) are unchanged on purpose -- see
// openspec/changes/shard-user-nom-entries-csv/design.md Decision 5 -- so both userscript
// builders need no changes at all.
function readUserNomEntries(sourcePath) {
  if (!fs.existsSync(sourcePath)) {
    return [];
  }

  return readAllEntries(sourcePath).map((entry) => {
    if (!entry.vi) {
      throw new Error(`${sourcePath} has an entry missing vi`);
    }
    if (!entry.nom.length) {
      throw new Error(`${sourcePath} entry "${entry.vi}" is missing nom`);
    }
    return entry;
  });
}

function mergeUserNomEntriesIntoNomMap(nomMap, userEntries) {
  for (const entry of userEntries) {
    const existing = String(nomMap[entry.key] || '')
      .split(/\s+\/\s+/)
      .map(cleanText)
      .filter(Boolean);

    // Hand-maintained values are an override layer: retain lower-priority candidates for
    // reference, but make the local order the order every candidate-0 consumer displays.
    nomMap[entry.key] = Array.from(new Set([...entry.nom, ...existing])).join(' / ');
  }
}

function toDictionaryEntries(userEntries) {
  return userEntries.map((entry) => ({
    vn: entry.vi,
    en: [
      ...entry.nom.map((nom) => ({def: nom, pos: ''})),
      ...entry.explain.map((explain) => ({def: explain, pos: ''}))
    ]
  }));
}

module.exports = {
  cleanText,
  normalizeTerm,
  readUserNomEntries,
  mergeUserNomEntriesIntoNomMap,
  toDictionaryEntries
};
