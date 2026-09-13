'use strict';

// A throwaway repo copy for tests that must run the *real* nom/popupdict builders against
// today's *real* dictionary and runtime sources (to prove the committed userscripts are still
// reproducible, or that an edit to a runtime source reaches them) without ever writing to the
// actual repository. `scripts/lib/paths.js` resolves every path from its own `__dirname`, not
// `process.cwd()`, so only a copy of `scripts/` run from inside the returned directory (never
// the real `scripts/`, even with `cwd` pointed elsewhere) resolves relative to it.
//
// This is deliberately not `makeFixture` in test/add-chu-nom.test.js, which substitutes small
// synthetic dictionary data and stub runtime files for tests that don't care about real
// content -- these tests specifically need the real content.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Real dictionary/runtime inputs the builders only ever read -- symlinked rather than copied
// so this stays cheap (vnedict2.json and the CSV shards are sizable) and can never itself
// become a second copy that drifts from the real data.
const READ_ONLY_INPUTS = [
  'zd-extension/db_src/vnedict2.json',
  'zd-extension/db_src/mdx_nom.json',
  'zd-extension/db_src/user_nom_order.jsonc',
  'zd-extension/db_src/user_nom_entries',
  'zd-extension/js/zd-nom-match.js',
  'zd-extension/js/zd-words.js',
  'zd-extension/js/zd-pron-data.js',
  'zd-extension/js/zd-pron-functions.js',
  'zd-extension/js/zd-pron-drawtones.js',
  'zd-extension/js/lib/chroma.min.js'
];

// `t` is a node:test TestContext (its `.after` cleans the copy up); `repoRoot` is the real
// repository root. Returns the path to the isolated copy.
function makeRealBuildCopy(t, repoRoot) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zoopdog-build-copy-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));

  fs.cpSync(path.join(repoRoot, 'scripts'), path.join(dir, 'scripts'), {recursive: true});

  for (const relative of READ_ONLY_INPUTS) {
    const target = path.join(dir, relative);
    fs.mkdirSync(path.dirname(target), {recursive: true});
    fs.symlinkSync(path.join(repoRoot, relative), target);
  }

  return dir;
}

module.exports = {makeRealBuildCopy};
