## 1. Baseline

- [x] 1.1 Record candidate 0 for `triệu`, `dương`, `mã`, `nho`, `lý`, `được`, `một` with `scripts/nom-inspect.js` (and the popup dictionary) before any change
- [x] 1.2 Snapshot `vnedict.json` revision and both userscripts' embedded maps so later steps can prove byte-identity outside the intended terms

## 2. Normalization speed-up

- [x] 2.1 Add a test asserting `toLowerCase()` and `toLocaleLowerCase('vi-VN')` normalize every `vnedict2.json` headword and user-shard `vi` to the same key
- [x] 2.2 Switch `normalizeTerm` in `scripts/lib/text.js` to `toLowerCase()`; update its comment
- [x] 2.3 Rebuild and confirm outputs are byte-identical to the 1.2 snapshot; record build timings before/after

## 3. Shared Nom-form merge

- [x] 3.1 Create `scripts/lib/nom-merge.js` with `indexEntriesByKey`, `insertNomDefinitions`, `dedupeDefinitions`, `mergeNomFormsIntoEntries` (guards: non-array → malformed count, empty key / no forms → skip)
- [x] 3.2 Make `merge-mdx-nom-into-vnedict2.js` `main` call it; re-export `insertNomDefinitions`/`dedupeDefinitions`; keep its log lines
- [x] 3.3 Make `mergeUserNomEntriesIntoEntries` use `indexEntriesByKey`
- [x] 3.4 Rewrite `mergeChunomIntoEntries` as a call to `mergeNomFormsIntoEntries` with `extraDefsFor` = chunom meanings; drop the `dedupeDefinitions` call
- [x] 3.5 Test: the same forms map merged via the mdx path and the chunom path gives identical `en`; blank-forms term creates no entry; empty key skipped

## 4. Payload validation

- [x] 4.1 Validate `entries` (required) and `standard`/`meanings` (optional) as objects of string arrays in `readChunomStandard`; error names the path and the key
- [x] 4.2 Tests: missing `entries`, string instead of array, valid file passes

## 5. Loader and case-sensitive scoping

- [x] 5.1 Exclude only non-`caseSensitive` user order rows (plus user entries) from chunom order rows
- [x] 5.2 Add `loadChunomLayer({chunomPath, orderPath, userEntries})` returning `{payload, fold, userOrderRows, chunomOrderRows, orderRows}`
- [x] 5.3 Switch the three builders to one `loadChunomLayer` call; return/log `userNomOrder` as the user's rows and log chunom's row count separately
- [x] 5.4 Tests: `Triệu` caseSensitive row keeps `兆` first for `triệu` and `趙` for exact `Triệu` in the case-sensitive map; user row count excludes chunom rows
- [x] 5.5 Remove the duplicate idempotence test, the unused `repoPaths` import and the double `readNomOrder` import in `test/chunom-standard.test.js`

## 6. Watcher and Makefile

- [x] 6.1 Hash `chunom_standard.json` (content or an absent marker) in `watch-local-userscripts.js` `computeInputsHash`; test create/change/delete changes the hash
- [x] 6.2 Add `make import-chunom-standard` (`FILE=` → `--file`, else `--fetch`)

## 7. Docs and verification

- [x] 7.1 Update `docs/chunom-standard.md`: the `make` entry point, case-sensitive scoping, the watcher, validation errors
- [x] 7.2 Check `~/mine/book-translator` `scripts/reader/nom_order.py`: it already scopes `caseSensitive` correctly (skips those rows, last row wins); add a regression test there
- [x] 7.3 Rebuild (`make rebuild-userscripts rebuild-extension-vnedict-json`), diff against 1.1/1.2: only `nho` changes (the other four have casefolded user rows)
- [x] 7.4 Run `make verify` and `make check-openspec`
