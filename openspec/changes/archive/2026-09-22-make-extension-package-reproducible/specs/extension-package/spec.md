## ADDED Requirements

### Requirement: Extension package membership is explicit and minimal
The repository SHALL define a reviewed runtime package inventory rooted at `zd-extension/`. Packaging SHALL include the current manifest and every required local runtime resource while excluding Jade, Stylus, dictionary sources, tests, `.DS_Store`, `__MACOSX`, and other development-only files. Absolute paths, path traversal, duplicate archive paths, and symbolic-link escape MUST be rejected.

#### Scenario: Current extension is planned
- **WHEN** the package planner evaluates the current Manifest V3 extension
- **THEN** every required runtime file appears exactly once and no excluded source or OS-metadata entry is planned

#### Scenario: Inventory contains an unsafe path
- **WHEN** an entry resolves outside `zd-extension/` or duplicates another normalized archive path
- **THEN** planning fails non-zero before any archive is replaced

### Requirement: ZIP generation is byte-reproducible
The importable packager SHALL sort normalized entry paths and fix every ZIP field that can vary by time, host platform, permissions, ordering, compression settings, or extra metadata. Identical file bytes and package configuration SHALL produce byte-identical ZIP output across supported environments.

#### Scenario: Package is built twice
- **WHEN** the packager runs twice against unchanged inputs
- **THEN** the two archives have identical bytes, SHA-256, entry count, and uncompressed file bytes

#### Scenario: Runtime file changes
- **WHEN** one packaged runtime byte changes
- **THEN** the package SHA-256 changes and verification identifies the mismatching runtime input or archive entry

### Requirement: Packaged resources are validated
Before publishing, the packager SHALL parse and validate the packaged manifest, verify that it is the current Manifest V3 version, and ensure all statically referenced plus explicitly dynamic local resources exist in the archive. It MUST reject the obsolete Manifest V2/version 2.0 package and any missing or unexpected entry.

#### Scenario: Tracked legacy package is checked
- **WHEN** verification inspects an archive containing the 2017 Manifest V2/version 2.0 manifest
- **THEN** it fails with a stale-manifest error and a rebuild remedy

#### Scenario: Referenced script is absent
- **WHEN** a packaged HTML or manifest reference names a missing local script
- **THEN** verification fails and names the referring file and missing normalized path

### Requirement: Packaging CLI is composable
Packaging SHALL be implemented as an importable library with a thin CLI that resolves repository paths independently of the caller's working directory. Default output SHALL be compact `key=value` lines; `--json` SHALL emit one versioned JSON result; usage, configuration, integrity, and I/O failures SHALL use documented stable non-zero exit codes.

#### Scenario: CLI runs outside the repository directory
- **WHEN** the packaging CLI is invoked through its absolute script path from another working directory
- **THEN** it packages the same repository inputs and reports the repository-relative archive identity

#### Scenario: JSON output is requested
- **WHEN** automation invokes build or verify with `--json`
- **THEN** stdout contains one parseable versioned result and diagnostics remain on stderr

### Requirement: Package rebuild and verification are first-class maintenance targets
The Makefile SHALL provide separate rebuild and non-mutating verification targets for `zd-extension.zip`, and `make verify` SHALL invoke package verification. Rebuild SHALL publish the archive atomically only after all planning, generation, parsing, and reference checks pass.

#### Scenario: Normal verification runs
- **WHEN** a maintainer runs `make verify`
- **THEN** the tracked archive is compared with deterministic expected output without writing any tracked file

#### Scenario: Rebuild fails before publication
- **WHEN** package generation or validation fails
- **THEN** any previously committed `zd-extension.zip` remains byte-identical and the target exits non-zero

### Requirement: Package verification uses deterministic fixtures
Automated tests SHALL cover minimal valid archives, current-manifest packaging, excluded entries, missing references, duplicate/traversal paths, corrupt CRC or size fields, stale manifest versions, atomic publication failure, and byte reproducibility without Chrome or network access.

#### Scenario: Fixture suite runs
- **WHEN** repository tests execute
- **THEN** all package cases operate in temporary directories and leave the tracked extension tree and ZIP unchanged

