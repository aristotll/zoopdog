#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');

// A verification run owns its snapshot and all generated output. Always prepare from sources;
// never seed ignored artifacts from the caller's checkout, so cold and warm runs are equivalent.
function runIsolatedTests({root = path.resolve(__dirname, '..'), tempRoot = os.tmpdir(), run = execFileSync} = {}) {
  const dir = fs.mkdtempSync(path.join(tempRoot, 'zoopdog-test-run-'));
  const excludedRoot = new Set(['.git', '.claude', '.codemoss', '.idea', '.zd-chu-nom-workflow',
    '.DS_Store', 'node_modules', 'dist']);
  try {
    const filter = source => {
      const relative = path.relative(root, source).split(path.sep).join('/');
      const top = relative.split('/')[0];
      if (excludedRoot.has(top)) return false;
      if (/^zoopdog-.*\.user\.js$/.test(relative)) return false;
      if (/^zd-extension\/js\/vnedict(?:\.[^.]+)?\.json$/.test(relative)) return false;
      return true;
    };
    for (const name of fs.readdirSync(root)) {
      const source = path.join(root, name);
      if (filter(source)) fs.cpSync(source, path.join(dir, name), {recursive: true, filter});
    }
    const modules = path.join(root, 'node_modules');
    if (fs.existsSync(modules)) fs.symlinkSync(modules, path.join(dir, 'node_modules'), 'dir');
    const options = {cwd: dir, stdio: 'inherit'};
    for (const script of ['scripts/build-nom-userscript.js', 'scripts/build-popupdict-userscript.js',
      'scripts/build-extension-vnedict-json.js']) {
      run(process.execPath, [script], options);
    }
    const tests = fs.readdirSync(path.join(dir, 'test')).filter(name => name.endsWith('.test.js')).sort()
      .map(name => path.join('test', name));
    run(process.execPath, ['--test', ...tests], options);
    run(process.execPath, ['scripts/minify-userscripts.js'], options);
    run(process.execPath, ['scripts/build-site.js', '--check'], options);
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
}

module.exports = {runIsolatedTests};
if (require.main === module) {
  try { runIsolatedTests(); } catch (error) { console.error(error.message); process.exitCode = error.status || 1; }
}
