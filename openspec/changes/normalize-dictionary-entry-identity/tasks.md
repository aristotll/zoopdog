## 1. Baseline and sequencing

- [ ] 1.1 Reconcile implemented versus remaining tasks in `harden-dictionary-data-pipeline` and establish/archive `popup-dictionary-runtime` before changing row schema.
- [ ] 1.2 Add fixtures for ordinary entries, exact duplicates, and verified capitalization/sense collisions such as `Ba Lê`/`ba lê`.
- [ ] 1.3 Record source row, normalized key, collision key, definition identity, runtime byte, and generated-userscript byte baselines.

## 2. Shared identity library

- [ ] 2.1 Define and document the grouped entry schema containing normalized key, ordered display variants, and lossless ordered senses.
- [ ] 2.2 Implement a pure grouping transform that imports shared term/definition normalization and rejects malformed or lossy input.
- [ ] 2.3 Implement compact `key=value` collision diagnostics and a versioned JSON report without dumping definitions by default.
- [ ] 2.4 Add unit/property fixtures proving stable grouping, exact duplicate removal, definition preservation, display association, and deterministic order.

## 3. Generated artifacts

- [ ] 3.1 Make the extension runtime builder consume grouped entries, increment schema metadata, and atomically publish validated outputs using the active pipeline abstraction.
- [ ] 3.2 Make the popup-userscript builder consume the same grouped transform and remove its private collision/definition merge implementation.
- [ ] 3.3 Rebuild runtime JSON, metadata, and popup userscript and review row/key/definition counts, collision report, revision, and size delta.

## 4. Browser migration and parity

- [ ] 4.1 Update runtime validators and the Dexie schema/migration path to accept grouped rows and reject mixed schemas.
- [ ] 4.2 Update website and extension lookup/render adapters to return one logical result with preserved display variants and ordered senses.
- [ ] 4.3 Add first-install, schema-v1 upgrade, failed-refresh rollback, collision lookup, ordinary lookup, and cross-consumer parity tests.
- [ ] 4.4 Manually verify representative proper/common collisions on website, unpacked extension, and popup userscript.

## 5. Validation and documentation

- [ ] 5.1 Add non-mutating generated identity checks to `make verify` using pure transforms or temporary outputs.
- [ ] 5.2 Document source-of-truth, normalization, reviewed collision policy, schema migration, rebuild commands, compact output, and rollback procedure.
- [ ] 5.3 Run `make verify`, rebuild twice to confirm byte stability, prove every source definition identity is preserved, and validate/reconcile OpenSpec artifacts.

