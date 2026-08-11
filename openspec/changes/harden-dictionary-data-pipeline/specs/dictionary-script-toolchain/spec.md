## MODIFIED Requirements

### Requirement: Single definition for shared script primitives
Every primitive used by more than one script in `scripts/` SHALL have exactly one implementation in a shared repository-local library, and every consumer SHALL import it rather than redefine it. This covers at minimum: text cleaning and term normalization, CJK code-point patterns, CJK candidate extraction, the embeddability rule, the MDX payload shape accessor, repository path constants, the definition de-duplication key, and atomic file writes.

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
- **WHEN** a script needs the path to `vnedict.txt`, `vnedict.json` (extension `db_src` or `js`), `vnedict2.json`, `mdx_nom.json`, `user_nom_entries.jsonc`, or either generated userscript
- **THEN** it imports the path from the shared library, and no script hard-codes those relative paths as string literals

#### Scenario: A duplicate reappears
- **WHEN** a test scans `scripts/` for a redefinition of a shared primitive
- **THEN** the test fails, naming the file and the primitive it duplicates

## ADDED Requirements

### Requirement: Extension dictionary regeneration preserves every sense
The Node.js script that regenerates `zd-extension/db_src/vnedict.json` from `zd-extension/db_src/vnedict.txt` SHALL split each source line into a headword and its definitions on only the first colon, so definition text containing additional colons is preserved in full, and SHALL run entirely on Node.js rather than a separate language runtime.

#### Scenario: A multi-colon definition keeps every sense
- **WHEN** a source line contains more than one colon, such as `sói : (1) wolf: (2) bald; (3) chloranth`
- **THEN** the regenerated entry's definitions include all three senses ("wolf", "bald", "chloranth"), not only the text before the second colon

#### Scenario: Regeneration is a Node.js script
- **WHEN** a maintainer looks for the script that regenerates `zd-extension/db_src/vnedict.json`
- **THEN** it is a Node.js file under `scripts/`, not a Python script, and is syntax-checked and test-covered by `make verify`

### Requirement: The extension's runtime dictionary is generated, not hand-copied
`zd-extension/js/vnedict.json` — the file loaded by the Chrome extension's background script and by the website's popup dictionary page — SHALL be produced by a script that reads `zd-extension/db_src/vnedict2.json`, the actively-maintained dictionary, rather than by a manual copy or transform from any other file.

#### Scenario: Runtime dictionary matches the maintained source
- **WHEN** `zd-extension/js/vnedict.json` is regenerated
- **THEN** every entry present in `zd-extension/db_src/vnedict2.json` is present in the output, including entries added by the MDX merge or the add-chu-nom workflow

#### Scenario: No manual copy step is documented
- **WHEN** a maintainer follows `docs/dictionary-data.md` after changing `vnedict2.json`
- **THEN** the documented step is running the regeneration script, not manually copying or transforming a JSON file

#### Scenario: Output stays parseable
- **WHEN** the regeneration script finishes writing `zd-extension/js/vnedict.json`
- **THEN** the script has verified the written file parses as JSON and its entry count is within the same order of magnitude as `vnedict2.json`'s, failing non-zero instead of leaving a truncated or malformed file if that check does not pass

### Requirement: Dictionary file writes are atomic
Every script that writes a dictionary JSON file consumed by another part of the toolchain or by a runtime surface — at minimum `zd-extension/db_src/vnedict2.json`, `zd-extension/db_src/vnedict.json`, and `zd-extension/js/vnedict.json` — SHALL write via a temporary file and rename, using the shared atomic-write primitive, rather than writing the target path directly.

#### Scenario: A crash mid-write leaves the previous file intact
- **WHEN** a dictionary-writing script is interrupted after it starts writing but before the write completes
- **THEN** the previously-committed dictionary file at the target path is unchanged, because the script wrote to a temporary path first

#### Scenario: Atomic write has one implementation
- **WHEN** the repository is searched for a function that writes a file via a temporary-path-then-rename pattern
- **THEN** exactly one implementation is found, in the shared library, and every dictionary-writing script imports it

### Requirement: Malformed merge input is counted, not silently dropped
When `scripts/merge-mdx-nom-into-vnedict2.js` encounters an MDX candidate entry whose `candidates` value is not a usable array, it SHALL increment a counter and include that count in its printed summary, rather than silently treating the entry as empty with no signal.

#### Scenario: A malformed candidates value is visible in the summary
- **WHEN** the merge script processes an MDX payload containing an entry whose `candidates` field is not an array
- **THEN** the script's final printed summary includes a count of skipped malformed entries greater than zero

### Requirement: Coverage for extension dictionary and merge-write safety
The extension dictionary regeneration script, the runtime-dictionary generation script, and the merge script's atomic-write and malformed-input-counting behavior SHALL have automated tests exercising their logic against in-memory fixtures, without writing to the repository's real dictionary files.

#### Scenario: Colon-split fix is tested
- **WHEN** a test supplies a fixture line containing multiple colons to the extension dictionary regeneration transform
- **THEN** the test asserts every sense after the first colon is preserved in the resulting entry

#### Scenario: Runtime-dictionary generation is tested
- **WHEN** a test supplies a fixture `vnedict2.json`-shaped array to the runtime-dictionary generation transform
- **THEN** the test asserts the output contains every fixture entry in the expected compact-JSON shape

#### Scenario: Atomic write is tested
- **WHEN** a test simulates a write failure partway through an atomic write to a fixture target path
- **THEN** the test asserts the fixture target's prior contents (or absence) are unchanged
