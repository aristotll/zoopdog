'use strict';

const fs = require('node:fs');
const path = require('node:path');

const runtimeDir = path.resolve(__dirname, '../userscript');

/** @param {string} name */
function readRuntime(name) {
  return fs.readFileSync(path.join(runtimeDir, name), 'utf8');
}

// Substitute generated values into an extracted runtime source. Each placeholder must occur
// exactly once: a missing one means the runtime drifted from the builder, and a repeated one
// means the substitution would be ambiguous. Either way the build should fail loudly rather
// than emit a userscript with an unreplaced `__ZOOPDOG_*__` token in it.
/** @param {string} source @param {Record<string, any>} replacements */
function renderRuntime(source, replacements) {
  let output = source;
  for (const [placeholder, value] of Object.entries(replacements)) {
    const parts = output.split(placeholder);
    if (parts.length !== 2) {
      throw new Error(
        `Runtime placeholder ${placeholder} must appear exactly once, found ${parts.length - 1}`
      );
    }
    output = parts.join(String(value));
  }
  if (/__ZOOPDOG_[A-Z_]+__/.test(output)) {
    throw new Error(`Unreplaced runtime placeholder: ${/** @type {RegExpMatchArray} */ (output.match(/__ZOOPDOG_[A-Z_]+__/))[0]}`);
  }
  return output;
}

// Emits `value` as a JS string literal holding its JSON text. The runtime keeps that text in a
// `var <NAME>_JSON = ...;` and parses it on first use: V8 parses a JSON string markedly faster
// than the same data written as an object literal (measured ~2x on the 5 MB popup dictionary),
// and deferring the parse keeps pages that never need the data from paying for it at all. The
// literal is a valid JS string whose value is valid JSON, so `extractAssignedJson` below reads
// it back with the JSON primitives it already has.
/** @param {unknown} value */
function jsonStringLiteral(value) {
  return JSON.stringify(JSON.stringify(value));
}

// Generic JS-source-value-span scanning, used by `extractAssignedJson` to find where a
// `var NOM_MAP_JSON = "..."` / `var ZOO_DICTIONARY_JSON = "..."` assignment's value ends inside a
// generated userscript.
/** @param {string} source @param {number} start */
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
      if (end < 0) throw new Error('Unterminated JSONC block comment.');
      index = end + 2;
      continue;
    }
    break;
  }
  return index;
}

/** @param {string} source @param {number} start */
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
  throw new Error('Unterminated JSON string.');
}

/** @param {string} source @param {number} start */
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

// Reads back a generated `var <variableName>_JSON = "<json text>";` assignment (written with
// `jsonStringLiteral`) or, failing that, a plain `var <variableName> = {...};` object literal
// from generated userscript source.
/** @param {string} source @param {string} variableName */
function extractAssignedJson(source, variableName) {
  let markerIndex = source.indexOf(`var ${variableName}_JSON =`);
  let marker = `var ${variableName}_JSON =`;
  if (markerIndex < 0) {
    marker = `var ${variableName} =`;
    markerIndex = source.indexOf(marker);
  }
  if (markerIndex < 0) throw new Error(`Missing generated ${variableName}.`);
  let start = markerIndex + marker.length;
  while (start < source.length && /\s/.test(source[start])) start++;
  if (source[start] === '"') {
    return JSON.parse(JSON.parse(source.slice(start, readJsonStringEnd(source, start))));
  }
  const end = readJsonValueEnd(source, start);
  return JSON.parse(source.slice(start, end));
}

// --- versioning ------------------------------------------------------------

// Tampermonkey installs an update only when the served @version compares greater than the
// installed one, so the stamp has to move whenever the generated bytes move — and has to stay
// put when they do not, or every rebuild would dirty a committed userscript for no reason.
const VERSION_PLACEHOLDER = '__ZOOPDOG_VERSION__';
const PENDING_VERSION = '0.0.0';
const VERSION_LINE = /^(\/\/ @version[ \t]+)(\S+)([ \t]*)$/m;

/** @param {string} source */
function readUserscriptVersion(source) {
  const match = source.match(VERSION_LINE);
  return match ? match[2] : null;
}

/** @param {string} source @param {string} version */
function setUserscriptVersion(source, version) {
  let seen = 0;
  const output = source.replace(new RegExp(VERSION_LINE.source, 'gm'), (/** @type {string} */ whole, /** @type {string} */ prefix, /** @type {string} */ _old, /** @type {string} */ suffix) => {
    seen += 1;
    return `${prefix}${version}${suffix}`;
  });
  if (seen !== 1) {
    throw new Error(`Userscript must declare @version exactly once, found ${seen}`);
  }
  return output;
}

// Dotted numeric comparison, the subset of Tampermonkey's version ordering these stamps use.
// A missing segment counts as 0, so 2026.09.05.1 sorts above 2026.09.05.
/** @param {string} left @param {string} right */
function compareVersions(left, right) {
  const a = String(left).split('.');
  const b = String(right).split('.');
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const x = Number(a[index] ?? 0);
    const y = Number(b[index] ?? 0);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new Error(`Version segments must be numeric: ${left} vs ${right}`);
    }
    if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

function versionDatestamp(now = new Date()) {
  const pad = (/** @type {unknown} */ value) => String(value).padStart(2, '0');
  return `${now.getFullYear()}.${pad(now.getMonth() + 1)}.${pad(now.getDate())}`;
}

// The build date is the readable stamp; a trailing counter only appears when a date is already
// taken, which keeps a second rebuild on the same day strictly newer than the first.
/** @param {string | null | undefined} previousVersion @param {string} datestamp */
function nextUserscriptVersion(previousVersion, datestamp) {
  if (!previousVersion || compareVersions(datestamp, previousVersion) > 0) {
    return datestamp;
  }
  const segments = previousVersion.split('.');
  if (segments.length > 3 && Number.isInteger(Number(segments[segments.length - 1]))) {
    segments[segments.length - 1] = String(Number(segments[segments.length - 1]) + 1);
    return segments.join('.');
  }
  return `${previousVersion}.1`;
}

// Stamps the rendered userscript and writes it. The draft carries PENDING_VERSION, so the
// comparison against the committed file is a comparison of everything except the stamp.
/** @param {string} targetPath @param {string} draft @param {Date} [now] */
function writeVersionedUserscript(targetPath, draft, now = new Date()) {
  const previous = fs.existsSync(targetPath) ? fs.readFileSync(targetPath, 'utf8') : null;
  const previousVersion = previous ? readUserscriptVersion(previous) : null;
  const changed = !previousVersion ||
    setUserscriptVersion(/** @type {string} */ (previous), PENDING_VERSION) !== setUserscriptVersion(draft, PENDING_VERSION);
  const version = changed
    ? nextUserscriptVersion(previousVersion, versionDatestamp(now))
    : previousVersion;

  // `version` is non-null: either freshly stamped, or the previous file's own version when unchanged.
  fs.writeFileSync(targetPath, setUserscriptVersion(draft, /** @type {string} */ (version)), 'utf8');
  return {version, changed};
}

// Site rules that must not live in this repository (private hosts) are read at build time, for the
// -local userscripts only, from a file outside the repo: `$ZOOPDOG_LOCAL_SITE_RULES`, else
// `../book-translator/zoopdog-site-rules.json` (a sibling checkout). Format:
//   {"rules": [{"host": "<regex source>", "scripts": ["nom-ruby", "cjk-ruby"] (optional),
//               "css": "...", "maxRun": 3, "perWord": true, "mode": "ruby|overlay"}]}
// A missing file means no rules; a malformed one fails the build. The published build always gets [].
/** @param {string} script @param {boolean} local @param {NodeJS.ProcessEnv} [env] */
function readLocalSiteRules(script, local, env = process.env) {
  if (!local) return [];
  const file = env.ZOOPDOG_LOCAL_SITE_RULES || path.resolve(__dirname, '../../../book-translator/zoopdog-site-rules.json');
  if (!fs.existsSync(file)) return [];
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const rules = Array.isArray(data.rules) ? data.rules : [];
  return rules.filter((/** @type {any} */ rule) => {
    if (!rule || typeof rule.host !== 'string') throw new Error(`${file}: every rule needs a host regex string`);
    new RegExp(rule.host);
    return !rule.scripts || rule.scripts.includes(script);
  }).map((/** @type {any} */ {scripts, ...rule}) => rule);
}

module.exports = {
  runtimeDir,
  readLocalSiteRules,
  readRuntime,
  renderRuntime,
  jsonStringLiteral,
  extractAssignedJson,
  VERSION_PLACEHOLDER,
  PENDING_VERSION,
  readUserscriptVersion,
  setUserscriptVersion,
  compareVersions,
  versionDatestamp,
  nextUserscriptVersion,
  writeVersionedUserscript
};
