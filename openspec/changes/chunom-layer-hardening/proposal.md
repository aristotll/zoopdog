## Why

The code review of the chunom standard layer (archived change `2026-10-12-chunom-standard-layer`) found one correctness bug in the order layer: a `caseSensitive` surname row (`Triệu`, `Dương`, `Mã`, `Nho`, `Lý`) silently cancels chunom's standard order for the ordinary lowercase word. It also found three robustness gaps: the local watcher ignores the file, the payload is never validated, and empty terms are not skipped. On the maintainability side, the same merge loop and key index exist three times and the same fold sequence is copied into all three builders. On performance, every builder lowercases all 76,178 headwords several times with `toLocaleLowerCase('vi-VN')`, which is 6x slower than `toLowerCase()` and gives the same keys.

## What Changes

- Order layer: only casefolded user order rows and user entries exclude a chunom order row. A `caseSensitive` row speaks only for its exact spelling, so it no longer suppresses chunom's row for the casefolded word.
- `chunom_standard.json` is validated on read: `entries` must be an object of string arrays, and `standard`/`meanings` must be absent or the same shape. A bad file throws an error that names the file and the offending key.
- The merge skips a term whose normalized key is empty or whose Nom forms clean to nothing, the same way the mdx merge does.
- One shared helper module (`scripts/lib/nom-merge.js`): `indexEntriesByKey(entries)` and `mergeNomFormsIntoEntries(entries, termToForms, {extraDefsFor})`. It is used by `merge-mdx-nom-into-vnedict2.js`, the chunom layer, and (indexing only) `mergeUserNomEntriesIntoEntries`.
- The redundant `dedupeDefinitions` call after `insertNomDefinitions` in the chunom merge is removed.
- One builder entry point, `loadChunomLayer({chunomPath, orderPath, userEntries})`. It returns `{fold(entries), orderRows, userOrderRows, chunomOrderRows}`. The three builders call it once, and their returned/logged `userNomOrder` is the user's own rows again, with chunom's rows counted separately in the log.
- `normalizeTerm` lowercases with `toLowerCase()` instead of `toLocaleLowerCase('vi-VN')`. Keys stay byte-identical (Vietnamese has no locale-specific case mapping, and there are 0 differences on vnedict2.json), and the pass is about 6x faster.
- `watch-local-userscripts.js` hashes `chunom_standard.json` (present or absent) with the other inputs.
- `make import-chunom-standard` (`FILE=…` for a saved copy, otherwise `--fetch`), with the doc pointing at it.
- Tests: the duplicate idempotence test and unused imports are removed. New tests cover `caseSensitive` interplay, a malformed payload, empty terms, the watcher hash, and the shared merge helper.

## Capabilities

### New Capabilities

### Modified Capabilities
- `chunom-standard-layer`: the user exclusion is scoped to casefolded rows. Adds payload validation, the empty-term skip, the single loader entry point with separate chunom/user order accounting, the watcher input, and a Makefile entry point.
- `dictionary-entry-identity`: the canonical normalization lowercases with plain Unicode lowercasing rather than a locale-specific call (same keys, faster).

## Impact

- Code: `scripts/chunom-standard-layer.js`, new `scripts/lib/nom-merge.js`, `scripts/merge-mdx-nom-into-vnedict2.js`, `scripts/build-extension-vnedict-json.js`, `scripts/build-nom-userscript.js`, `scripts/build-popupdict-userscript.js`, `scripts/watch-local-userscripts.js`, `scripts/lib/text.js`, `Makefile`.
- Tests: `test/chunom-standard.test.js`, plus a watcher test and a normalization-equivalence test.
- Docs: `docs/chunom-standard.md`.
- Generated output: the userscripts and `vnedict.json` change only where a `caseSensitive` row was suppressing chunom's order and no casefolded user row already covers the word. With today's data that is `nho` alone (now `儒` first); `triệu`, `dương`, `mã`, `lý` have their own lowercase rows. Everything else stays byte-identical.
- No change to `vnedict2.json`, user files, or the book-translator contract. book-translator's `scripts/reader/nom_order.py` already scopes `caseSensitive` correctly; it only gains a regression test.
