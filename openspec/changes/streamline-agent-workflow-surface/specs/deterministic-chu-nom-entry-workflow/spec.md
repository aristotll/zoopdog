## ADDED Requirements

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
Every workflow failure SHALL carry a stable machine-readable code drawn from a frozen enumeration and a hint naming the corrective action, in addition to its message and details. Distinct failure causes SHALL NOT share a code. Process exit codes SHALL remain unchanged so existing shell callers and Make targets are unaffected.

#### Scenario: A stale source reports its remedy
- **WHEN** a source file changes between planning and apply
- **THEN** the structured error names a stale-source code and a hint directing the caller to re-plan, and the process exit code is the same as before this change

#### Scenario: Codes are enumerated and unique
- **WHEN** the workflow's failure sites are enumerated
- **THEN** each supplies a code belonging to the frozen enumeration, and no two distinct causes share a code

#### Scenario: Shell contract is preserved
- **WHEN** a Make target invokes the workflow and the workflow fails
- **THEN** the exit code matches the value the target relied on before this change

## MODIFIED Requirements

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

## REMOVED Requirements

### Requirement: Session-start local rules directory
**Reason**: The instruction to read `.claude/no-autoload-rules/*.md` at the start of every session added fixed context cost to unrelated work, contradicted the directory's own no-autoload naming, and carried two rules the scripts now enforce mechanically. The requirement that the documented local-rules path resolve to an existing directory is superseded rather than repaired.

**Migration**: The Vietnamese word-order rule moves into the review section of `.codex/commands/add-chu-nom.md`, loaded when the workflow runs. The rules the scripts enforce — skipping terms already present in `user_nom_entries.jsonc` and removing applied items from the input queue — move to `docs/history/chu-nom-lessons.md` as a record of why the code behaves as it does. No agent-applied rule is lost.
