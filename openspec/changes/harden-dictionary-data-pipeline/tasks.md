## 1. Shared primitives

- [x] 1.1 Create `scripts/lib/fsutil.js` with `atomicWrite`, moved from `scripts/add-chu-nom/fsutil.js`. Already done by an earlier change: `scripts/lib/fsutil.js` exists and `scripts/add-chu-nom/fsutil.js` imports `atomicWrite` from it.
- [x] 1.2 Update `scripts/add-chu-nom/fsutil.js` to import `atomicWrite` from `scripts/lib/fsutil.js` and re-export it, so existing callers and `test/add-chu-nom.test.js` need no changes. Already done (see 1.1).
- [x] 1.3 Add path constants to `scripts/lib/paths.js` for `vnedict.txt`, `zd-extension/db_src/vnedict.json`, and `zd-extension/js/vnedict.json`
- [x] 1.4 Run `make verify` to confirm the add-chu-nom test suite is unaffected by the move

## 2. Port `make_dict.py` to Node.js

- [x] 2.1 Write `scripts/build-extension-dictionary.js`: parse `zd-extension/db_src/vnedict.txt`, split each line into headword/definitions on the first colon only (fixing the `split(":")` data-loss bug), strip `(N)` sense markers, build `{vn, en: [{def, pos}]}` entries, export the transform function(s), and guard CLI execution behind a main-module check
- [x] 2.2 Write output in the same pretty-printed, sorted-key-order JSON format as the current `zd-extension/db_src/vnedict.json`
- [x] 2.3 Add `node:test` coverage: a fixture line with multiple colons preserves every sense; general parsing matches expected entry shape; import performs no I/O
- [x] 2.4 Run the script once; diff its output against the current `zd-extension/db_src/vnedict.json` and confirm the only differences are the intended colon-split fixes
- [x] 2.5 Commit the regenerated `zd-extension/db_src/vnedict.json`

## 3. Generate the extension's runtime dictionary from `vnedict2.json`

- [x] 3.1 Write `scripts/build-extension-vnedict-json.js`: read `zd-extension/db_src/vnedict2.json`, write compact (unindented) JSON to `zd-extension/js/vnedict.json` in the `{vn, en: [{def, pos}]}` shape `background.js` and `popupdict.js` already parse. Already done, and gone further, by the later `harden-popup-dictionary-runtime` change (now archived): the script also emits a `vnedict.meta.json` revision sidecar and folds in hand-maintained Chu Nom entries and display order.
- [x] 3.2 Add a self-check after writing: the output parses as JSON and its entry count is within the same order of magnitude as `vnedict2.json`'s input count; exit non-zero and do not leave a partial file if the check fails. Superseded by a stronger mechanism from the same later change: `validateEntry` rejects malformed output before any write happens, and `publishDictionaryAndMetadata` (added for task 2.5 of `harden-popup-dictionary-runtime`) makes the dictionary+metadata pair failure-atomic, so a failed publish never leaves a partial or mismatched file. An order-of-magnitude *count* check specifically is redundant here: the runtime array is derived directly from parsing `vnedict2.json` itself, so its count cannot silently diverge from the input the way an independently-computed count could.
- [x] 3.3 Add `node:test` coverage using in-memory fixtures, asserting output shape and the self-check's failure path. Covered by `test/popup-runtime.test.js` (builder determinism/shape tests plus the atomic-pair-publish failure tests added for `harden-popup-dictionary-runtime` task 2.5).
- [x] 3.4 Run the script once and commit the regenerated `zd-extension/js/vnedict.json`. `zd-extension/js/vnedict.json` and its `.meta.json` sidecar are gitignored build output (see `docs/build.md`), not committed; `make rebuild-extension-vnedict-json` regenerates them after cloning.

## 4. Harden `merge-mdx-nom-into-vnedict2.js`

- [x] 4.1 Replace the direct `fs.writeFileSync(dictionaryPath, ...)` with `atomicWrite` from `scripts/lib/fsutil.js`
- [x] 4.2 Add a `skippedMalformed` counter incremented whenever an MDX entry's `candidates` value is not a usable array, and include it in the script's printed summary
- [x] 4.3 Add `node:test` coverage: a simulated write failure partway through leaves the fixture target's prior contents unchanged; a malformed `candidates` fixture is reflected in the returned/printed count

## 5. Build wiring & docs

- [x] 5.1 Add a `rebuild-extension-dict` Makefile target that runs `scripts/build-extension-dictionary.js`
- [x] 5.2 Add a `rebuild-extension-vnedict-json` Makefile target that runs `scripts/build-extension-vnedict-json.js`. Already existed (added by `harden-popup-dictionary-runtime`).
- [x] 5.3 Update `docs/dictionary-data.md`: replace the manual "copy the regenerated JSON into the runtime file" instructions with the two new commands, and document running `rebuild-extension-vnedict-json` after the merge script or `add-chu-nom-apply` changes `vnedict2.json`
- [x] 5.4 Update `docs/build.md` to reference the new Makefile targets

## 6. Cleanup & verification

- [x] 6.1 Delete `zd-extension/db_src/make_dict.py`
- [x] 6.2 Run `make verify` (tests + syntax-check across `scripts/`) and confirm it passes
- [x] 6.3 Manually load the unpacked extension, trigger `reload-db`, and confirm dictionary lookups still resolve; separately confirm lookups still work on the website's `popupdict.html` — record this as a deferred/manual verification step in the PR description, since neither surface has automated test coverage (deferred: requires a real Chrome install with the unpacked extension loaded and a browser visit to `popupdict.html`, unavailable in this environment; dictionary read/lookup logic is covered by automated tests) (operator-only)
