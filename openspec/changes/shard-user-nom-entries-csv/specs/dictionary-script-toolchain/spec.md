## MODIFIED Requirements

### Requirement: Single definition for shared script primitives
Every primitive used by more than one script in `scripts/` SHALL have exactly one implementation in a shared repository-local library, and every consumer SHALL import it rather than redefine it. This covers at minimum: text cleaning and term normalization, CJK code-point patterns, CJK candidate extraction, the embeddability rule, the MDX payload shape accessor, repository path constants, and the definition de-duplication key.

#### Scenario: CJK ranges are defined once
- **WHEN** the repository is searched for the CJK code-point range used to recognize Nom characters
- **THEN** exactly one definition is found, in the shared library, and every script that needs it imports that definition

#### Scenario: Normalization has no private copies
- **WHEN** any script normalizes a Vietnamese term for lookup
- **THEN** it calls the shared normalization helper, and no script file defines its own `cleanText` or `normalizeTerm`

#### Scenario: A variant becomes an option, not a fork
- **WHEN** a consumer needs behavior that differs from the default primitive, such as stripping NUL characters before cleaning
- **THEN** the shared helper exposes that behavior as an explicit documented option and the consumer passes it, rather than defining a modified copy

#### Scenario: Repository paths are declared once
- **WHEN** a script needs the path to `vnedict2.json`, `mdx_nom.json`, the `user_nom_entries/` shard directory, or either generated userscript
- **THEN** it imports the path from the shared library, and no script hard-codes those relative paths as string literals

#### Scenario: A duplicate reappears
- **WHEN** a test scans `scripts/` for a redefinition of a shared primitive
- **THEN** the test fails, naming the file and the primitive it duplicates
