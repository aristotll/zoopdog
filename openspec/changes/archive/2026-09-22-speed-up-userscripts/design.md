## Context

Baseline measurements (Node 26, committed nom-ruby build, 44,047 entries, 36,282 of them multi-word):

| Cost | Now |
|---|---|
| popup dictionary literal eval (4.98 MB) | ~263 ms (vs ~123 ms as `JSON.parse`) |
| nom-ruby `NOM_MAP` literal eval (1.28 MB) | ~30 ms (vs ~15 ms) |
| trie build | ~64 ms, 134,415 node objects |
| scan 21,200 chars of Vietnamese text | ~49–74 ms |

`zdNomWordMatchesAt` already walks the trie one *word* at a time, joining words with a single `' '` edge, so the character-level structure buys nothing over a word-level index. `findNomMatch` calls `matchAt` at every word start, and `matchAt` re-runs `zdNomRunWords` and the whole DP for the rest of the run.

## Goals / Non-Goals

**Goals:** lower fixed load cost and per-text cost with byte-for-byte identical annotation output; keep one shared engine definition; keep `apply.js` able to read the embedded maps back.

**Non-Goals:** skipping non-Vietnamese pages, lazily parsing the popup dictionary, chunking the first scan, adaptive polling. Each changes observable behavior and needs its own decision.

## Decisions

**Order.** A1 → engine hot path (A3, B1, B2) → DOM side (B3–B6) → A2 last. A2 is the only change to the engine's data structure, so it lands on top of the equivalence tests the earlier steps add.

**A1: `JSON.parse` emission.** The runtime templates keep their placeholder shape (`{"__ZOOPDOG_NOM_MAP__": true}`), so existing tests that render the runtime with a plain object literal keep working. The *builder* substitutes `JSON.parse(<JS string literal>)`, where the literal is `JSON.stringify(JSON.stringify(map))`. That is simultaneously a valid JS string literal and a valid JSON string, so `extractAssignedJson` recognises a leading `JSON.parse(`, reads the string with `readJsonStringEnd`, and parses twice. Object-literal assignments (used by test fixtures) still parse.

**A3: segment once.** Cache one entry keyed by the exact `text` string inside the matcher closure: the run word list and the DP `choice` array for the run containing a given word start. `findNomMatch` looks the start up in the cached run (word index by start offset) or computes the run, and returns `choice[j]` for the first word `j ≥ offset` that has one. This is equivalent to today's per-start recomputation because DP subproblems depend only on the suffix (already stated in `matchAt`'s comment) and every input to `zdNomShouldAnnotateMatch` is read from the full `text`, not from the run. `zdNomBestSegmentation` iterates candidate matches in reverse generation order instead of sorting (lengths are strictly increasing, so it is the same order) and counts `' / '` separators with an `indexOf` loop instead of `split`.

**B1/B2.** `zdNomIsWordChar` uses a code-unit lookup table built once from `ZD_NOM_WORD_CHAR_PATTERN` (the regex stays the single definition; the table is derived from it for code units < 0x250 and U+0300–U+036F, with the regex as fallback above). Lowercasing is done once per word, falling back to per-character lowercasing only when the word contains `İ` or `Σ`, the only characters where whole-string and per-character `toLowerCase` differ.

**A2: word-level index.** `zdNomBuildIndex(map, annotateAsciiTerms)` returns `{terms, prefixes, maxWords}`: `terms` is the term→value lookup (own-property checks, so keys such as `constructor` are safe; ASCII-only terms are dropped when `annotateAsciiTerms === false`), and `prefixes` is a `Set` of every proper word-prefix of each multi-word term. Membership in `terms` or `prefixes` is exactly "the trie has a path at a word boundary", so `zdNomWordMatchesAt` grows the key word by word and stops at the first key in neither, matching the trie's `break`. `canContinuePast` maps whitespace to `' '`, strips one trailing space, and asks whether the result is in `prefixes`, reproducing the trie answer including the double-whitespace edge case. `matcher.trie` is renamed `matcher.index`; nothing outside the tests reads it.

**B3.** After NFC normalisation, `annotateTextNode` returns if `ZD_NOM_WORD_CHAR_PATTERN` finds no word character. Normalisation still happens first so pages keep receiving the same NFC rewrite.

**B4.** For a text node, matches that lie inside it are computed first (pure), then applied as: set the original node's `nodeValue` to the head, build one `DocumentFragment` of `ruby, text, ruby, text…`, and `insertBefore` it once. The original node stays in place holding the head text, exactly as `splitText` leaves it, so the `injections` bookkeeping for self-rewriting pages is unchanged. A match that crosses into following text nodes flushes the batch first, then runs `annotateAcrossNodes` against the last tail node as today.

**B5.** `scanTextNodes` walks children by `firstChild`/`nextSibling`, reading each child's next sibling *before* handling the child, instead of copying `childNodes` into an array per element. A `TreeWalker` was considered and rejected: its `acceptNode` filter is a JS callback per node, which usually costs more than manual sibling links, and collecting nodes up front would change which just-inserted tails a pass visits. Reading the sibling first keeps this script's own ruby/tail insertions out of the pass, as the array snapshot did.

**B6.** `outermostNodes` drops a queued node whose queued ancestor's scan would reach it anyway (an excluded element on the path keeps the node, since the ancestor's scan stops there). After each rescan the runtime calls `observer.takeRecords()` and discards the result: the pass is synchronous, so everything queued since the records were taken at its start is this script's own writes. The one thing those records used to feed back was the text left after a match that spans several wrappers (a new node in a *following* wrapper that no scan has seen), so `annotateAcrossNodes` now queues those tail nodes itself and `rescanTextNodes` drains `newNodes` for up to 8 passes; a test that queues the second wrapper without any record fails if that step is removed.

## Risks / Trade-offs

- Equivalence is the whole risk. Mitigation: a randomized differential test runs the previous trie implementation (kept in the test file as a reference) against the new one over generated text and the real dictionary and asserts identical `findNomMatch` streams and `canContinuePast` answers; existing suites run unchanged.
- Larger generated files: none (strings are the same size). `JSON.parse` of a string escapes `"` and `\` once more, a fraction of a percent.
- B4/B6 are the only DOM-behavior changes; they are checked by the existing streaming/shadow-root runtime tests plus new tests for the resulting child sequence, the retained head node, dropped self-records, and the cross-wrapper tail.
- The user's other tooling reads the generated maps back by pattern; `extractAssignedJson` now understands the `JSON.parse` form and `test/add-chu-nom.test.js` reads generated files through it rather than matching raw text.
