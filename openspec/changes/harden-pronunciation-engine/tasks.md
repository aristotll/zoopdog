## 1. Characterization and contracts

- [ ] 1.1 Add an import-safe pronunciation test harness that snapshots representative current outputs for every dialect, tone family, onset, rime, and multiword path.
- [ ] 1.2 Add failing regression fixtures for empty/whitespace input, `0`, `110`, `1010`, unsupported punctuation, implicit globals, prototype mutation, and the minor-vowel branch.
- [ ] 1.3 Document the total core result/diagnostic shape and audit every first-party caller that currently dereferences dialect `.zd` fields.

## 2. Pure pronunciation core

- [ ] 2.1 Extract number parsing and spelling into a side-effect-free CommonJS/browser module with explicit zero and positional tens/hundreds handling.
- [ ] 2.2 Extract word/syllable analysis and dialect pronunciation into pure functions with locally scoped variables and typed branch conditions.
- [ ] 2.3 Implement total empty, whitespace, numeric, punctuation, and unsupported-input results for pronunciation and homophone calls.
- [ ] 2.4 Remove `String.prototype` augmentation, implicit globals, and dead helpers after structural scans confirm no external caller depends on them.

## 3. Lexicon and homophones

- [ ] 3.1 Recover the accepted real-word set into a readable NFC source with documented provenance and deterministic normalization rules.
- [ ] 3.2 Add an importable lexicon builder that emits a byte-stable browser artifact with count and SHA-256 diagnostics.
- [ ] 3.3 Replace repeated array scans with one reusable lookup index and preserve stable homophone candidate ordering.

## 4. Consumer migration

- [ ] 4.1 Update website pronunciation/homophone adapters to render the core contract without assuming missing fields are valid.
- [ ] 4.2 Update extension frame/guide adapters and add a safe fallback for invalid URL fragments.
- [ ] 4.3 Update popup-userscript source assembly to embed only the authoritative core/data and rebuild the committed userscript.
- [ ] 4.4 Regenerate any affected Jade-derived HTML after source script-list changes and verify generated/source parity.

## 5. Verification and documentation

- [ ] 5.1 Add cross-consumer contract, lexicon reproducibility, generated ownership, and tracked-file non-mutation tests to `make verify`.
- [ ] 5.2 Manually verify valid/invalid pronunciation, homophones, guide anchors, the extension frame, and the popup userscript in a browser.
- [ ] 5.3 Document supported numeric grammar, stable error behavior, core/library ownership, lexicon rebuild, and intentional before/after corrections.
- [ ] 5.4 Run `make verify`, rebuild generated artifacts twice, confirm byte stability and a clean expected diff, then validate and reconcile the OpenSpec checklist.

