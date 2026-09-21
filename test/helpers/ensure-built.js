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

// vnedict.json and its sidecar are gitignored build output too (published as release assets).
function ensureRuntimeDictionaryBuilt() {
  const targets = ['zd-extension/js/vnedict.json', 'zd-extension/js/vnedict.meta.json'];
  if (targets.every((name) => fs.existsSync(path.join(repoRoot, name)))) {
    return;
  }
  execFileSync(process.execPath, ['scripts/build-extension-vnedict-json.js'], {cwd: repoRoot, stdio: 'pipe'});
}

module.exports = {ensureUserscriptsBuilt, ensureRuntimeDictionaryBuilt};
