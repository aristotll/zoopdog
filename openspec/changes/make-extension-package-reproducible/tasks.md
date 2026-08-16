## 1. Inventory and failure baseline

- [ ] 1.1 Record the current unpacked Manifest V3/version 2.1 identity and the tracked ZIP's Manifest V2/version 2.0, entry, junk-file, and missing-runtime differences in fixtures.
- [ ] 1.2 Create a reviewed package inventory for current runtime roots, explicitly dynamic resources, and excluded development/source patterns.
- [ ] 1.3 Add failing fixture tests for stale manifests, missing references, unexpected/duplicate/traversal paths, symlink escape, corrupt CRC/size, and non-reproducible metadata.

## 2. Importable package library

- [ ] 2.1 Implement repository-independent package planning with normalized safe paths, deterministic expansion, and explicit exclusion enforcement.
- [ ] 2.2 Implement Manifest V3/version/reference validation for manifest, HTML, CSS, and declared dynamic resources.
- [ ] 2.3 Implement deterministic ZIP encode/decode with sorted entries, fixed metadata, stable storage/compression, CRC/size validation, and no platform extras.
- [ ] 2.4 Implement atomic archive publication that leaves an existing ZIP unchanged on planning, encoding, parsing, validation, or rename failure.

## 3. CLI and automation

- [ ] 3.1 Add a thin CLI with build/verify operations, cwd-independent path discovery, explicit output overrides for tests, and no import-time effects.
- [ ] 3.2 Add compact `key=value` success/error diagnostics, versioned `--json`, stderr separation, and stable usage/configuration/integrity/I/O exit codes.
- [ ] 3.3 Add `rebuild-extension-package` and non-mutating `verify-extension-package` Make targets and invoke verification from `make verify`.

## 4. Artifact migration

- [ ] 4.1 Rebuild `zd-extension.zip` from current runtime inputs and independently inspect its manifest, membership, reference completeness, CRCs, and absence of junk/source files.
- [ ] 4.2 Build twice in isolated paths and confirm byte-identical SHA-256, entry count, uncompressed bytes, and supported-environment fixture output.
- [ ] 4.3 Load the packaged/unpacked extension in Chrome and smoke-test enable/disable, lookup, pronunciation frame, dictionary refresh, and local resources.

## 5. Documentation and final validation

- [ ] 5.1 Document archive ownership, inventory updates, rebuild/verify commands, output contract, supported Node versions, release checklist, and rollback.
- [ ] 5.2 Run the complete package fixture suite and `make verify`, confirm verification does not modify tracked files, and review the final ZIP size/hash delta.
- [ ] 5.3 Validate all OpenSpec artifacts, ensure the change remains disjoint from dictionary pipeline/runtime behavior, and reconcile every checklist item with evidence.

