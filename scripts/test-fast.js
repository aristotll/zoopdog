#!/usr/bin/env node
'use strict';

// Runs, directly in this checkout, the test files that need no built artifact. Unlike
// `make verify` (scripts/test-isolated.js) it makes no temporary copy and rebuilds nothing, so it
// answers in a few seconds; it is a development shortcut, not a replacement for `make verify`.
//
// A test file is skipped when it depends on gitignored build output: it uses the ensure-built or
// real-build-copy helpers, or names a built userscript (`nomUserscript`, `popupLocalUserscript`,
// ...) or the built runtime dictionary (`runtimeDictionary`) from scripts/lib/paths.js. Everything
// else runs against the tracked sources only. Run in a checkout with no build output, as CI does,
// to confirm the selection (docs/build.md).

const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

const NEEDS_BUILD = /ensure-built|real-build-copy|\b(?:nom|popup)(?:Local)?Userscript\b|\bruntimeDictionary\b/;

function selectFastTests(testDir) {
  const all = fs.readdirSync(testDir).filter((name) => name.endsWith('.test.js')).sort();
  const fast = [];
  const skipped = [];
  for (const name of all) {
    (NEEDS_BUILD.test(fs.readFileSync(path.join(testDir, name), 'utf8')) ? skipped : fast).push(name);
  }
  return {fast, skipped};
}

function main() {
  const root = path.resolve(__dirname, '..');
  const {fast, skipped} = selectFastTests(path.join(root, 'test'));
  const started = Date.now();
  const result = spawnSync(process.execPath, ['--test', ...fast.map((name) => path.join('test', name))],
    {cwd: root, stdio: 'inherit'});
  console.log(`test-fast: ran ${fast.length} test files in ${((Date.now() - started) / 1000).toFixed(1)} s; ` +
    `skipped ${skipped.length} that need built artifacts (${skipped.join(', ')})`);
  return result.status === null ? 1 : result.status;
}

module.exports = {selectFastTests, NEEDS_BUILD};

if (require.main === module) {
  process.exitCode = main();
}
