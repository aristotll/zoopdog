## Context

The chunom layer (`scripts/chunom-standard-layer.js`) folds chunom.org's standard characters into three builders in memory. A review at xhigh effort found:

- `readNomOrder` puts every user order row's casefolded `key` into the exclusion set. That includes `caseSensitive` rows, which `buildNomOrderIndex` never applies to casefolded consumers. With the real data, `Triệu/Dương/Mã/Nho/Lý` suppress chunom's `兆/洋/馬/儒/李` for the lowercase words.
- `mergeChunomIntoEntries` copies the index-and-merge loop of `merge-mdx-nom-into-vnedict2.js` `main`, but without its malformed/empty guards. `mergeUserNomEntriesIntoEntries` builds the same index a third time.
- Every builder copies the same three steps (read → fold → order), and `userNomOrder` now silently includes about 730 chunom rows in returns and logs.
- `normalizeTerm` uses `toLocaleLowerCase('vi-VN')`: 151 ms per full pass of the 76,178 headwords, against 25 ms for `toLowerCase()`, with 0 differing keys. The extension build runs it at least 4 times.
- `watch-local-userscripts.js` does not hash the new input. The importer has no `make` target.

## Goals / Non-Goals

**Goals:**
- Fix the `caseSensitive` exclusion bug. Generated output may change only for the affected lowercase terms.
- One implementation of the "fold term → forms into entries" rule and of the entry key index.
- One loader call per builder, with honest accounting of user rows vs chunom rows.
- Faster builds through cheaper normalization, without changing any key.
- Fail loudly on a malformed `chunom_standard.json`.

**Non-Goals:**
- Changing precedence, the payload format, or the importer's network behaviour.
- Folding mdx_nom.json differently in the nom-ruby builder (`mergeExtractedNomMap` works on the joined map, not on entries, and stays as is).
- Merging `mergeUserNomEntriesIntoEntries`'s hoisting semantics into the shared helper. User entries lead, while chunom/mdx forms go behind, so only the index is shared.
- Changing book-translator in this change (follow-up there for the same `caseSensitive` scoping).

## Decisions

1. **Exclusion set = user entries + non-`caseSensitive` order rows.** `readNomOrder` (renamed into the loader) builds `spoken` from `userRows.filter((row) => !row.caseSensitive)`. A case-sensitive row is applied only by `buildCaseSensitiveNomMap` for its exact spelling, so the casefolded term is still chunom's to order. Alternative considered: exclude chunom for the exact spelling only. That is not expressible, because chunom rows are casefolded and the case-sensitive map is built from the hoisted map, so it already wins for `Triệu`.

2. **`scripts/lib/nom-merge.js`** holds two functions:
   - `indexEntriesByKey(entries)`: a `Map<normalizedKey, entry[]>` that skips empty keys.
   - `mergeNomFormsIntoEntries(entries, termToForms, {index, extraDefsFor})`: the mdx `main` loop with its guards (non-array → counted as malformed, empty key or no forms → skipped). Existing entries go through `insertNomDefinitions`, and a new entry gets the forms plus `extraDefsFor(term)`. It returns `{updatedEntries, addedDefinitions, createdEntries, skippedMalformed}` so the mdx script keeps its log lines.

   `insertNomDefinitions`/`dedupeDefinitions` move into this lib, and `merge-mdx-nom-into-vnedict2.js` re-exports them for existing importers/tests. `mergeChunomIntoEntries` becomes a thin call with `extraDefsFor = (term) => payload.meanings[term]`. Alternative considered: keep the chunom loop and add the guards. Rejected because it leaves two copies that drift (the drift is how the guards were lost).

3. **Drop the extra `dedupeDefinitions`** in the chunom fold. `insertNomDefinitions` never inserts a seen def, so the call only touched unrelated base duplicates in chunom-covered entries. The mdx script keeps its global pre-pass dedupe, because that is a write-back tool with different intent.

4. **`loadChunomLayer({chunomPath, orderPath, userEntries})`** returns `{payload, fold(entries), userOrderRows, chunomOrderRows, orderRows}`, where `orderRows = [...chunomOrderRows, ...userOrderRows]`. The builders call it once, fold, and apply `orderRows`. They return/log `userNomOrder = userOrderRows` and log `chunomOrderRows.length` separately. `readNomOrder` and `readChunomStandard` stay exported for tests and book-translator parity. Alternative considered: a mutable "layer stack" abstraction. Rejected as over-built for two layers.

5. **Validation in `readChunomStandard`**: a small hand-written check (no schema library, per the plain-JS rule). `entries` is required, `standard`/`meanings` are optional, and every value must be an array of strings. The error is ``${path}: chunom payload `${field}["${key}"]` must be an array of strings``.

6. **`normalizeTerm` uses `toLowerCase()`.** Unicode default lowercasing differs from `vi-VN` only for locale-tailored letters (Turkish/Azeri dotted I, Lithuanian), and none of these occur in Vietnamese. A test asserts equality over all of `vnedict2.json` and the user shards, so a future data change that would diverge fails CI. The browser runtime's `toLocaleLowerCase('vi-VN')` in `popupdict.runtime.js` is left alone (not a hot path, so not worth touching). Alternative considered: memoize `normalizeTerm` per string. Rejected because a 76k-entry Map costs memory and still pays the slow path once.

7. **Watcher** hashes `chunom_standard.json` content when present, and a fixed `chunom_standard.json\0absent` marker when absent, so deleting the file (the documented way to revert the order) also triggers a rebuild.

8. **Makefile**: `import-chunom-standard:` runs `$(NODE) scripts/import-chunom-standard.js $(if $(FILE),--file $(FILE),--fetch)`.

## Risks / Trade-offs

- [Generated userscripts change for 5 lowercase terms] → This is intended. The task list includes a before/after diff of candidate 0 via `scripts/nom-inspect.js` for those terms.
- [`toLowerCase` diverges for some future input] → The equivalence test over the real data fails first, and the spec scenario documents why it is safe.
- [Moving `insertNomDefinitions` breaks importers] → Re-export it from the old module. A grep of `test/` and `scripts/` confirms the callers.
- [Validation rejects a payload an older importer wrote] → The importer always wrote arrays, and the error names the file and tells the user to re-run `make import-chunom-standard`.

## Migration Plan

No data migration. Rebuild with `make rebuild-userscripts rebuild-extension-vnedict-json`. Rollback is reverting the commit.

## Open Questions

None. book-translator's `scripts/reader/nom_order.py` was checked: it already scopes `caseSensitive` correctly and only gains a regression test.
