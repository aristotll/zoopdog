const fs = require('fs');

function cleanText(value) {
  return String(value || '')
    .replace(/^\uFEFF/, '')
    .normalize('NFC')
    .trim();
}

function normalizeTerm(value) {
  return cleanText(value)
    .toLocaleLowerCase('vi-VN')
    .replace(/\s+/g, ' ');
}

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

function asTextArray(value) {
  const values = Array.isArray(value) ? value : [value];
  return values.map(cleanText).filter(Boolean);
}

function parseUserNomEntries(source, sourcePath) {
  const payload = JSON.parse(stripJsonComments(source));
  const rawEntries = Array.isArray(payload) ? payload : payload.entries;

  if (!Array.isArray(rawEntries)) {
    throw new Error(`${sourcePath} must contain an array, or an object with an entries array`);
  }

  return rawEntries.map((entry, index) => {
    const vi = cleanText(entry.vi || entry.vn || entry.word);
    const nom = asTextArray(entry.nom || entry.chuNom || entry.chunom);
    const explain = asTextArray(
      entry.explain ||
      entry.explains ||
      entry.explanation ||
      entry.definitions
    );

    if (!vi) {
      throw new Error(`${sourcePath} entry ${index + 1} is missing vi`);
    }

    if (!nom.length) {
      throw new Error(`${sourcePath} entry ${index + 1} is missing nom`);
    }

    return {
      vi,
      key: normalizeTerm(vi),
      nom,
      explain
    };
  });
}

function readUserNomEntries(sourcePath) {
  if (!fs.existsSync(sourcePath)) {
    return [];
  }

  return parseUserNomEntries(fs.readFileSync(sourcePath, 'utf8'), sourcePath);
}

function mergeUserNomEntriesIntoNomMap(nomMap, userEntries) {
  for (const entry of userEntries) {
    const existing = String(nomMap[entry.key] || '')
      .split(/\s+\/\s+/)
      .map(cleanText)
      .filter(Boolean);

    nomMap[entry.key] = Array.from(new Set([...existing, ...entry.nom])).join(' / ');
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
  stripJsonComments,
  asTextArray,
  parseUserNomEntries,
  readUserNomEntries,
  mergeUserNomEntriesIntoNomMap,
  toDictionaryEntries
};
