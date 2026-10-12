## Why

chunom.org's standard-character list is folded into the dictionary builds in memory (generated, gitignored `chunom_standard.json`). The first implementation works but parses the payload twice per build, derives its path in two places, couples `user-nom-order.js` to the chunom layer, and has soft edges in the importer and release script.

## What Changes

- Document the layer's precedence: chunom < dictionaries < the user's entries and order.
- Read `chunom_standard.json` once per build and pass the payload to both the merge and the order step.
- Move `readNomOrder` out of `user-nom-order.js` into `chunom-standard-layer.js`; `user-nom-order.js` stays pure.
- Drop the unused merge statistics.
- Importer: request timeout, redirect following, stricter completeness check.
- Release script: warn when the userscripts were built with chunom but the data file is missing.
- Tests build their chunom fixture in a temp root instead of reading the real gitignored file.

## Capabilities

### New Capabilities
- `chunom-standard-layer`: how chunom.org's standard characters join the dictionary builds and how they are imported and released.

### Modified Capabilities

## Impact

`scripts/chunom-standard-layer.js`, `scripts/user-nom-order.js`, `scripts/import-chunom-standard.js`, `scripts/release-userscripts.js`, the three builders, `test/chunom-standard.test.js`, `docs/chunom-standard.md`.
