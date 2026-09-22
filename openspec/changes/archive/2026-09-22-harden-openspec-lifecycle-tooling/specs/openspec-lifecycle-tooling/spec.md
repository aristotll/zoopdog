## ADDED Requirements

### Requirement: Inspection never mutates the repository

The lifecycle command SHALL make no filesystem write unless the caller passes an explicit archive flag. A run without that flag SHALL report state only, and SHALL name the command that would perform the move.

#### Scenario: Bare run leaves the tree untouched

- **WHEN** the command runs with no arguments in a repository containing an archive-eligible change
- **THEN** no file or directory is created, moved, modified, or removed
- **AND** the output names the eligible change and the exact flag required to archive it

#### Scenario: Dry run rehearses the move

- **WHEN** the command runs with both the archive flag and the dry-run flag
- **THEN** the output lists every source and destination path it would use
- **AND** no file or directory is created, moved, modified, or removed

#### Scenario: Archiving is explicit

- **WHEN** the command runs with the archive flag and without the dry-run flag
- **THEN** each eligible change directory is moved to `openspec/changes/archive/<YYYY-MM-DD>-<change-name>` and reported

### Requirement: A change is validated before it is archived

The command SHALL compute a change's structural issues before considering it for archiving, and SHALL refuse to archive any change with at least one structural issue. Structural issues SHALL be reported and SHALL fail the run whether or not archiving was requested.

#### Scenario: Structurally broken change is not archived

- **WHEN** a change has every task checked but is missing `proposal.md`
- **AND** the command runs with the archive flag
- **THEN** the change directory is not moved
- **AND** the missing file is reported as a structural issue
- **AND** the command exits non-zero

#### Scenario: Valid complete change is archived

- **WHEN** a change has `.openspec.yaml`, `proposal.md`, `design.md`, `tasks.md`, at least one `specs/**/spec.md`, no empty specs directory, and every task checked
- **AND** the command runs with the archive flag
- **THEN** the change is archived and the command exits zero

#### Scenario: Archive destination collision is resolved without overwriting

- **WHEN** a change is archived on a date for which `archive/<YYYY-MM-DD>-<change-name>` already exists
- **THEN** a numbered suffix is appended until the destination is free
- **AND** no existing archived directory is overwritten or merged into

### Requirement: Task parsing sees every checkbox a reader sees

The command SHALL recognise markdown task checkboxes at any indentation depth and with either `-` or `*` as the list marker. A change SHALL count as complete only when every recognised checkbox is checked.

#### Scenario: Nested unchecked sub-task blocks archiving

- **WHEN** `tasks.md` contains a checked top-level task whose indented sub-task is unchecked
- **AND** the command runs with the archive flag
- **THEN** the change is not archived
- **AND** the unchecked sub-task is reported as outstanding

#### Scenario: Change with no checkboxes is an issue

- **WHEN** a change's `tasks.md` contains no recognisable checkbox
- **THEN** the command reports that `tasks.md` has no checkbox tasks
- **AND** the change is not archived

### Requirement: Archiving promotes spec deltas to canonical specs

When a change is archived, the command SHALL promote each `specs/<capability>/spec.md` delta it carries into `openspec/specs/<capability>/spec.md`. Promotion SHALL produce a canonical spec that carries no change-delta requirements header. The command SHALL NOT overwrite an existing canonical spec.

#### Scenario: Delta becomes a new canonical spec

- **WHEN** a change carrying a `specs/<capability>/spec.md` delta is archived
- **AND** `openspec/specs/<capability>/spec.md` does not exist
- **THEN** the canonical spec is created with a `## Purpose` section, a `## Requirements` section, and every requirement block from the delta
- **AND** the canonical spec contains no `## ADDED|MODIFIED|REMOVED|RENAMED Requirements` header
- **AND** the promotion is reported with its destination path

#### Scenario: Existing canonical spec is never clobbered

- **WHEN** a change carrying a delta for a capability is archived
- **AND** `openspec/specs/<capability>/spec.md` already exists
- **THEN** the conflict is reported, naming both the delta and the canonical file
- **AND** neither the canonical spec nor the change directory is modified or moved
- **AND** the command exits non-zero

#### Scenario: Two archive candidates target one new capability

- **WHEN** one archive batch contains two changes whose deltas target the same absent canonical capability
- **THEN** whole-batch preflight reports both conflicting deltas before any canonical file or change directory is modified

#### Scenario: Promotion or move fails after preflight

- **WHEN** any canonical write or archive-directory move in a validated batch fails
- **THEN** the operation restores every canonical file and active change directory to their exact pre-run state
- **AND** it exits non-zero with the failed phase and path

### Requirement: Canonical specs are validated by anchored headings at any depth

The command SHALL locate canonical specs recursively under `openspec/specs/`, and SHALL match `## Purpose`, `## Requirements`, and delta headers as whole heading lines rather than as substrings.

#### Scenario: An h3 heading does not satisfy an h2 requirement

- **WHEN** a canonical spec contains `### Purpose blurb` but no `## Purpose` heading line
- **THEN** the command reports the missing `## Purpose` section

#### Scenario: Misplaced requirement is detected past an h3 lookalike

- **WHEN** a canonical spec contains `### Requirements overview`, then `### Requirement: X`, then the real `## Requirements` heading
- **THEN** the command reports that a requirement appears outside the main `## Requirements` section

#### Scenario: Nested canonical spec is validated

- **WHEN** a canonical spec exists more than one directory below `openspec/specs/`
- **THEN** it is subject to the same delta-header, `## Purpose`, and `## Requirements` checks as a top-level one

### Requirement: Deferral records are parsed by balanced parentheses

The command SHALL read a `(deferred: <reason>)` marker by matching the parenthesis that closes it, so that a reason containing parentheses is captured whole and task text following the marker is preserved in the summary. The same rule SHALL apply to a `(resolved: <note>)` marker.

#### Scenario: Text after the marker survives in the summary

- **WHEN** a task reads `Load extension (deferred: needs browser) then rerun make verify (see docs/build.md)`
- **THEN** the queue reason is `needs browser`
- **AND** the queue summary retains `then rerun make verify (see docs/build.md)`

#### Scenario: A reason containing parentheses is captured whole

- **WHEN** a task reads `Verify popup (deferred: needs Chrome (v120) installed)`
- **THEN** the queue reason is `needs Chrome (v120) installed`

#### Scenario: A documented template is not a queue entry

- **WHEN** a task line documents the syntax with a placeholder such as `(deferred: <reason>)`
- **THEN** no operator-queue entry is produced for it

#### Scenario: A resolved deferral is suppressed by default

- **WHEN** a deferred task also carries a `(resolved: ...)` note
- **THEN** it is omitted from the operator queue unless the include-resolved flag is passed

### Requirement: Operator-only work is marked explicitly

A task that only an operator can complete SHALL be identified by an explicit `(operator-only)` tag written by the task's author, not inferred from task wording. The command SHALL use the tag only to advise that a change could become archive-eligible through accurate deferral, and SHALL never treat a tagged task as complete.

#### Scenario: All remaining open tasks are operator-only

- **WHEN** every unchecked task in an active change carries the `(operator-only)` tag
- **THEN** the command reports the change as a deferral candidate and shows each open task
- **AND** the change is not archived

#### Scenario: An operator-only task does not satisfy completeness

- **WHEN** an unchecked task carries the `(operator-only)` tag
- **AND** the command runs with the archive flag
- **THEN** the change is not archived

### Requirement: The lifecycle command is part of the documented toolchain

The command SHALL be implemented in the repository's Node.js runtime with no third-party dependency, SHALL be reachable through a `Makefile` target, SHALL be recorded in `AGENTS.md`, and SHALL be covered by a `node:test` suite that `make verify` runs.

#### Scenario: Verification covers the command

- **WHEN** `make verify` runs
- **THEN** the lifecycle command is syntax-checked by the existing `scripts/**/*.js` enumeration
- **AND** its `node:test` suite runs and passes

#### Scenario: The command is discoverable from documented entry points

- **WHEN** a maintainer reads `AGENTS.md` and `make help`
- **THEN** both name the lifecycle check and how to run it

### Requirement: The archived verification record matches its verification notes

A task in an archived change SHALL NOT be recorded as checked without qualification when the change's own verification notes record it as unperformed or partially performed. Such a task SHALL carry a `(deferred: <reason>)` marker stating the accurate reason, so it appears in the operator queue.

#### Scenario: Unperformed browser verifications are surfaced

- **WHEN** the operator queue is listed after this change is applied
- **THEN** the outstanding unpacked-extension, popup-card, and userscript verifications from `2026-08-11-streamline-agent-workflow-surface` each appear with their accurate reason
- **AND** each corresponding task line in that change's `tasks.md` carries a `(deferred: ...)` marker consistent with the "Verification notes" section of the same file
