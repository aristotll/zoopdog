## 1. Baseline and safety net

- [x] 1.1 Add `scripts/bench-nom.js` (not part of `make verify`) that reports userscript literal eval vs `JSON.parse`, matcher build time, and scan time on a fixed Vietnamese sample, (baseline: popup literal eval ≈275 ms, matcher build ≈65 ms, warm scan ≈76 ms, 6000-word run ≈4.7 s)
- [x] 1.2 Copy the current trie implementation into `test/support/reference-nom-trie.js` as the differential reference and add a randomized differential test over generated and real-dictionary text for `findNomMatch` streams and `canContinuePast`

## 2. A1 — JSON.parse emission

- [x] 2.1 Add failing tests: builder output contains `JSON.parse(` for `NOM_MAP`, `CASE_SENSITIVE_NOM_MAP`, `ZOO_DICTIONARY`; `extractAssignedJson` round-trips both the new form and plain object literals
- [x] 2.2 Add a shared `jsonParseLiteral(value)` helper in `scripts/lib/userscript.js`; use it in both builders (runtime placeholders unchanged)
- [x] 2.3 Teach `extractAssignedJson` the `JSON.parse("…")` form using `readJsonStringEnd`
- [x] 2.4 Update `docs/build.md`/`docs/dictionary-data.md` wording where they describe the embedded object literal

## 3. Engine hot path (A3, B1, B2)

- [x] 3.1 Add failing tests: `zdNomRunWords` is called once per run across repeated `findNomMatch` calls; word-char table agrees with the regex for every code unit 0–0xFFFF
- [x] 3.2 B1: table-driven `zdNomIsWordChar` derived from `ZD_NOM_WORD_CHAR_PATTERN`
- [x] 3.3 B2: lowercase once per word with the `İ`/`Σ` per-character fallback
- [x] 3.4 A3: single-entry run/DP cache in `zdCreateNomMatcher`; reverse iteration replaces the sort; `' / '` counting without `split`
- [x] 3.5 Run the differential test and the existing `zd-nom-match` suite unchanged

## 4. DOM side (B3–B6)

- [x] 4.1 Add failing tests: word-char-free nodes are left alone (after NFC), batched insertion equals per-match structure, own mutations do not requeue a parent, queued descendants are dropped when an ancestor is queued
- [x] 4.2 B3: early return in `annotateTextNode`
- [x] 4.3 B4: batch a node's in-node matches into one fragment insert; flush before `annotateAcrossNodes`
- [x] 4.4 B5: sibling-link `scanChildren` instead of `Array.from(childNodes)` (TreeWalker rejected, see design.md), still watching shadow roots
- [x] 4.5 B6: ancestor dedupe in `newNodes`; discard own records after a pass; revert the second half and note it in design.md if a runtime test depends on it

## 5. A2 — word-level index

- [x] 5.1 Add failing tests for `zdNomBuildIndex` (terms, proper word-prefixes, `annotateAsciiTerms === false`, prototype-named keys) and for `canContinuePast` edge cases
- [x] 5.2 Implement `zdNomBuildIndex`; switch `zdNomWordMatchesAt`, `zdNomBestSegmentation`, `canContinuePast` and `zdCreateNomMatcher` to it; remove `zdNomBuildTrie` and rename `matcher.trie` to `matcher.index`; update existing tests' calls
- [x] 5.3 Run the differential test over the real dictionary; confirm zero divergences

## 6. Rebuild and verify

- [x] 6.1 `make rebuild-userscripts` regenerated `zoopdog-nom-ruby.user.js` and `zoopdog-popupdict.user.js` (committing them with the sources is left to the maintainer)
- [x] 6.2 `make verify` passes except `the repository runtime dictionary carries the hand-maintained entries`, which failed before this change too (`zd-extension/js/vnedict.json` predates the uncommitted CSV entries; `make rebuild-extension-vnedict-json` fixes it); `make nom-annotate` / `make nom-popup` spot-checks look right and the differential test proves matcher equivalence
- [x] 6.3 Re-ran the benchmark: matcher build 65 → 0.1 ms, warm scan 76 → 4.5 ms, 6000-word run 4.7 s → 2 ms, popup literal eval 275 → 140 ms
