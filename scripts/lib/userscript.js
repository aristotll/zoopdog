'use strict';

const fs = require('node:fs');
const path = require('node:path');

const runtimeDir = path.resolve(__dirname, '../userscript');

function readRuntime(name) {
  return fs.readFileSync(path.join(runtimeDir, name), 'utf8');
}

// Substitute generated values into an extracted runtime source. Each placeholder must occur
// exactly once: a missing one means the runtime drifted from the builder, and a repeated one
// means the substitution would be ambiguous. Either way the build should fail loudly rather
// than emit a userscript with an unreplaced `__ZOOPDOG_*__` token in it.
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
    throw new Error(`Unreplaced runtime placeholder: ${output.match(/__ZOOPDOG_[A-Z_]+__/)[0]}`);
  }
  return output;
}

module.exports = {
  runtimeDir,
  readRuntime,
  renderRuntime
};
