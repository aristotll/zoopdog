## Context

`zd-extension/js/zd-pron-functions.js` is a 423-line browser script shared directly by website pages, extension frames, and the generated popup userscript. It combines prototype augmentation, number parsing, syllable analysis, IPA rendering, HTML production, and homophone search. It has no behavioral unit suite; only structural loading is checked. Verified probes show malformed result shapes for whitespace and `0`, incorrect `110` spelling, an unreachable minor-vowel branch, and leaked globals.

The repository intentionally uses plain JavaScript with no bundler or runtime dependency. The existing `zd-words.js` CommonJS/browser-global pattern demonstrates how one definition can serve tests and all browser consumers.

## Goals / Non-Goals

**Goals:**

- Make deterministic linguistic operations importable, side-effect-free, and fixture-testable.
- Give every accepted input one documented result shape and every rejected input one stable error/result path.
- Preserve all characterized valid pronunciations while fixing evidenced defects.
- Keep website, extension, and generated userscript behavior derived from the same source.
- Reduce homophone search cost and document how the real-word lexicon is produced.

**Non-Goals:**

- Redesigning the pronunciation UI or changing the supported dialects.
- Replacing the linguistic data tables with an external package or network service.
- Claiming phonetic corrections that lack fixtures or cited project evidence.
- Modernizing unrelated popup dictionary code.

## Decisions

1. **Use one browser/CommonJS core and thin adapters.** Create a dependency-free core that exports explicit functions under CommonJS for tests and one browser namespace for pages. DOM selection, HTML insertion, and drawing remain in page/frame adapters. This follows `zd-words.js` and avoids a bundler. Keeping the current monolith with conditional DOM branches was rejected because it would retain hidden coupling and weak isolation.

2. **Return typed, total results.** Core guide calls return a stable object containing the three dialect keys plus normalized input and status. Empty/whitespace input returns an explicit empty result; unsupported tokens produce a stable diagnostic instead of missing `.zd` properties. Adapters render from that contract and never infer validity from object shape.

3. **Treat number spelling as a separate grammar.** Parse supported integer tokens without coercive truthiness, explicitly handle zero, and generate tens/hundreds by positional rules. Regression fixtures include `0`, `10`, `110`, `1010`, and dialect-sensitive forms. The existing global string-replacement approach was rejected because it changes correct `mười` tokens without positional context.

4. **Characterize before correcting.** Capture representative current outputs for all dialects and tone families, then add narrowly named fixtures for verified corrections, including the minor `ɤ` branch. This prevents the refactor from becoming an unreviewed linguistic rewrite.

5. **Generate and index the real-word lexicon.** Store a readable, provenance-documented source list, generate the compact browser artifact deterministically, and construct a `Set` once for membership checks. A raw handwritten one-line array and repeated `indexOf` scans were rejected because they are hard to audit and unnecessarily quadratic in homophone generation.

6. **Keep generated consumers mechanically derived.** The popup userscript builder embeds the authoritative core/data files; tests compare exported core behavior with the embedded consumer contract and verify a rebuild does not retain a second implementation.

## Risks / Trade-offs

- **[Existing callers rely on accidental globals]** → Scan all first-party consumers and add contract tests before removing them.
- **[Correcting edge cases changes visible text]** → Limit intentional changes to named fixtures and document each before/after output.
- **[Lexicon generation changes ordering]** → Define NFC normalization, stable ordering, and byte-identical rebuild checks.
- **[Larger result contract increases embedded bytes]** → Keep runtime fields compact and measure generated userscript size in verification.

## Migration Plan

1. Add characterization tests around the current core and edge-case failure tests.
2. Extract number spelling, pronunciation analysis, and homophone logic behind explicit exports without changing adapters.
3. Fix named defects and switch adapters to the total result contract.
4. Introduce the lexicon source/generator and verify identical accepted-word membership.
5. Rebuild website/extension generated pages if their script lists change and rebuild the popup userscript.
6. Run automated verification plus manual checks on pronunciation, homophones, guide anchors, extension frame, and popup userscript. Rollback is a source-and-generated-artifact revert; no persistent data migration is required.

## Open Questions

- Before implementation, maintainers must confirm the desired spoken form for decimal and signed numeric tokens; until then they remain explicitly unsupported rather than guessed.
