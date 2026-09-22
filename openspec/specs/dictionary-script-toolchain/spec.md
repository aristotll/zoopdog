# dictionary-script-toolchain

## Purpose

Canonical specification for the `dictionary-script-toolchain` capability, promoted from change `2026-08-11-modularize-dictionary-scripts`.

## Requirements

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
- **WHEN** a script needs the path to `vnedict.txt`, `vnedict.json` (extension `db_src` or `js`), `vnedict2.json`, `mdx_nom.json`, the `user_nom_entries/` shard directory, or either generated userscript
- **THEN** it imports the path from the shared library, and no script hard-codes those relative paths as string literals

#### Scenario: A duplicate reappears
- **WHEN** a test scans `scripts/` for a redefinition of a shared primitive
- **THEN** the test fails, naming the file and the primitive it duplicates

### Requirement: One documented CJK candidate extractor
The shared library SHALL provide a single CJK candidate extraction function whose parenthetical-stripping, separator-splitting, and CJK-presence-guard behavior is explicit and configurable. All callers SHALL use it, and identical input SHALL yield identical candidates regardless of which script performs the extraction.

#### Scenario: Extraction agrees across scripts
- **WHEN** the Nom builder, the Chu Nom planner, and the MDX merge script extract candidates from the same definition string with the same options
- **THEN** all three produce the same ordered candidate list

#### Scenario: Parenthetical and separator handling is explicit
- **WHEN** a definition such as `管理 (简体 管理), to manage` is extracted with the documented default options
- **THEN** the parenthetical is stripped, the separators are honored, and the resulting candidates match the documented behavior for that option set

#### Scenario: Extraction is unit-testable in isolation
- **WHEN** a test imports the extractor alone
- **THEN** it runs without reading dictionary files, spawning processes, or writing to disk

### Requirement: Userscript runtime lives in real source files
The browser runtime JavaScript and CSS embedded in the userscript builders SHALL be stored as ordinary source files, and the builders SHALL assemble them into the generated userscripts rather than carry them inside template literals. Assembled runtime files SHALL pass syntax checking as themselves, and SHALL NOT require escaping backslashes or template-literal syntax to be stored.

#### Scenario: Runtime is syntax-checked as code
- **WHEN** the verification target runs
- **THEN** each extracted runtime source file is syntax-checked directly, so an error inside the runtime fails verification instead of being hidden inside a valid string literal

#### Scenario: Regular expressions need no double escaping
- **WHEN** the runtime declares a pattern containing `\s`, `\n`, or a Unicode escape
- **THEN** the source file contains the pattern exactly as the browser will see it, with no doubled backslashes

#### Scenario: Builder files carry only assembly logic
- **WHEN** a maintainer opens `scripts/build-nom-userscript.js` or `scripts/build-popupdict-userscript.js`
- **THEN** the file contains data transformation and assembly logic only, and the browser runtime and CSS are not inlined in it

#### Scenario: Runtime edit reaches the generated output
- **WHEN** a maintainer edits an extracted runtime source file and reruns the builder
- **THEN** the change appears in the corresponding generated userscript, with no difference other than the raised `@version` stamp

### Requirement: Generated userscripts update themselves
Each generated userscript SHALL declare `@updateURL` and `@downloadURL` pointing at its own
published raw location, derived from the shared repository path declarations rather than
hard-coded in the runtime header. The builders SHALL stamp `@version` so that it compares
strictly greater than the previously committed version whenever any other byte of the generated
file changes, and SHALL leave it unchanged when the remaining bytes are identical.

#### Scenario: Dictionary data changes
- **WHEN** a builder runs after a dictionary, runtime, or builder change
- **THEN** the generated userscript carries a version greater than the committed one, so an
  installed copy is offered the update

#### Scenario: Rebuild against unchanged inputs
- **WHEN** a builder runs twice against unchanged inputs
- **THEN** the second run writes the same version and the same bytes, and `git status --short`
  reports no change

#### Scenario: Two changes on one day
- **WHEN** the previous version is not older than the current build date
- **THEN** the stamp gains or increments a trailing counter, so it is still strictly greater

#### Scenario: Update location is declared once
- **WHEN** a test reads either generated userscript
- **THEN** its `@updateURL` and `@downloadURL` equal the raw URL derived from the shared path
  declaration for that file

### Requirement: Scripts are importable without side effects
Every script in `scripts/` SHALL guard its command-line behavior behind a main-module check and SHALL export its data transformation functions. Importing a script SHALL NOT read dictionary sources, write files, spawn processes, or exit the process.

#### Scenario: Import performs no writes
- **WHEN** a test imports a builder or a merge script
- **THEN** no file is created or modified and no process is spawned

#### Scenario: Transform functions are callable directly
- **WHEN** a test imports a script and calls its exported transform with in-memory fixture data
- **THEN** the transform returns its result without touching the repository's real dictionary files

#### Scenario: Command-line behavior is unchanged
- **WHEN** a script is run from the command line as before
- **THEN** it performs the same reads, writes, and console output as it did prior to the guard

### Requirement: Generated output stability
Refactoring within this toolchain SHALL NOT change the bytes of `zoopdog-nom-ruby.user.js` or `zoopdog-popupdict.user.js`. A byte-comparison against the pre-refactor output SHALL be part of verification.

#### Scenario: Byte-identical rebuild
- **WHEN** both builders are run before and after the refactor against unchanged dictionary data
- **THEN** the SHA-256 hash of each generated userscript is identical, and `git status --short` reports no change to either file

#### Scenario: Drift is caught by verification
- **WHEN** a refactor step changes generated output
- **THEN** verification fails and names the file whose hash changed, before the change can be committed

### Requirement: Extension dictionary regeneration preserves every sense
The Node.js script that regenerates `zd-extension/db_src/vnedict.json` from `zd-extension/db_src/vnedict.txt` SHALL split each source line into a headword and its definitions on only the first colon, so definition text containing additional colons is preserved in full, and SHALL run entirely on Node.js rather than a separate language runtime.

#### Scenario: A multi-colon definition keeps every sense
- **WHEN** a source line contains more than one colon, such as `sói : (1) wolf: (2) bald; (3) chloranth`
- **THEN** the regenerated entry's definitions include all three senses ("wolf", "bald", "chloranth"), not only the text before the second colon

#### Scenario: Regeneration is a Node.js script
- **WHEN** a maintainer looks for the script that regenerates `zd-extension/db_src/vnedict.json`
- **THEN** it is a Node.js file under `scripts/`, not a Python script, and is syntax-checked and test-covered by `make verify`

### Requirement: The website's runtime dictionary is generated, not hand-copied
`zd-extension/js/vnedict.json` — the file loaded by the website's popup dictionary page — SHALL be produced by a script that reads `zd-extension/db_src/vnedict2.json`, the actively-maintained dictionary, rather than by a manual copy or transform from any other file.

#### Scenario: Runtime dictionary matches the maintained source
- **WHEN** `zd-extension/js/vnedict.json` is regenerated
- **THEN** every entry present in `zd-extension/db_src/vnedict2.json` is present in the output, including entries added by the MDX merge

#### Scenario: No manual copy step is documented
- **WHEN** a maintainer follows `docs/dictionary-data.md` after changing `vnedict2.json`
- **THEN** the documented step is running the regeneration script, not manually copying or transforming a JSON file

#### Scenario: Output stays parseable
- **WHEN** the regeneration script finishes writing `zd-extension/js/vnedict.json`
- **THEN** the script has verified the written file parses as JSON and, together with its revision metadata sidecar, is published atomically as a matching pair — failing non-zero and leaving the previous matching pair intact instead of a truncated, malformed, or mismatched file if that check does not pass

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

### Requirement: Coverage for previously untested scripts
The MDX extraction and MDX merge scripts, the extension dictionary regeneration script, and the runtime-dictionary generation script SHALL have automated tests exercising their transformation logic against in-memory fixtures, without requiring the external MDX dependency, the full dictionary, or writes to the repository's real dictionary files.

#### Scenario: Merge logic is tested
- **WHEN** the merge transform receives a fixture dictionary entry and fixture MDX candidates
- **THEN** tests assert Nom definitions are inserted ahead of English definitions, duplicates are removed, and entries missing from the dictionary are created

#### Scenario: Extraction logic is tested without the MDX dependency
- **WHEN** the extractor's candidate parsing, HTML stripping, key filtering, and headword-prefix removal are tested
- **THEN** they run against plain strings with no `js-mdict` import required

#### Scenario: Colon-split fix is tested
- **WHEN** a test supplies a fixture line containing multiple colons to the extension dictionary regeneration transform
- **THEN** the test asserts every sense after the first colon is preserved in the resulting entry

#### Scenario: Runtime-dictionary generation is tested
- **WHEN** a test supplies a fixture `vnedict2.json`-shaped array to the runtime-dictionary generation transform
- **THEN** the test asserts the output contains every fixture entry in the expected compact-JSON shape

#### Scenario: Atomic write is tested
- **WHEN** a test simulates a write failure partway through an atomic write to a fixture target path
- **THEN** the test asserts the fixture target's prior contents (or absence) are unchanged

#### Scenario: Missing optional dependency stays a clear failure
- **WHEN** the MDX extractor is run from the command line without `js-mdict` installed
- **THEN** it still reports the documented installation guidance and exits non-zero

### Requirement: Verification covers the whole toolchain
The repository's verification entry point SHALL run every script test suite and syntax-check every file in `scripts/`, including the shared library and the extracted userscript runtime.

#### Scenario: Verification runs every suite
- **WHEN** a maintainer runs the verification target
- **THEN** all script test suites execute and every file under `scripts/` is syntax-checked

#### Scenario: A new script joins verification automatically
- **WHEN** a new file is added under `scripts/`
- **THEN** the verification target syntax-checks it without needing a new hard-coded line per file
