#!/usr/bin/env node

// Builds the CJK Ruby userscript (Jyutping + katakana, replacing the separate Jyutping and Katakana Terminator scripts) in its two variants, like the nom-ruby and popup
// builders: the github-hosted release build (updates from the latest GitHub Release) and the
// never-committed (Local) build that updates from its own file on this machine
// (`--local-only`, see docs/build.md). The source is scripts/userscript/cjk-ruby.runtime.js.

'use strict';

const repoPaths = require('./lib/paths');
const {
  readRuntime,
  renderRuntime,
  PENDING_VERSION,
  writeVersionedUserscript
} = require('./lib/userscript');

const VARIANTS = [
  {targetKey: 'cjkRubyUserscript', nameSuffix: '', localMode: false},
  {targetKey: 'cjkRubyLocalUserscript', nameSuffix: ' (Local)', localMode: true}
];

function buildUserscript(variant) {
  const updateUrl = variant.localMode
    ? repoPaths.localFileUrl(variant.targetKey)
    : repoPaths.releaseUrl(variant.targetKey);

  // The suffix decorates every localized @name, so it legitimately occurs more than once.
  const source = readRuntime('cjk-ruby.runtime.js')
    .split('__ZOOPDOG_NAME_SUFFIX__').join(variant.nameSuffix);

  return renderRuntime(source, {
    '__ZOOPDOG_UPDATE_URL__': updateUrl,
    '__ZOOPDOG_DOWNLOAD_URL__': updateUrl,
    '__ZOOPDOG_VERSION__': PENDING_VERSION
  });
}

function main(argv = process.argv.slice(2)) {
  const variants = argv.includes('--local-only')
    ? VARIANTS.filter((variant) => variant.localMode)
    : VARIANTS;

  for (const variant of variants) {
    const targetPath = repoPaths.absolute[variant.targetKey];
    const {version, changed} = writeVersionedUserscript(targetPath, buildUserscript(variant));
    console.log(`Wrote ${targetPath}`);
    console.log(`Version ${version}${changed ? ' (content changed)' : ' (unchanged)'}`);
  }
}

module.exports = {VARIANTS, buildUserscript, main};

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
