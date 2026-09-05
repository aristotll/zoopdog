## Why

The two generated userscripts ship a hand-written `@version 2026.04.19` and no `@updateURL` or
`@downloadURL`. Tampermonkey therefore has no way to learn that a rebuild happened: every
dictionary change has to be reinstalled by pasting the rebuilt file into the userscript editor
by hand, on every machine.

## What Changes

- Declare `@updateURL` and `@downloadURL` in both userscript runtime headers, derived from the
  shared repository paths instead of repeated string literals.
- Stamp `@version` during the build: the build date, with a trailing counter when that date is
  already taken, so the served version always compares greater than the installed one.
- Keep the stamp fixed when a rebuild produces otherwise identical bytes, preserving the
  byte-identical rebuild contract for the committed userscripts.
- Cover the version helpers with tests and document the auto-update flow.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `dictionary-script-toolchain`: adds self-updating userscript headers and build-time version
  stamping, and admits the version stamp as a permitted difference when a runtime edit reaches
  the generated output.

## Impact

The change affects `scripts/lib/paths.js`, `scripts/lib/userscript.js`, both userscript
builders, both runtime headers, the generated userscripts, `test/`, and the build and
dictionary documentation. It does not change what the userscripts do in the browser.
