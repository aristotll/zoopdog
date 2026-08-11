## ADDED Requirements

### Requirement: Stable candidate identity for repeated terms
Every planned candidate SHALL carry an identity that manifest validation accepts, including candidates suppressed because an earlier item in the same batch already claimed the normalized key. A repeated term SHALL NOT make an otherwise valid manifest unapplyable.

#### Scenario: Same term appears twice in one batch
- **WHEN** an input contains the same Vietnamese term on two lines or as two separated items on one line
- **THEN** the plan marks the later occurrence skipped with a duplicate reason, and apply validates and applies the batch without raising a metadata error

#### Scenario: Duplicate of an already-existing user entry
- **WHEN** a term that already exists in `user_nom_entries.jsonc` appears twice in the same input
- **THEN** both occurrences are skipped, apply reports zero approved entries, and no validation error is raised

#### Scenario: Duplicate suppression is auditable
- **WHEN** a candidate is suppressed as a duplicate
- **THEN** the manifest records which source item it came from and why it was suppressed, and the reviewer can distinguish it from a candidate skipped for already existing in user entries

### Requirement: Modular workflow implementation
The workflow implementation SHALL be decomposed into separately importable repository-local modules with distinct responsibilities — input parsing, local-source indexing and candidate resolution, manifest validation, JSONC editing, and the apply transaction — each dependency-free and individually unit-testable. The existing entry point SHALL keep its current exported surface so callers and tests are unaffected.

#### Scenario: A module is exercised in isolation
- **WHEN** a test imports the JSONC editing module alone
- **THEN** it can upsert entries without loading dictionary sources, spawning builders, or touching the CLI

#### Scenario: Public interface is unchanged
- **WHEN** an existing caller imports the workflow entry point after decomposition
- **THEN** every previously exported name resolves with unchanged behavior, and the CLI's commands, flags, structured results, and exit codes are identical

### Requirement: Accurate repository workflow documentation
Repository-level agent documentation SHALL describe the actual workflow: the local-rules directory path SHALL resolve to a directory that exists, the available task runner and test command SHALL be stated rather than denied, the workflow's scripts and Make targets SHALL appear in the documented paths, and the `/add-chu-nom` description SHALL name Node.js as the only writer. No copy of the canonical command document SHALL exist outside `.codex/commands/`.

#### Scenario: Agent follows the documented rules path
- **WHEN** an agent reads the repository documentation and follows its local-rules instruction
- **THEN** the referenced directory exists and contains the project's Chu Nom rules

#### Scenario: Agent looks for verification commands
- **WHEN** an agent reads the repository documentation to find how to verify a change
- **THEN** it finds the Make verification target and the Node test command, and finds no claim that the repository has no task runner or test framework

#### Scenario: No divergent command copy exists
- **WHEN** the repository is searched for the `/add-chu-nom` workflow instructions
- **THEN** exactly one canonical document is found under `.codex/commands/`, plus the reference-only Claude pointer, and a test fails if any other copy is added

### Requirement: Explicit manifest path for maintenance apply
The Make apply target SHALL require the manifest path to be supplied explicitly and SHALL fail with a usage message when it is absent. Manifest paths SHALL NOT default to a fixed, predictable location in a world-writable shared directory.

#### Scenario: Apply target invoked without a manifest
- **WHEN** a maintainer runs the Make apply target without supplying a manifest path
- **THEN** Make fails with a usage message and does not invoke the Node.js apply operation

#### Scenario: Apply target invoked with a reviewed manifest
- **WHEN** a maintainer supplies a reviewed manifest path to the Make apply target
- **THEN** Make invokes `scripts/add-chu-nom.js apply` with that path and explicit approval

## MODIFIED Requirements

### Requirement: Deterministic input preprocessing
The planner SHALL deterministically select inline input or a file mention, default to `.idea/newfile.md` when neither is given, honor inclusive file line ranges, filter non-content Markdown lines, preserve inline `Vietnamese / ChuNom / explanation` triples, normalize lookup keys using NFC/lowercase/collapsed whitespace, and use accent folding only for matching. Line splitting on the documented separators SHALL happen before any mixed Vietnamese/CJK extraction, so a separated item always becomes its own source item regardless of whether the line carries CJK annotations. Each source item's recorded item index SHALL be the index of the same separated segment that input cleanup later consumes.

#### Scenario: Repeated planning is stable
- **WHEN** planning is run twice with identical arguments and identical source bytes
- **THEN** both manifests contain the same ordered semantic content and neither run changes a tracked file

#### Scenario: Unique no-diacritic spelling is restored
- **WHEN** an input such as `quan ly` has exactly one accent-folded local key `quản lý`
- **THEN** the planner uses `quản lý` as the proposed stored form and records the original input separately

#### Scenario: Ambiguous spelling remains unresolved
- **WHEN** an accent-folded or typo input maps to multiple defensible Vietnamese keys
- **THEN** the planner records a stably ordered choice list, marks the entry as requiring review, and does not silently select a stored form

#### Scenario: File mention limits the input
- **WHEN** the caller supplies a file mention with an inclusive line range
- **THEN** only eligible items from that range appear in the plan and source coordinates identify their original locations

#### Scenario: Mixed Vietnamese and CJK line becomes one annotated phrase
- **WHEN** one input line is `đích的 thực食`
- **THEN** the planner emits one source item with Vietnamese `đích thực`, retains the original line for review, and does not carry `的` or `食` into Nom candidates

#### Scenario: Separated mixed-input items stay distinct
- **WHEN** one input line is `đích的 thực食, đánh打 lạc洛`
- **THEN** the planner emits two source items with Vietnamese `đích thực` and `đánh lạc`, each retaining its own original segment, and does not merge them into a single combined phrase

#### Scenario: Item indices match cleanup segments
- **WHEN** a source item is produced from a separated segment of a line
- **THEN** its recorded item index identifies exactly that segment, so removing the item during cleanup removes that segment and leaves every other segment on the line unchanged

#### Scenario: Non-Vietnamese-only line is filtered
- **WHEN** a mixed-input line contains CJK or punctuation but no Vietnamese or Latin letters
- **THEN** the planner omits that line from candidate generation

### Requirement: Comment-preserving entry update and precise input cleanup
Apply SHALL upsert approved entries by normalized Vietnamese key while preserving valid JSONC, existing comments, surrounding formatting, unrelated entries, and Vietnamese diacritics. Updating an existing entry SHALL merge the approved `nom` and `explain` values into that entry's current values rather than replacing them, so no previously stored Nom variant or explanation is lost without an explicit removal decision. Appending SHALL produce valid JSONC regardless of comments or trailing trivia preceding the closing bracket, and SHALL use a single consistent value formatting style for updated and appended entries. For file input, apply SHALL remove only successfully applied items and SHALL preserve all unprocessed, skipped, rejected, ambiguous, or unrelated content.

#### Scenario: Existing entry is updated
- **WHEN** an approved normalized key already exists in user entries
- **THEN** only its `vi`, `nom`, and `explain` values are updated and comments and unrelated entries remain intact

#### Scenario: Existing values are preserved on update
- **WHEN** an approved entry's normalized key matches an existing entry that stores additional `nom` or `explain` values
- **THEN** the updated entry retains those existing values alongside the approved ones, de-duplicated and in a stable order

#### Scenario: New entry is appended
- **WHEN** an approved normalized key does not exist in user entries
- **THEN** a valid entry with the established shape is inserted using the file's newline and indentation style

#### Scenario: Append after a trailing comment stays valid
- **WHEN** the last non-whitespace content before the closing bracket of the user-entry file is a comment
- **THEN** appending a new entry produces valid JSONC with the separating comma outside the comment, and the comment is preserved

#### Scenario: Approved upsert is duplicate-free and idempotent
- **WHEN** Node.js receives the same approved normalized key more than once or upserts the same reviewed entry again
- **THEN** the JSONC contains one normalized-key entry with stable de-duplicated values and the second upsert produces byte-identical output

#### Scenario: One item on a mixed input line is applied
- **WHEN** a file line contains multiple separated items and only one is successfully applied
- **THEN** cleanup removes only that item and retains the remaining items on the line

#### Scenario: Applied mixed-annotated item leaves no residue
- **WHEN** an applied source item came from a CJK-annotated segment of a line containing other segments
- **THEN** cleanup removes that segment's full original text and no part of the applied item remains in the input file for the next planning run

### Requirement: Transactional generation and verification
After source edits, apply SHALL invoke `scripts/build-nom-userscript.js` and `scripts/build-popupdict-userscript.js` rather than editing generated userscripts directly, verify every applied normalized key in the generated dictionaries it is eligible to appear in, and run the documented Node syntax checks. Keys that the Nom builder deliberately excludes by its embeddability rule SHALL be verified only against `ZOO_DICTIONARY` and SHALL be reported as intentionally not embedded rather than treated as a verification failure. If any mutation, build, embed check, or syntax check fails, apply SHALL restore all workflow-owned files to their exact pre-apply bytes.

#### Scenario: Successful apply completes all checks
- **WHEN** approved entries are valid and both builders and all verification checks succeed
- **THEN** apply reports the updated keys, cleaned input items, rebuilt files, verification results, and success exit code

#### Scenario: Builder fails after source mutation
- **WHEN** either userscript builder fails after the user-entry or input file has been changed
- **THEN** apply restores the user-entry file, input file, and generated userscripts to their exact prior state and returns an apply-failure error

#### Scenario: Generated key is missing
- **WHEN** a builder exits successfully but an eligible approved key is absent from a generated dictionary it should appear in
- **THEN** apply treats verification as failed and rolls back all workflow-owned files

#### Scenario: Key excluded by the embeddability rule
- **WHEN** an approved key is one the Nom builder's embeddability rule intentionally excludes
- **THEN** apply verifies it in `ZOO_DICTIONARY` only, reports it as intentionally not embedded in `NOM_MAP`, and completes successfully
