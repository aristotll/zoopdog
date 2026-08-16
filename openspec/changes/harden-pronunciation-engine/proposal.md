## Why

The shared pronunciation engine currently mutates `String.prototype`, leaks implicit globals, crashes on whitespace-only and numeric inputs, and mispronounces verified number and minor-vowel cases. Because the same implementation feeds the website, extension, and generated popup userscript, these defects and maintenance costs propagate across every pronunciation surface without behavioral regression coverage.

## What Changes

- Introduce a pure, importable pronunciation core with explicit inputs and outputs and no prototype or global-state mutation.
- Separate deterministic pronunciation, Vietnamese number spelling, tokenization, and homophone generation from DOM/HTML rendering adapters.
- Define stable behavior for empty, whitespace-only, numeric, punctuation, and unsupported inputs instead of returning malformed result shapes or throwing unexpectedly.
- Correct verified Vietnamese number spelling and minor-vowel pronunciation defects while characterizing and preserving valid existing outputs.
- Replace repeated linear real-word lookups with a generated, documented lexicon artifact and an efficient lookup index shared by all consumers.
- Add deterministic unit and cross-consumer contract tests, then rebuild the checked-in popup userscript from the corrected source.

## Capabilities

### New Capabilities

- `pronunciation-engine`: Defines pure pronunciation, number-spelling, homophone, error-handling, lexicon, and cross-consumer behavior.

### Modified Capabilities

- None.

## Impact

The change affects `zd-extension/js/zd-pron-functions.js`, `zd-extension/js/realwords.js`, the website and extension pronunciation adapters, `scripts/userscript/`, the generated popup userscript, tests, build/verification targets, and pronunciation documentation. Public UI behavior remains compatible for valid words; previously crashing or malformed edge cases gain explicit results, and verified incorrect pronunciations change intentionally.
