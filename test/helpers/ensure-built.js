const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');

const repoRoot = path.resolve(__dirname, '../..');

// The readable userscripts at the repository root are gitignored build output (they ship as
// GitHub Release assets), so a fresh clone has none. Tests that inspect them build them first.
function ensureUserscriptsBuilt() {
  const targets = ['zoopdog-nom-ruby.user.js', 'zoopdog-popupdict.user.js'];
  if (targets.every((name) => fs.existsSync(path.join(repoRoot, name)))) {
    return;
  }
  for (const builder of ['scripts/build-nom-userscript.js', 'scripts/build-popupdict-userscript.js']) {
    execFileSync(process.execPath, [builder], {cwd: repoRoot, stdio: 'pipe'});
  }
}

// Newest modification time under `target` (a file or a directory tree), skipping `skipDirs`.
function newestMtimeMs(target, skipDirs = new Set()) {
  const stat = fs.statSync(target);
  if (!stat.isDirectory()) {
    return stat.mtimeMs;
  }
  let newest = stat.mtimeMs;
  for (const entry of fs.readdirSync(target, {withFileTypes: true})) {
    if (entry.isDirectory() && skipDirs.has(entry.name)) {
      continue;
    }
    newest = Math.max(newest, newestMtimeMs(path.join(target, entry.name), skipDirs));
  }
  return newest;
}

// vnedict.json and its sidecar are gitignored build output too (published as release assets).
// Existing is not the same as current: hand-maintained sources (user_nom_entries shards, the
// order file, the base dictionaries) change under an already-built file, and a stale build makes
// dictionary-content tests fail with a misleading "missing entries" diff. So rebuild whenever any
// input is newer than the output, not only when the output is absent.
function ensureRuntimeDictionaryBuilt() {
  const targets = ['zd-extension/js/vnedict.json', 'zd-extension/js/vnedict.meta.json'];
  const outputs = targets.map((name) => path.join(repoRoot, name));
  if (outputs.every((file) => fs.existsSync(file))) {
    const builtAt = Math.min(...outputs.map((file) => fs.statSync(file).mtimeMs));
    const inputs = [
      newestMtimeMs(path.join(repoRoot, 'zd-extension/db_src'), new Set(['fonts'])),
      newestMtimeMs(path.join(repoRoot, 'scripts/build-extension-vnedict-json.js')),
      newestMtimeMs(path.join(repoRoot, 'scripts/lib'))
    ];
    if (Math.max(...inputs) <= builtAt) {
      return;
    }
  }
  execFileSync(process.execPath, ['scripts/build-extension-vnedict-json.js'], {cwd: repoRoot, stdio: 'pipe'});
}

module.exports = {ensureUserscriptsBuilt, ensureRuntimeDictionaryBuilt};
