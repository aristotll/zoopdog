# deterministic-chu-nom-entry-workflow

## Purpose

Canonical specification for the `deterministic-chu-nom-entry-workflow` capability. Its base requirements were promoted from change `delegate-add-chu-nom-to-nodejs`; the deltas from `2026-08-11-harden-chu-nom-workflow` and `2026-08-11-streamline-agent-workflow-surface` — archived earlier but left unmerged pending that base, per `harden-openspec-lifecycle-tooling` task 4.7 — are merged in here.

## Requirements

### Requirement: Node.js-callable two-phase interface
The system SHALL provide a dependency-free repository-local Node.js CommonJS interface that is both importable and executable as a CLI, with separate read-only `plan` and mutating `apply` operations. The interface SHALL reuse the repository's shared user-entry parsing and normalization helpers, SHALL use versioned JSON for persisted manifests and machine-readable results, SHALL write diagnostics separately from results, and SHALL expose stable error classes through exit codes.

#### Scenario: Node.js caller plans entries
- **WHEN** a Node.js caller imports and invokes the planning entry point with valid arguments and a fixed repository state
- **THEN** the system returns the same ordered semantic result as the equivalent CLI invocation without modifying repository files

#### Scenario: Shared normalization remains aligned
- **WHEN** the planner and either existing userscript builder normalize the same Vietnamese input
- **THEN** both use the same shared normalization implementation and produce the same lookup key

#### Scenario: Invalid invocation is machine-detectable
- **WHEN** a caller supplies mutually incompatible input options or an invalid manifest
- **THEN** the system emits a structured error and exits with the documented validation error class without mutating repository files

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

### Requirement: Deterministic phrase expansion and local resolution
The planner SHALL emit each full phrase and eligible known contiguous subphrases in a documented stable order, de-duplicate normalized keys in first-seen order, detect existing user entries before proposing writes, and resolve candidates from local sources with stable source precedence and de-duplication. It MUST NOT infer unsupported linguistic data.

#### Scenario: Phrase candidates have stable order
- **WHEN** a multi-word input contains locally known contiguous subphrases of at least two words
- **THEN** the plan lists the full phrase first and known subphrases by descending word count then ascending position, without duplicate normalized keys

#### Scenario: Existing user entry is skipped
- **WHEN** a candidate normalized key already exists in `user_nom_entries.jsonc` or was already encountered in the batch
- **THEN** the planner marks it skipped with a reason and does not create an actionable duplicate

#### Scenario: Main dictionary overlap remains actionable
- **WHEN** a candidate exists in `vnedict2.json` or `mdx_nom.json` but not in user entries
- **THEN** the planner may propose it with local Nom and explanation evidence and notes that generated definitions will be merged and de-duplicated

#### Scenario: Composition is safe and ordered
- **WHEN** an unresolved multi-word phrase has exactly one locally supported Nom form for every component
- **THEN** the planner composes those forms in Vietnamese word order and marks the result uncertain for review

#### Scenario: Unsupported resolution is not fabricated
- **WHEN** local data cannot provide a unique correction, Nom value, composition, or English explanation
- **THEN** the planner leaves the missing or ambiguous field for review and records why it could not be resolved

#### Scenario: Filtered mixed input requires AI review
- **WHEN** the planner removes embedded CJK from a mixed Vietnamese/CJK line
- **THEN** it records `input-filtered` provenance, resolves only the clean Vietnamese phrase from local dictionaries, marks the full phrase `needs-review`, and notes that AI review is required before approval

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
The workflow implementation SHALL be decomposed into separately importable repository-local modules with distinct responsibilities — input parsing, local-source indexing and candidate resolution, manifest validation, JSONC editing, and the apply transaction — each dependency-free and individually unit-testable. The entry point SHALL keep a stable exported surface so callers and tests are unaffected by internal reorganization.

#### Scenario: A module is exercised in isolation
- **WHEN** a test imports the JSONC editing module alone
- **THEN** it can upsert entries without loading dictionary sources, spawning builders, or touching the CLI

#### Scenario: Public interface is unchanged
- **WHEN** an existing caller imports the workflow entry point after decomposition
- **THEN** every previously exported name resolves with unchanged behavior, and the CLI's commands, flags, structured results, and exit codes are identical

### Requirement: Compact review projection on planning output
Planning SHALL emit a review projection on standard output alongside its summary, containing only the fields a reviewer acts on — entry id, original input, proposed `vi`, `nom`, `explain`, status, provenance, notes, and choices — with empty collections omitted. The projection SHALL NOT contain source hashes, source-item metadata, or the internal identity fields used for integrity checking. Reviewing a planned batch SHALL NOT require reading the manifest file.

#### Scenario: Reviewer works from planning output alone
- **WHEN** an agent runs planning for a batch of Vietnamese terms
- **THEN** the standard-output result contains one projection record per candidate with its status and notes, and the agent can present the full review without opening the manifest file

#### Scenario: Skipped candidates remain visible
- **WHEN** a candidate is skipped because it already exists in `user_nom_entries.jsonc` or duplicates an earlier item in the batch
- **THEN** the projection includes that candidate with its skipped status and the reason, so the review can report it

#### Scenario: Integrity fields are absent from the projection
- **WHEN** the projection is inspected for any candidate
- **THEN** it contains no source hash, no source-item record, and no internal entry identity beyond the id needed to address the entry in a decision

### Requirement: Decision recording through a restricted command
The workflow SHALL provide a command that records review decisions into an existing manifest. It SHALL accept a collection of decision objects supplied either inline on standard input or as a file path, and SHALL accept only the fields `id`, `decision`, `nom`, `explain`, `vi`, and `replace`. Any other field SHALL be rejected by name. The command SHALL write the manifest atomically and SHALL re-emit the updated review projection. Source hashes, source-item metadata, and entry identity fields SHALL NOT be writable through this command.

#### Scenario: Decisions are recorded without editing the manifest
- **WHEN** an agent supplies decisions for every actionable entry through the command
- **THEN** the manifest records those decisions and values, and applying the manifest succeeds without the agent having edited the file directly

#### Scenario: An unrecognized decision field is rejected
- **WHEN** a decision object contains a field outside the accepted set
- **THEN** the command fails, names the offending field, and leaves the manifest unchanged

#### Scenario: Integrity fields cannot be reached
- **WHEN** a decision object attempts to set a source hash, a source item, or an entry id mapping
- **THEN** the command rejects it as an unrecognized field and the stored integrity data is unchanged

#### Scenario: Revising a decision is idempotent
- **WHEN** the command is run a second time with a corrected value for an entry already decided
- **THEN** that entry's decision and values are replaced, entries not named are untouched, and the re-emitted projection shows the corrected values

#### Scenario: Text values survive transport
- **WHEN** decisions carrying Vietnamese diacritics and Chu Nom/CJK characters are supplied through either input form
- **THEN** the stored and re-emitted values are byte-identical to the supplied values

### Requirement: Exhaustive validation reporting before apply
Recording decisions SHALL validate the resulting manifest and SHALL report every validation failure found, not only the first. The command SHALL exit non-zero while any actionable entry lacks a final apply or reject decision, or while any value fails validation, and SHALL exit zero only when the manifest would pass the apply-time check. Validation performed for reporting SHALL NOT modify the manifest it inspects.

#### Scenario: Multiple defects are reported together
- **WHEN** a manifest has one entry missing a decision and another whose `nom` contains a non-CJK value
- **THEN** the command reports both failures in one result rather than stopping at the first

#### Scenario: Failure is detected before apply
- **WHEN** every actionable entry has been decided and all values are valid
- **THEN** the command exits zero, and a subsequent approved apply does not fail validation

#### Scenario: Reporting validation is side-effect free
- **WHEN** validation is run for reporting and reports failures
- **THEN** the manifest bytes are unchanged, including entry normalization that the apply path performs

### Requirement: Actionable structured errors
Every workflow failure SHALL carry a stable machine-readable code drawn from a frozen enumeration and a hint naming the corrective action, in addition to its message and details. Distinct failure causes SHALL NOT share a code.

#### Scenario: A stale source reports its remedy
- **WHEN** a source file changes between planning and apply
- **THEN** the structured error names a stale-source code and a hint directing the caller to re-plan

#### Scenario: Codes are enumerated and unique
- **WHEN** the workflow's failure sites are enumerated
- **THEN** each supplies a code belonging to the frozen enumeration, and no two distinct causes share a code

#### Scenario: Shell contract is preserved
- **WHEN** a Make target invokes the workflow and the workflow fails
- **THEN** the process exit code matches the documented value for that failure class

### Requirement: Accurate repository workflow documentation
Repository-level agent documentation SHALL describe the actual workflow without duplicating it: the available task runner and test command SHALL be stated rather than denied, the workflow's scripts and Make targets SHALL be reachable from the documented paths, and the `/add-chu-nom` description SHALL name Node.js as the only writer. The canonical command document SHALL be the sole owner of the workflow procedure, and repository-level documentation SHALL link to it rather than restate it. No copy of the canonical command document SHALL exist outside `.codex/commands/`. Repository-level documentation SHALL NOT instruct agents to read a local-rules directory at the start of every session; any rule an agent must apply SHALL live in the document loaded when that work is performed.

#### Scenario: Agent finds the workflow procedure exactly once
- **WHEN** an agent reads the repository documentation to learn how the Chu Nom workflow runs
- **THEN** it finds a pointer to the canonical command document and no competing restatement of the procedure

#### Scenario: Agent looks for verification commands
- **WHEN** an agent reads the repository documentation to find how to verify a change
- **THEN** it finds the Make verification target and the Node test command, and finds no claim that the repository has no task runner or test framework

#### Scenario: No divergent command copy exists
- **WHEN** the repository is searched for the `/add-chu-nom` workflow instructions
- **THEN** exactly one canonical document is found under `.codex/commands/`, plus the reference-only Claude pointer, and a test fails if any other copy is added

#### Scenario: No session-start rules read is mandated
- **WHEN** an agent reads the repository documentation at the start of a session
- **THEN** it is not instructed to read a local-rules directory, and no local-rules directory of Chu Nom instructions remains for it to read

#### Scenario: An applied rule is present where it is needed
- **WHEN** an agent reviews a multi-word Vietnamese phrase during the Chu Nom workflow
- **THEN** the rule requiring Vietnamese word order rather than Chinese semantic order is present in the command document it is already following

### Requirement: Explicit, auditable review handoff
The planning manifest SHALL record schema version, relevant source hashes, original inputs and coordinates, normalized keys, candidates, provenance, review notes, and decisions. The apply operation SHALL require an explicit approval argument and final per-entry decisions, and SHALL reject incomplete or unsafe actionable entries.

#### Scenario: Planning never applies a proposal
- **WHEN** a plan contains complete locally resolved entries
- **THEN** the system still leaves them unapplied until a reviewer marks final decisions and invokes apply with explicit approval

#### Scenario: Ambiguous entry blocks unsafe apply
- **WHEN** a manifest contains an actionable entry with unresolved correction or missing valid Nom data
- **THEN** apply fails validation before changing any file

#### Scenario: Reviewer edits are accepted
- **WHEN** a reviewer supplies valid `vi`, `nom`, and optional `explain` values, records an apply decision, and explicitly approves the manifest
- **THEN** apply uses those reviewed values rather than recomputing linguistic choices

#### Scenario: Complete reviewed entries default to import
- **WHEN** the user approves a review containing complete valid entries plus explicit rejections or unresolved entries
- **THEN** the command records `apply` for every complete reviewed entry by default, records `reject` for the others, and delegates all writes to Node.js

### Requirement: Stale and out-of-scope mutation protection
Before writing, apply SHALL validate the manifest schema, normalized-key uniqueness, field shapes, repository-relative paths, and SHA-256 hashes of every source that influenced the plan. It SHALL reject stale or path-escaping input and SHALL only mutate approved entries and the planned file-input items.

#### Scenario: Dictionary source changed after review
- **WHEN** a relevant dictionary or user-entry source hash differs from the hash recorded during planning
- **THEN** apply reports the stale source and makes no file changes

#### Scenario: Input file changed after review
- **WHEN** the planned input file bytes change before apply
- **THEN** apply refuses item cleanup and makes no dictionary or generated-file changes

#### Scenario: Rejected and skipped items remain untouched
- **WHEN** a manifest contains rejected, skipped, or unresolved entries alongside approved entries
- **THEN** apply mutates only approved entries and preserves the other corresponding file items for later review

### Requirement: Comment-preserving entry update and precise input cleanup
Apply SHALL upsert approved entries by normalized Vietnamese key while preserving valid JSONC, existing comments, surrounding formatting, unrelated entries, and Vietnamese diacritics. Updating an existing entry SHALL merge the approved `nom` and `explain` values into that entry's current values rather than replacing them, so no previously stored Nom variant or explanation is lost without an explicit removal decision. For file input, it SHALL remove only successfully applied items and SHALL preserve all unprocessed, skipped, rejected, ambiguous, or unrelated content.

#### Scenario: Existing entry is updated
- **WHEN** an approved normalized key already exists in user entries
- **THEN** only its `vi`, `nom`, and `explain` values are updated and comments and unrelated entries remain intact

#### Scenario: Existing values are preserved on update
- **WHEN** an approved entry's normalized key matches an existing entry that stores additional `nom` or `explain` values
- **THEN** the updated entry retains those existing values alongside the approved ones, de-duplicated and in a stable order

#### Scenario: New entry is appended
- **WHEN** an approved normalized key does not exist in user entries
- **THEN** a valid entry with the established shape is inserted using the file's newline and indentation style

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
After source edits, apply SHALL invoke `scripts/build-nom-userscript.js` and `scripts/build-popupdict-userscript.js` rather than editing generated userscripts directly, verify every applied normalized key in the generated dictionaries it is eligible to appear in, and run the documented Node syntax checks. Keys that the Nom builder deliberately excludes by its embeddability rule SHALL be verified only against `ZOO_DICTIONARY` and SHALL be reported as intentionally not embedded rather than treated as a verification failure. If any mutation, build, embed check, or syntax check fails, it SHALL restore all workflow-owned files to their exact pre-apply bytes.

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

### Requirement: Canonical Codex instructions and Claude reference
`.codex/commands/add-chu-nom.md` SHALL be the sole canonical agent workflow: it SHALL invoke the Node.js planner, present structured proposed/skipped/unresolved results for review, help the user resolve only fields requiring judgment, and invoke Node.js apply only after approval. `.claude/commands/add-chu-nom.md` SHALL contain only a heading and a Markdown reference to the canonical Codex command instructions and MUST NOT duplicate CLI invocations or workflow instructions.

#### Scenario: User requests a plan through Codex
- **WHEN** the user invokes the Codex `/add-chu-nom` command with inline words or a file mention
- **THEN** the command obtains candidates from Node.js, presents the review in Vietnamese, and does not modify dictionary or generated files

#### Scenario: Claude command points to canonical instructions
- **WHEN** a user or agent opens `.claude/commands/add-chu-nom.md`
- **THEN** it finds a working Markdown reference to `.codex/commands/add-chu-nom.md` and no duplicated workflow or Node.js invocation

#### Scenario: User approves through canonical instructions
- **WHEN** the user approves a complete reviewed proposal while following the canonical instructions
- **THEN** the agent records final decisions in the manifest, delegates apply to Node.js with explicit approval, and summarizes the structured result in Vietnamese

#### Scenario: User requests changes before approval
- **WHEN** the user corrects or rejects one or more proposed candidates
- **THEN** the agent updates only the review manifest and does not apply until the revised proposal is explicitly approved

#### Scenario: AI reviews a filtered mixed input
- **WHEN** a planned candidate has `input-filtered` provenance
- **THEN** the agent checks phrase meaning and local dictionary evidence, supplies or corrects the Nom and concise explanation without reusing filtered characters, and presents the revision without applying it

### Requirement: Make maintenance entry points
The repository SHALL provide Make targets that delegate file planning, approved manifest apply, Nom userscript rebuild, popup userscript rebuild, combined userscript rebuild, and workflow verification to the canonical Node.js scripts without duplicating workflow logic. The apply and import targets SHALL require the manifest path to be supplied explicitly and SHALL fail with a usage message when it is absent; manifest paths SHALL NOT default to a fixed, predictable location in a world-writable shared directory.

#### Scenario: Maintainer imports a reviewed manifest
- **WHEN** a maintainer runs the documented Make apply target with a reviewed manifest
- **THEN** Make invokes `scripts/add-chu-nom.js apply` with explicit approval so the Node.js transaction performs the only dictionary and generated-file writes

#### Scenario: Maintainer rebuilds generated userscripts
- **WHEN** a maintainer runs the individual or combined rebuild target
- **THEN** Make invokes the existing Node.js builders and never edits embedded maps directly

#### Scenario: Apply target invoked without a manifest
- **WHEN** a maintainer runs the Make apply target without supplying a manifest path
- **THEN** Make fails with a usage message and does not invoke the Node.js apply operation
