## 1. Shared primitives

- [ ] 1.1 Create `scripts/lib/fsutil.js` with `atomicWrite`, moved from `scripts/add-chu-nom/fsutil.js`
- [ ] 1.2 Update `scripts/add-chu-nom/fsutil.js` to import `atomicWrite` from `scripts/lib/fsutil.js` and re-export it, so existing callers and `test/add-chu-nom.test.js` need no changes
- [ ] 1.3 Add path constants to `scripts/lib/paths.js` for `vnedict.txt`, `zd-extension/db_src/vnedict.json`, and `zd-extension/js/vnedict.json`
- [ ] 1.4 Run `make verify` to confirm the add-chu-nom test suite is unaffected by the move

## 2. Port `make_dict.py` to Node.js

- [ ] 2.1 Write `scripts/build-extension-dictionary.js`: parse `zd-extension/db_src/vnedict.txt`, split each line into headword/definitions on the first colon only (fixing the `split(":")` data-loss bug), strip `(N)` sense markers, build `{vn, en: [{def, pos}]}` entries, export the transform function(s), and guard CLI execution behind a main-module check
- [ ] 2.2 Write output in the same pretty-printed, sorted-key-order JSON format as the current `zd-extension/db_src/vnedict.json`
- [ ] 2.3 Add `node:test` coverage: a fixture line with multiple colons preserves every sense; general parsing matches expected entry shape; import performs no I/O
- [ ] 2.4 Run the script once; diff its output against the current `zd-extension/db_src/vnedict.json` and confirm the only differences are the intended colon-split fixes
- [ ] 2.5 Commit the regenerated `zd-extension/db_src/vnedict.json`

## 3. Generate the extension's runtime dictionary from `vnedict2.json`

- [ ] 3.1 Write `scripts/build-extension-vnedict-json.js`: read `zd-extension/db_src/vnedict2.json`, write compact (unindented) JSON to `zd-extension/js/vnedict.json` in the `{vn, en: [{def, pos}]}` shape `background.js` and `popupdict.js` already parse
- [ ] 3.2 Add a self-check after writing: the output parses as JSON and its entry count is within the same order of magnitude as `vnedict2.json`'s input count; exit non-zero and do not leave a partial file if the check fails
- [ ] 3.3 Add `node:test` coverage using in-memory fixtures, asserting output shape and the self-check's failure path
- [ ] 3.4 Run the script once and commit the regenerated `zd-extension/js/vnedict.json`

## 4. Harden `merge-mdx-nom-into-vnedict2.js`

- [ ] 4.1 Replace the direct `fs.writeFileSync(dictionaryPath, ...)` with `atomicWrite` from `scripts/lib/fsutil.js`
- [ ] 4.2 Add a `skippedMalformed` counter incremented whenever an MDX entry's `candidates` value is not a usable array, and include it in the script's printed summary
- [ ] 4.3 Add `node:test` coverage: a simulated write failure partway through leaves the fixture target's prior contents unchanged; a malformed `candidates` fixture is reflected in the returned/printed count

## 5. Build wiring & docs

- [ ] 5.1 Add a `rebuild-extension-dict` Makefile target that runs `scripts/build-extension-dictionary.js`
- [ ] 5.2 Add a `rebuild-extension-vnedict-json` Makefile target that runs `scripts/build-extension-vnedict-json.js`
- [ ] 5.3 Update `docs/dictionary-data.md`: replace the manual "copy the regenerated JSON into the runtime file" instructions with the two new commands, and document running `rebuild-extension-vnedict-json` after the merge script or `add-chu-nom-apply` changes `vnedict2.json`
- [ ] 5.4 Update `docs/build.md` to reference the new Makefile targets

## 6. Cleanup & verification

- [ ] 6.1 Delete `zd-extension/db_src/make_dict.py`
- [ ] 6.2 Run `make verify` (tests + syntax-check across `scripts/`) and confirm it passes
- [ ] 6.3 Manually load the unpacked extension, trigger `reload-db`, and confirm dictionary lookups still resolve; separately confirm lookups still work on the website's `popupdict.html` — record this as a deferred/manual verification step in the PR description, since neither surface has automated test coverage
