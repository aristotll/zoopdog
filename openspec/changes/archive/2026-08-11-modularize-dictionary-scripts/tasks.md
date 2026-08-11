## 1. Baseline and guard rails

- [x] 1.1 Record SHA-256 hashes of `zoopdog-nom-ruby.user.js` and `zoopdog-popupdict.user.js`, and confirm `git status --short` is clean for both.
- [x] 1.2 Add `test/scripts-structure.test.js` asserting the byte-identical rebuild: run both builders into a temporary output location and compare hashes to the committed files.
- [x] 1.3 Run `node --test test/` and record the passing baseline.

## 2. Shared library

- [x] 2.1 Create `scripts/lib/text.js` with `cleanText(value, options)` supporting `{stripNul}`, plus `normalizeTerm` and `foldAccents`.
- [x] 2.2 Create `scripts/lib/cjk.js` with the CJK patterns, `extractNomCandidates(text, options)` supporting `{requireCjk, stripParentheticals, separators}`, and `isEmbeddableTerm`.
- [x] 2.3 Create `scripts/lib/paths.js` exporting `rootDir` and every dictionary and generated-userscript path constant.
- [x] 2.4 Create `scripts/lib/sources.js` with `readJson`, `readMdxEntries` (the `payload.entries || payload` accessor), and `definitionKey`.
- [x] 2.5 Add unit tests for each library module covering the option sets, including the `stripNul` variant and each extractor option combination in use today.

## 3. Migrate consumers, one at a time

- [x] 3.1 Point `scripts/user-nom-entries.js` at `lib/text.js` and re-export `cleanText`/`normalizeTerm` so its public surface is unchanged; run the full suite.
- [x] 3.2 Migrate `scripts/build-nom-userscript.js` to the library, choosing the option set that reproduces its current extraction exactly; rebuild and confirm the hash from task 1.1.
- [x] 3.3 Migrate `scripts/build-popupdict-userscript.js` the same way; rebuild and confirm its hash.
- [x] 3.4 Delete the private `cleanText`/`normalizeTerm` from `scripts/merge-mdx-nom-into-vnedict2.js` and migrate `cjkTokens` to the shared extractor with matching options.
- [x] 3.5 Delete the private `cleanText`/`normalizeTerm` from `scripts/extract-mdx-nom-data.js`, passing `{stripNul: true}`, and migrate its candidate extraction.
- [x] 3.6 Replace `scripts/add-chu-nom.js`'s private CJK patterns, `extractNomCandidates`, and hard-coded `zd-extension/db_src/...` literals (all three sites) with library imports; run `test/add-chu-nom.test.js` unmodified.
- [x] 3.7 Confirm both generated userscripts still match the task 1.1 hashes.

## 4. Entry guards and exports

- [x] 4.1 Move `scripts/build-nom-userscript.js`'s top-level statements into `main()`, export `buildNomMap`, `mergeExtractedNomMap`, and `isEmbeddableTerm`, and add a `require.main` guard.
- [x] 4.2 Do the same for `scripts/build-popupdict-userscript.js`, exporting `buildDictionary` and `readRuntimeSources`.
- [x] 4.3 Do the same for `scripts/merge-mdx-nom-into-vnedict2.js`, exporting `insertNomDefinitions`, `dedupeDefinitions`, and the merge transform.
- [x] 4.4 Do the same for `scripts/extract-mdx-nom-data.js`, exporting `stripHtml`, `isVietnameseKey`, `extractCandidates`, and `addEntry`, and keep the `js-mdict` load lazy so importing the module does not require the dependency.
- [x] 4.5 Add a test asserting that importing each script writes no file and spawns no process.
- [x] 4.6 Run each script from the command line and confirm identical console output and file effects to the baseline.

## 5. Extract the userscript runtime

- [x] 5.1 Define the `__ZOOPDOG_*__` placeholder convention and add a builder assertion that each placeholder is replaced exactly once, failing the build otherwise.
- [x] 5.2 Extract `build-nom-userscript.js:106-415` into `scripts/userscript/nom-ruby.runtime.js`, unescaping every doubled backslash; rebuild and confirm the hash.
- [x] 5.3 Extract `build-popupdict-userscript.js:92-295` into `scripts/userscript/popupdict.css`; rebuild and confirm the hash.
- [x] 5.4 Extract `build-popupdict-userscript.js:297-929` into `scripts/userscript/popupdict.runtime.js`, unescaping every doubled backslash; rebuild and confirm the hash.
- [x] 5.5 Add a test asserting neither builder file contains an inlined `// ==UserScript==` header.
- [x] 5.6 Add a test that editing a runtime source changes the corresponding generated userscript and nothing else.

## 6. Tests for previously untested scripts

- [x] 6.1 Add `test/merge-mdx-nom.test.js` covering Nom-before-English insertion order, duplicate removal, and creation of entries missing from the dictionary, using in-memory fixtures.
- [x] 6.2 Add `test/extract-mdx-nom.test.js` covering HTML stripping, Vietnamese key filtering, headword-prefix removal, and the two-character minimum, with no `js-mdict` import.
- [x] 6.3 Add a test that running the extractor from the command line without `js-mdict` still prints the documented installation guidance and exits non-zero.

## 7. Anti-duplication enforcement

- [x] 7.1 Add assertions that no file under `scripts/` outside `lib/` declares `cleanText` or `normalizeTerm`.
- [x] 7.2 Add an assertion that the CJK code-point range literal appears only in `scripts/lib/cjk.js`.
- [x] 7.3 Add an assertion that every file under `scripts/` has a `require.main` guard, and make each failure name the offending file and pattern.

## 8. Verification and documentation

- [x] 8.1 Replace the hard-coded `node --check` list in the Makefile with an enumeration over `scripts/**/*.js` and `scripts/userscript/*.js`.
- [x] 8.2 Extend the verification target to run every suite under `test/`, and keep `verify-add-chu-nom` working as an alias so the existing Makefile contract test passes.
- [x] 8.3 Add `scripts/lib/` and `scripts/userscript/` to the Important Paths section of `AGENTS.md`, noting that the userscript runtime is edited there and never in the builders.
- [x] 8.4 Run the full verification target and confirm every suite passes and every script file is syntax-checked.
- [x] 8.5 Confirm both generated userscripts match the task 1.1 hashes and that `git status --short` shows no change to either, then review the final diff for any file outside `scripts/`, `test/`, `Makefile`, and `AGENTS.md`.
