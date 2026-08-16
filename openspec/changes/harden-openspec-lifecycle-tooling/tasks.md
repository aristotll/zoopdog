## 1. Port the command to the Node.js toolchain

- [x] 1.1 Create `scripts/check-openspec-lifecycle.js` with a `#!/usr/bin/env node` shebang and a `require.main === module` guard, matching the other CLI scripts in `scripts/`, using only `node:fs`, `node:path`, and `node:util`.
- [x] 1.2 Export the pure helpers (`parseTaskRows`, `parseMarker`, `checkChange`, `checkCanonicalSpecs`, `operatorQueue`, `promotionPlan`) so `node:test` can exercise them without spawning a process or touching the repository.
- [x] 1.3 Parse arguments with `node:util`'s `parseArgs`: `--archive`, `--dry-run`, `--operator-queue`, `--include-resolved`. Reject `--dry-run` without `--archive` with a clear message and a non-zero exit.
- [x] 1.4 Delete `scripts/check_openspec_lifecycle.py` in the same commit so only one implementation exists.
- [x] 1.5 Add a `check-openspec` target to the `Makefile`, list it in `make help` alongside its `ARCHIVE=1` form, and add the target and script to the `.PHONY` list.
- [x] 1.6 Add a `scripts/check-openspec-lifecycle.js` row to the `AGENTS.md` "Where Things Live" table and an `openspec/` row describing the change/archive/specs layout.

## 2. Task parsing and marker parsing

- [x] 2.1 Recognise checkboxes at any indentation and with `-` or `*` markers; capture indentation depth and text so an unchecked sub-task can be reported by its own line.
- [x] 2.2 Write a balanced-parenthesis scanner that, given a task line and a marker name, returns the marker's reason and the line with the marker span removed; use it for both `(deferred: ...)` and `(resolved: ...)`.
- [x] 2.3 Keep the placeholder suppression so a line documenting `(deferred: <reason>)` produces no queue entry.
- [x] 2.4 Replace the `OPERATOR_BLOCKER_MARKERS` phrase list with detection of an explicit `(operator-only)` tag, and delete the phrase list.
- [x] 2.5 Read each `tasks.md` once per run and reuse the parsed rows across the archive, deferral, and check passes.

## 3. Validation and the archive gate

- [x] 3.1 Compute a change's structural issues first, and make archive eligibility require both zero issues and every checkbox checked.
- [x] 3.2 Make the default run report-only: print archive-eligible changes, deferral candidates, and structural issues, and name the archive command instead of running it.
- [x] 3.3 Implement `--archive` with a `fs.renameSync` move and an `EXDEV` fallback to recursive copy-then-remove, so a move is total or absent; report each move by source and destination.
- [x] 3.4 Implement `--archive --dry-run` to print every source and destination it would use and write nothing.
- [x] 3.5 Keep the numbered-suffix collision resolution, computing the date once per run so a midnight crossing cannot produce an unchecked destination name.
- [x] 3.6 Exit non-zero when any structural issue is found; exit zero for a clean run and for `--operator-queue`.

## 4. Canonical specs and delta promotion

- [x] 4.1 Discover canonical specs by recursive walk under `openspec/specs/` instead of a one-level glob.
- [x] 4.2 Match `## Purpose`, `## Requirements`, and the delta headers as anchored whole heading lines, so an `###` heading no longer satisfies an `##` check.
- [x] 4.3 Build a promotion plan for an archive candidate: one entry per `specs/<capability>/spec.md` delta it carries, with the canonical destination.
- [x] 4.4 Promote a delta whose canonical destination is absent by stripping the delta requirements header and writing a canonical spec with `## Purpose` and `## Requirements` sections; verify the result passes `checkCanonicalSpecs`.
- [x] 4.5 Refuse the whole archive operation when any destination already exists: report the delta and the canonical file, move nothing, and exit non-zero.
- [x] 4.6 Promote the conflict-free archived deltas into `openspec/specs/`: `shared-browser-word-primitives` and `dictionary-script-toolchain`, both single-source and ADDED-only. Both promoted specs pass `checkCanonicalSpecs`.
- [ ] 4.7 Build the canonical `deterministic-chu-nom-entry-workflow` spec. Blocked, and deliberately not guessed at: three changes contribute to it, two of them archived with `MODIFIED`/`REMOVED` deltas, and the change that owns the base requirements (`delegate-add-chu-nom-to-nodejs`) is still active with an open task. The base must ship before the layered deltas can be merged, and the merge is editorial.
- [ ] 4.8 Preflight canonical destinations across the entire eligible batch and make promotion plus directory moves failure-atomic, including rollback of partial canonical writes/copies.

## 5. Tests

- [x] 5.1 Add `test/openspec-lifecycle.test.js` that builds fixture trees under a temporary directory, so no test reads or writes the repository's own `openspec/`.
- [x] 5.2 Test that a bare run writes nothing, that `--archive --dry-run` writes nothing, and that `--archive` moves the directory.
- [x] 5.3 Test that a fully checked change missing `proposal.md` is not archived and exits non-zero.
- [x] 5.4 Test that a checked parent with an unchecked indented sub-task blocks archiving and that the sub-task is named in the output.
- [x] 5.5 Test the marker scanner against `... (deferred: needs browser) then rerun make verify (see docs/build.md)` and `(deferred: needs Chrome (v120) installed)`, asserting both the reason and the preserved summary.
- [x] 5.6 Test that a missing canonical spec is created from a delta without a delta header, and that an existing one causes a refusal with nothing moved.
- [x] 5.7 Test the anchored heading checks against a spec whose only `Purpose` is an `###` heading and one where `### Requirements overview` precedes the real `## Requirements`.
- [x] 5.8 Test that an untagged unchecked task is not a deferral candidate and that an `(operator-only)` tagged one is, and that neither is treated as complete.
- [x] 5.9 Test archive destination collision handling produces a suffixed directory and leaves the existing one intact.
- [ ] 5.10 Test that two eligible changes targeting the same absent capability fail whole-batch preflight and leave both active changes plus canonical specs untouched.
- [ ] 5.11 Inject canonical-write, rename, EXDEV-copy, and cleanup failures and prove archive rollback restores the exact pre-run tree without partial destinations.

## 6. Correct the archived verification record

- [x] 6.1 In `openspec/changes/archive/2026-08-11-streamline-agent-workflow-surface/tasks.md`, mark task 6.3 as `- [x] ... (deferred: needs a Chrome profile with the unpacked extension loaded; unavailable in this environment)`, matching the verification note in the same file.
- [x] 6.2 Mark task 6.5 the same way, citing the missing userscript manager, and keep the wording consistent with the verification note.
- [x] 6.3 Mark task 6.4 as deferred for the unobserved popup card only, preserving the note's record that the shared primitives, `getWordAndContext`, and `generateCandidates` were confirmed in a real browser.
- [x] 6.4 Update the "Verification notes" section so it and the checkboxes state the same thing, and remove the now-contradictory sentence that 6.3 and 6.5 "remain open" in favour of pointing at the deferral markers.
- [x] 6.5 Run the operator queue and confirm all three verifications appear with accurate reasons.

## 7. Verification

- [x] 7.1 Run `make verify` and confirm every suite passes and every script under `scripts/` syntax-checks, including the new one.
- [x] 7.2 Run `make check-openspec` on the real repository and confirm it reports cleanly, writes nothing, and leaves `git status --short` empty.
- [x] 7.3 Run `make check-openspec ARCHIVE=1 DRY_RUN=1` on a scratch copy of the repository and confirm the planned moves and promotions are the expected ones.
- [x] 7.4 Confirm `grep -rn "check_openspec_lifecycle" .` returns nothing outside this change's own documents.
- [ ] 7.5 Perform the three deferred browser verifications from `2026-08-11-streamline-agent-workflow-surface` and mark them `(resolved: <date> ...)` once done. (operator-only)
