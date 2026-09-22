## Context

The source/runtime dictionary has 76,178 rows. Applying the shared Vietnamese normalization (`NFC`, trim, lowercase, collapsed whitespace) yields 93 keys with two source rows each. The popup userscript groups such rows and deduplicates definitions, while Dexie-backed website/extension lookups retain separate rows. Some collisions are capitalization variants with different senses, so discarding later rows or selecting one spelling globally is lossy.

The active data-pipeline change owns parsing, validation, and atomic file plumbing; the active popup-runtime change owns revision-based IndexedDB replacement. This change owns semantic entry identity and must compose with both rather than reimplement them.

## Goals / Non-Goals

**Goals:**

- Give all consumers one deterministic logical-key and collision model.
- Preserve every distinct definition and meaningful source display form.
- Produce reviewable collision diagnostics before publishing generated artifacts.
- Migrate persisted rows without mixing old and new schemas.

**Non-Goals:**

- Correcting dictionary translations or deciding that capitalization variants are linguistic duplicates.
- Accent-folding stored keys or definitions.
- Replacing Dexie, changing selection/candidate generation, or merging unrelated dictionary sources.
- Absorbing unfinished filesystem work from `harden-dictionary-data-pipeline`.

## Decisions

1. **Represent a logical entry explicitly.** Generated rows contain a normalized `key`, ordered `headwords`, and ordered unique definitions retaining their display-headword association where needed. `key` is for identity/search; display forms are never inferred by re-capitalizing it. Flattening all collisions to the first `vn` string was rejected because it mislabels distinct proper/common senses.

2. **Centralize grouping in an importable library.** One pure transform consumes validated source rows and returns grouped rows plus a compact collision report. Both runtime JSON and popup userscript builders call it. Consumer-local object accumulation is removed so the same fixtures produce the same keys, definitions, and order.

3. **Define deterministic ordering and loss checks.** Preserve first source occurrence for headword and sense order, use the existing definition identity for exact duplicate removal, and fail if a nonempty source definition disappears. Diagnostics report counts and normalized keys, not full dictionary dumps, with optional JSON for detailed automation.

4. **Version the persisted schema.** Increment runtime schema metadata and replace the IndexedDB entries table transactionally. Old rows are never read as grouped rows. A revision change triggers full refresh using the existing runtime coordinator.

5. **Sequence active changes explicitly.** Finish or reconcile `harden-dictionary-data-pipeline`, archive/establish `popup-dictionary-runtime`, then implement identity grouping. This avoids competing generators and allows its schema requirements to become canonical before migration.

## Risks / Trade-offs

- **[Schema expansion increases runtime bytes]** → Measure output size, omit redundant associations when one display form covers all senses, and enforce a reviewed size budget.
- **[Unexpected source collisions become blocking]** → Distinguish malformed/lossy collisions from valid reviewed collisions and emit compact actionable reports.
- **[Ordering changes visible results]** → Characterize current union of senses and specify stable source order before switching consumers.
- **[Interrupted browser migration]** → Use the existing single IndexedDB transaction and revision metadata so the prior version remains usable on failure.

## Migration Plan

1. Reconcile the active pipeline/runtime changes and add collision fixtures from verified current examples.
2. Implement the pure grouping/report transform and compare definition multisets against the source.
3. Change both generated dictionary consumers to the grouped schema and bump metadata schema version.
4. Update browser validation, IndexedDB migration, lookup, and rendering adapters.
5. Rebuild committed runtime data, metadata, and popup userscript; record row/key/definition counts and size deltas.
6. Verify first install, upgrade from schema version 1, failed refresh rollback, and cross-consumer lookup parity. Rollback requires restoring the prior generated schema and code together; revision metadata then causes a matching refresh.

## Open Questions

- The implementation review must choose whether a multi-headword result displays all variants in one heading or labels only the senses whose spelling differs; fixtures must settle this before schema code lands.
