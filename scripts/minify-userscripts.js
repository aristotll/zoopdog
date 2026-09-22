#!/usr/bin/env node

// Minifies the readable github-hosted userscripts at the repository root into dist/
// (`make minify-userscripts`). Kept apart from the builders so they never depend on esbuild;
// the (Local) builds are never minified because they are installed from disk, where size costs
// nothing and readability helps.

'use strict';

const repoPaths = require('./lib/paths');
const {writeMinifiedUserscript} = require('./lib/minify');

function main() {
  for (const key of ['nomUserscript', 'popupUserscript']) {
    const distFile = repoPaths.distPath(key);
    const {before, after} = writeMinifiedUserscript(repoPaths.absolute[key], distFile);
    console.log(`Minified ${distFile} (${before} -> ${after} bytes)`);
  }
}

module.exports = {main};

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
