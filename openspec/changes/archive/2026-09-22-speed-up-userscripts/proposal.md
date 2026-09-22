## Why

The nom-ruby and popup userscripts have no user-visible performance problem, but they pay a fixed cost on every page load and a superlinear cost on text-heavy pages. Measured on the committed build: the popup dictionary literal (4.98 MB) takes ~263 ms to evaluate versus ~123 ms as `JSON.parse`; the nom-ruby character trie takes ~64 ms and 134,415 heap objects to build even though matching is already word-level; and `findNomMatch` recomputes the whole remaining word run and its DP from every word start, which is quadratic in run length. The hand-maintained Chu Nom entries are almost all multi-word phrases, so the dictionary keeps growing along exactly the axis that makes these costs worse.

## What Changes

- Embed the popup dictionary and the nom-ruby maps as `JSON.parse("…")` string literals instead of object literals, keeping the generated data machine-readable by `scripts/add-chu-nom/apply.js` (A1).
- Segment a word run once per text instead of once per word start, so `findNomMatch` becomes linear in run length; drop the per-call sort and `split(' / ')` allocations (A3).
- Replace the character trie with a word-level term index (a term lookup plus a set of proper word-prefixes) that reproduces the trie's matches and `canContinuePast` answers exactly, removing the ~64 ms build and ~134k objects (A2).
- Hot-path micro-optimisations in the matcher: table-driven word-character test, lowercase once per word instead of once per character (B1, B2).
- DOM-side improvements in the nom-ruby runtime: skip text nodes with no word characters early, batch a node's ruby insertions into one `DocumentFragment` insert, walk with a `TreeWalker` instead of copying `childNodes` per element, and stop rescanning ancestors and this script's own mutations (B3–B6).
- No change to which text is annotated, to candidate ordering, to the DOM structure a page ends up with, or to the popup's results. Behavior-changing ideas (language gating, lazy dictionary parse, chunked first scan, adaptive polling) are explicitly out of scope.

## Capabilities

### New Capabilities
- `userscript-runtime-performance`: how the generated userscripts load their embedded data, how the nom matcher segments text, and how the nom-ruby runtime touches the DOM, with the invariant that output is unchanged.

### Modified Capabilities
<!-- None: no existing requirement changes; behavior is preserved. -->

## Impact

- `scripts/build-nom-userscript.js`, `scripts/build-popupdict-userscript.js`, `scripts/add-chu-nom/apply.js` (reads the embedded maps back).
- `zd-extension/js/zd-nom-match.js` (shared engine; also used by `scripts/nom-inspect.js` and tests) and `scripts/userscript/nom-ruby.runtime.js`.
- Regenerated `zoopdog-nom-ruby.user.js` and `zoopdog-popupdict.user.js` (committed); `-local` variants are gitignored.
- `test/zd-nom-match.test.js`, `test/nom-ruby-runtime.test.js`, `test/add-chu-nom.test.js`, plus new equivalence and benchmark-guard tests.
- No new dependencies; plain JavaScript, no bundler.
