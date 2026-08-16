## Why

The current runtime dictionary contains 93 normalized headword collisions (186 rows), while the popup userscript silently merges the same normalized keys and the website/extension retain duplicate cards. Capitalization variants such as `Ba Lê`/`ba lê` can represent different senses, so simple deduplication would lose display intent even though leaving consumer-specific identity rules creates inconsistent results.

## What Changes

- Define one canonical normalized lookup identity for each logical dictionary key across generated artifacts and consumers.
- Preserve every source definition and meaningful display-headword variant when normalized keys collide; do not discard proper-name or common-word senses.
- Centralize deterministic collision grouping, definition normalization, ordering, and display-variant policy in a reusable dictionary library.
- Generate compact collision diagnostics and fail on malformed or lossy merges while allowing reviewed, deterministic collisions.
- Version the runtime dictionary schema and metadata so existing IndexedDB rows are replaced safely when the identity model changes.
- Add fixture-based tests proving identical lookup semantics across the website, extension, and popup userscript.

## Capabilities

### New Capabilities

- `dictionary-entry-identity`: Defines normalized lookup keys, collision preservation, display variants, deterministic generation, migration, and cross-consumer lookup semantics.

### Modified Capabilities

- None. The new capability composes with the active `popup-dictionary-runtime` capability; its implementation must archive or otherwise establish that capability before changing the persisted row schema.

## Impact

The change affects dictionary-source normalization, `scripts/build-extension-vnedict-json.js`, `scripts/build-popupdict-userscript.js`, runtime metadata, `zd-extension/js/zd-dictionary-runtime.js`, Dexie persistence, popup rendering, generated userscripts, tests, Make targets, and dictionary-data documentation. It must be sequenced with the existing `harden-dictionary-data-pipeline` change and must preserve all source definitions during migration.
