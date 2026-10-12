## MODIFIED Requirements

### Requirement: Dictionary rows have one canonical lookup identity
Every generated dictionary consumer SHALL derive logical entry identity with the shared Vietnamese term normalization: NFC, trimmed, Unicode-lowercased with the default (locale-independent) mapping, and internal whitespace collapsed. Vietnamese has no locale-specific case mapping, so this produces the same keys as `vi-VN` locale lowercasing. A generated runtime SHALL contain at most one logical entry per normalized key, and accent folding MUST NOT alter stored identity or display text.

#### Scenario: Capitalization variants collide
- **WHEN** source rows such as `Ba Lê` and `ba lê` normalize to the same key
- **THEN** generation emits one logical lookup entry for that key while retaining both source display forms and senses

#### Scenario: Consumers build from the same fixtures
- **WHEN** the website runtime and popup userscript builders receive identical fixture rows
- **THEN** they produce the same ordered logical keys and definition identities

#### Scenario: Default lowercasing keeps every key
- **WHEN** every headword of `vnedict2.json` is normalized with the default lowercasing and with `vi-VN` locale lowercasing
- **THEN** both produce the same key for every headword
