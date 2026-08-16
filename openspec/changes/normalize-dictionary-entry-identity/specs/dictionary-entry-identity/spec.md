## ADDED Requirements

### Requirement: Dictionary rows have one canonical lookup identity
Every generated dictionary consumer SHALL derive logical entry identity with the shared Vietnamese term normalization: NFC, trimmed, locale-lowercased, and internal whitespace collapsed. A generated runtime SHALL contain at most one logical entry per normalized key, and accent folding MUST NOT alter stored identity or display text.

#### Scenario: Capitalization variants collide
- **WHEN** source rows such as `Ba Lê` and `ba lê` normalize to the same key
- **THEN** generation emits one logical lookup entry for that key while retaining both source display forms and senses

#### Scenario: Consumers build from the same fixtures
- **WHEN** the extension runtime and popup userscript builders receive identical fixture rows
- **THEN** they produce the same ordered logical keys and definition identities

### Requirement: Collision grouping is lossless and deterministic
The shared grouping transform SHALL preserve every distinct nonempty source definition, part of speech, and meaningful display-headword association. Exact duplicate definitions SHALL be removed with the shared definition identity, ordering SHALL follow documented stable source order, and any lossy or malformed transformation MUST fail before publishing outputs.

#### Scenario: Colliding rows carry different meanings
- **WHEN** two rows share a normalized key but contain different definitions
- **THEN** the grouped entry retains both definitions and enough display association to render them without inventing or discarding a sense

#### Scenario: Exact definitions repeat
- **WHEN** colliding rows contain an identical normalized definition and part of speech
- **THEN** the generated entry stores that definition once in its first stable position

#### Scenario: A definition is lost
- **WHEN** validation compares source and generated definition identities and finds a nonempty source definition absent
- **THEN** generation exits non-zero and neither runtime artifact is replaced

### Requirement: Collision diagnostics are compact and auditable
Generation SHALL report source-row count, logical-key count, collision-key count, duplicate-definition count, and output revision in compact `key=value` form, with a versioned JSON mode for detailed automation. Default output MUST NOT dump full dictionary rows or definitions.

#### Scenario: Current source is analyzed
- **WHEN** the grouping tool scans the current source
- **THEN** it reports the verified collision counts and stable normalized keys without printing the full 76,178-row dataset

#### Scenario: Automation requests JSON
- **WHEN** a caller passes the documented JSON option
- **THEN** one versioned JSON value contains counts, collision keys, validation status, and output identity

### Requirement: Persisted dictionary schema migrates by revision
Grouped runtime entries SHALL use a new explicit schema version. Browser clients SHALL validate the new shape before mutation and transactionally replace old-schema IndexedDB rows and metadata; a failed parse, validation, or write MUST leave the previously committed dictionary usable.

#### Scenario: Existing client has schema version 1
- **WHEN** a client with valid old rows loads grouped runtime metadata
- **THEN** it performs one full transactional replacement before reporting the new revision ready

#### Scenario: Grouped migration fails
- **WHEN** new grouped rows fail validation or persistence
- **THEN** the prior entries and metadata remain intact and the readiness result reports the documented stale or unavailable state

### Requirement: Lookup and rendering semantics agree across consumers
Website, extension, and popup userscript lookups SHALL return the same union and stable order of definitions for a normalized key. Rendering SHALL preserve meaningful headword variants and MUST NOT show duplicate cards merely because source capitalization differs.

#### Scenario: A verified collision is queried
- **WHEN** each consumer looks up a capitalization-collision key
- **THEN** each returns the same definitions in the same order and renders the documented variant labels without duplicate logical results

#### Scenario: A non-colliding key is queried
- **WHEN** each consumer looks up an ordinary single-row key
- **THEN** visible headword and definition behavior remains compatible with the current runtime

### Requirement: Identity verification is source-safe
Automated identity tests and generated-output checks SHALL use pure transforms, fixtures, or temporary targets and MUST NOT rewrite tracked dictionary or userscript files during normal `make verify` execution.

#### Scenario: Verification is interrupted
- **WHEN** the identity test process terminates before completion
- **THEN** no tracked source or generated artifact has been modified and no restore hook is required

