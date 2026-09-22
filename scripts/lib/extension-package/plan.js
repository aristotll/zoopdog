'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {PackageError} = require('./errors');
const REVIEWED_INVENTORY = require('./inventory');

function readJson(absolutePath, errorCode) {
  let text;
  try {
    text = fs.readFileSync(absolutePath, 'utf8');
  } catch (error) {
    throw new PackageError(errorCode, `Unable to read ${absolutePath}: ${error.message}`, {path: absolutePath});
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new PackageError(errorCode, `Invalid JSON in ${absolutePath}: ${error.message}`, {path: absolutePath});
  }
}

function readText(absolutePath, errorCode) {
  try {
    return fs.readFileSync(absolutePath, 'utf8');
  } catch (error) {
    throw new PackageError(errorCode, `Unable to read ${absolutePath}: ${error.message}`, {path: absolutePath});
  }
}

function normalizeRelative(relativePath) {
  return relativePath.split(path.sep).join('/');
}

// Follows only intentionally static references: manifest fields, then <script src="...">/
// <link ... href="..."> in referenced HTML, then url(...) in referenced CSS. Anything a page
// fetches dynamically at runtime (chrome.runtime.getURL, XHR/fetch) is deliberately out of
// scope here -- those are declared explicitly as inventory.DYNAMIC_ENTRIES instead, since a
// JS static analyzer can't safely infer every dynamic path.
function collectHtmlReferences(html) {
  const refs = [];
  const scriptPattern = /<script\b[^>]*\bsrc\s*=\s*"([^"]+)"/gi;
  const linkPattern = /<link\b[^>]*\bhref\s*=\s*"([^"]+)"[^>]*>/gi;
  let match;
  while ((match = scriptPattern.exec(html))) {
    refs.push(match[1]);
  }
  while ((match = linkPattern.exec(html))) {
    const tag = match[0];
    if (/\brel\s*=\s*"stylesheet"/i.test(tag)) {
      refs.push(match[1]);
    }
  }
  return refs;
}

function collectCssReferences(css) {
  const refs = [];
  const urlPattern = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;
  let match;
  while ((match = urlPattern.exec(css))) {
    let ref = match[2];
    ref = ref.split('#')[0].split('?')[0];
    if (ref) refs.push(ref);
  }
  return refs;
}

function resolveReference(fromRelativeDir, ref) {
  if (/^[a-z]+:/i.test(ref) || ref.startsWith('//')) {
    return null; // external URL, not a packaged file
  }
  const joined = path.posix.normalize(path.posix.join(fromRelativeDir, ref));
  return joined;
}

function expandManifestResourceEntry(entry, directoryGlobs) {
  if (Object.hasOwn(directoryGlobs, entry)) {
    return {directoryGlob: entry};
  }
  return {file: entry};
}

/**
 * Discover the set of files the current manifest/HTML/CSS reach, validate manifest_version,
 * and validate every reference resolves to a file that exists. Returns the discovered set of
 * package-relative paths (as a Set) plus the parsed manifest.
 */
function discoverReferences(extensionRoot, directoryGlobs) {
  const manifestAbsolute = path.join(extensionRoot, 'manifest.json');
  const manifest = readJson(manifestAbsolute, 'manifest_unreadable');

  if (manifest.manifest_version !== 3) {
    throw new PackageError('manifest_version_unsupported',
      `manifest_version must be 3, found ${manifest.manifest_version}`, {found: manifest.manifest_version});
  }

  const discovered = new Set(['manifest.json']);
  const htmlQueue = [];
  const directoryGlobsUsed = new Set();

  function addFileReference(relativePath, sourceDescription) {
    const absolute = path.join(extensionRoot, relativePath);
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
      throw new PackageError('missing_reference',
        `${sourceDescription} references a missing file: ${relativePath}`,
        {path: relativePath, source: sourceDescription});
    }
    if (!discovered.has(relativePath)) {
      discovered.add(relativePath);
      if (relativePath.endsWith('.html')) htmlQueue.push(relativePath);
    }
  }

  function addManifestResource(entry, sourceDescription) {
    const expanded = expandManifestResourceEntry(entry, directoryGlobs);
    if (expanded.directoryGlob) {
      directoryGlobsUsed.add(expanded.directoryGlob);
      const dirRelative = directoryGlobs[expanded.directoryGlob];
      const dirAbsolute = path.join(extensionRoot, dirRelative);
      let names;
      try {
        names = fs.readdirSync(dirAbsolute).sort();
      } catch (error) {
        throw new PackageError('missing_reference',
          `${sourceDescription} references a missing directory: ${dirRelative}`,
          {path: dirRelative, source: sourceDescription});
      }
      for (const name of names) {
        const relativePath = normalizeRelative(path.join(dirRelative, name));
        if (fs.statSync(path.join(dirAbsolute, name)).isFile()) {
          addFileReference(relativePath, sourceDescription);
        }
      }
      return;
    }
    addFileReference(expanded.file, sourceDescription);
  }

  // Manifest-declared references.
  const icons = manifest.icons || {};
  for (const key of Object.keys(icons)) {
    addFileReference(icons[key], `manifest.icons.${key}`);
  }
  if (manifest.background && manifest.background.service_worker) {
    addFileReference(manifest.background.service_worker, 'manifest.background.service_worker');
  }
  for (const [index, block] of (manifest.content_scripts || []).entries()) {
    for (const js of block.js || []) {
      addFileReference(js, `manifest.content_scripts[${index}].js`);
    }
    for (const css of block.css || []) {
      addFileReference(css, `manifest.content_scripts[${index}].css`);
    }
  }
  for (const page of (manifest.sandbox && manifest.sandbox.pages) || []) {
    addFileReference(page, 'manifest.sandbox.pages');
  }
  for (const [index, block] of (manifest.web_accessible_resources || []).entries()) {
    for (const resource of block.resources || []) {
      addManifestResource(resource, `manifest.web_accessible_resources[${index}].resources`);
    }
  }
  if (manifest.action) {
    const defaultIcon = manifest.action.default_icon || {};
    for (const key of Object.keys(defaultIcon)) {
      addFileReference(defaultIcon[key], `manifest.action.default_icon.${key}`);
    }
    if (manifest.action.default_popup) {
      addFileReference(manifest.action.default_popup, 'manifest.action.default_popup');
    }
  }

  // Transitively follow HTML -> (script/link) and CSS -> url(...) references.
  const cssQueue = [];
  const seenHtml = new Set();
  while (htmlQueue.length) {
    const relativeHtml = htmlQueue.shift();
    if (seenHtml.has(relativeHtml)) continue;
    seenHtml.add(relativeHtml);
    const html = readText(path.join(extensionRoot, relativeHtml), 'html_unreadable');
    const dir = path.posix.dirname(relativeHtml);
    for (const ref of collectHtmlReferences(html)) {
      const resolved = resolveReference(dir, ref);
      if (!resolved) continue;
      addFileReference(resolved, `${relativeHtml} reference`);
      if (resolved.endsWith('.css')) cssQueue.push(resolved);
    }
  }

  const seenCss = new Set();
  while (cssQueue.length) {
    const relativeCss = cssQueue.shift();
    if (seenCss.has(relativeCss)) continue;
    seenCss.add(relativeCss);
    const css = readText(path.join(extensionRoot, relativeCss), 'css_unreadable');
    const dir = path.posix.dirname(relativeCss);
    for (const ref of collectCssReferences(css)) {
      const resolved = resolveReference(dir, ref);
      if (!resolved) continue;
      addFileReference(resolved, `${relativeCss} reference`);
    }
  }

  return {manifest, discovered};
}

/**
 * Build the deterministic package plan: validates references, cross-checks the reviewed
 * inventory, validates dynamic resources exist, and returns the sorted list of
 * `{path, absolutePath}` entries to package plus the parsed manifest.
 *
 * `inventory` defaults to the repository's reviewed inventory (scripts/lib/extension-package/
 * inventory.js) and may be overridden by tests exercising an isolated fixture tree with its
 * own smaller inventory; production callers never pass it.
 */
function buildPlan(extensionRoot, inventory = REVIEWED_INVENTORY) {
  const {STATIC_ENTRIES, DYNAMIC_ENTRIES, DIRECTORY_GLOBS} = inventory;
  const {manifest, discovered} = discoverReferences(extensionRoot, DIRECTORY_GLOBS);

  const discoveredSorted = [...discovered].sort();
  const staticSorted = [...STATIC_ENTRIES].sort();
  const missingFromInventory = discoveredSorted.filter((entryPath) => !STATIC_ENTRIES.includes(entryPath));
  const missingFromDiscovery = staticSorted.filter((entryPath) => !discovered.has(entryPath));
  if (missingFromInventory.length || missingFromDiscovery.length) {
    throw new PackageError('inventory_drift',
      'The reviewed inventory (scripts/lib/extension-package/inventory.js) does not match '
        + 'the files reachable from the current manifest/HTML/CSS.',
      {missingFromInventory, missingFromDiscovery});
  }

  const entries = [];
  for (const relativePath of staticSorted) {
    entries.push({path: relativePath, absolutePath: path.join(extensionRoot, relativePath)});
  }
  for (const relativePath of DYNAMIC_ENTRIES) {
    const absolutePath = path.join(extensionRoot, relativePath);
    if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
      throw new PackageError('missing_dynamic_resource',
        `Dynamic resource is not built: ${relativePath}`, {path: relativePath});
    }
    entries.push({path: relativePath, absolutePath});
  }

  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  return {manifest, entries};
}

module.exports = {
  buildPlan,
  discoverReferences,
  collectHtmlReferences,
  collectCssReferences
};
