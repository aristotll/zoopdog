## ADDED Requirements

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
The planner SHALL deterministically select inline input or a file mention, default to `.idea/newfile.md` when neither is given, honor inclusive file line ranges, filter non-content Markdown lines, preserve inline `Vietnamese / ChuNom / explanation` triples, normalize lookup keys using NFC/lowercase/collapsed whitespace, and use accent folding only for matching.

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
Apply SHALL upsert approved entries by normalized Vietnamese key while preserving valid JSONC, existing comments, surrounding formatting, unrelated entries, and Vietnamese diacritics. For file input, it SHALL remove only successfully applied items and SHALL preserve all unprocessed, skipped, rejected, ambiguous, or unrelated content.

#### Scenario: Existing entry is updated
- **WHEN** an approved normalized key already exists in user entries
- **THEN** only its `vi`, `nom`, and `explain` values are updated and comments and unrelated entries remain intact

#### Scenario: New entry is appended
- **WHEN** an approved normalized key does not exist in user entries
- **THEN** a valid entry with the established shape is inserted using the file's newline and indentation style

#### Scenario: Approved upsert is duplicate-free and idempotent
- **WHEN** Node.js receives the same approved normalized key more than once or upserts the same reviewed entry again
- **THEN** the JSONC contains one normalized-key entry with stable de-duplicated values and the second upsert produces byte-identical output

#### Scenario: One item on a mixed input line is applied
- **WHEN** a file line contains multiple separated items and only one is successfully applied
- **THEN** cleanup removes only that item and retains the remaining items on the line

### Requirement: Transactional generation and verification
After source edits, apply SHALL invoke `scripts/build-nom-userscript.js` and `scripts/build-popupdict-userscript.js` rather than editing generated userscripts directly, verify every applied normalized key in `NOM_MAP` and `ZOO_DICTIONARY`, and run the documented Node syntax checks. If any mutation, build, embed check, or syntax check fails, it SHALL restore all workflow-owned files to their exact pre-apply bytes.

#### Scenario: Successful apply completes all checks
- **WHEN** approved entries are valid and both builders and all verification checks succeed
- **THEN** apply reports the updated keys, cleaned input items, rebuilt files, verification results, and success exit code

#### Scenario: Builder fails after source mutation
- **WHEN** either userscript builder fails after the user-entry or input file has been changed
- **THEN** apply restores the user-entry file, input file, and generated userscripts to their exact prior state and returns an apply-failure error

#### Scenario: Generated key is missing
- **WHEN** a builder exits successfully but an approved key is absent from either generated dictionary
- **THEN** apply treats verification as failed and rolls back all workflow-owned files

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
