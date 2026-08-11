## Why

`scripts/check_openspec_lifecycle.py` archives change directories before it validates them, decides "complete" from a checkbox parse that cannot see nested tasks, mutates the working tree on a bare run of a command named `check`, and never promotes spec deltas into `openspec/specs/` — so a structurally broken or half-finished change can be moved out of the gate's reach and its specs buried, silently. It also sits outside the repository's single verification command: `make verify` syntax-checks only `scripts/*.js`, and `test/scripts-structure.test.js` enumerates only `.js`, so 263 lines of directory-moving code ship with no test and no syntax check.

The first real use of the tool already failed this way: verification tasks 6.3–6.5 of `streamline-agent-workflow-surface` were flipped to `[x]` — contradicting the "Verification notes" prose in the same file, which still records 6.3 and 6.5 as open and 6.4 as only partially observed — and the change was then archived on the strength of those flips.

## What Changes

- **BREAKING**: Replace `scripts/check_openspec_lifecycle.py` with a Node.js CLI at `scripts/check-openspec-lifecycle.js`, so lifecycle tooling runs on the repository's single documented runtime, inherits the `make verify` syntax check, and can be covered by `node:test` and the existing structural contracts. The `python3` invocation is removed.
- Split the command into an inspection default and an explicit mutation: a bare run only reports and never touches the filesystem; archiving happens only under an explicit flag, and a dry-run names every directory it would move.
- Validate a change **before** archiving it, and refuse to archive any change that has structural issues, so no change can leave the gate by being moved out of it.
- Parse task checkboxes at any indentation depth, so a nested unchecked sub-task keeps its change out of the archive.
- Promote each archived change's `specs/**/spec.md` deltas into canonical `openspec/specs/<capability>/spec.md`, and report the promotion, so archiving stops discarding the spec content it was created to preserve.
- Validate canonical specs with line-anchored heading matching at any nesting depth, replacing substring containment that an `###` heading currently satisfies.
- Replace the 15 hardcoded English blocker phrases with one explicit `(operator-only)` task tag, and fix the deferral marker regexes so a summary is not truncated at the last parenthesis on the line and a reason is not cut at its first inner parenthesis.
- Add a `make check-openspec` target and record the tool in `AGENTS.md`, so the lifecycle check is reachable from the documented entry points.
- Add `test/openspec-lifecycle.test.js` covering the archive gate, nested-checkbox parsing, delta promotion, the deferral regexes, and the non-mutating default.
- Restore tasks 6.3–6.5 of the archived `streamline-agent-workflow-surface` change to their true state — unchecked, or checked with an accurate `(deferred: ...)` reason — so the record matches the verification notes beneath it and the outstanding browser verifications appear in the operator queue.

## Capabilities

### New Capabilities

- `openspec-lifecycle-tooling`: The lifecycle command's contract — task parsing, the validate-before-archive gate, non-mutating default behaviour, spec-delta promotion to canonical specs, canonical-spec structure checks, the deferral/operator-queue record, and toolchain integration.

### Modified Capabilities

None. `openspec/specs/` holds no canonical capability yet; this change creates the first one and the promotion path that fills the directory.

## Impact

- Affected paths: new `scripts/check-openspec-lifecycle.js`, deleted `scripts/check_openspec_lifecycle.py`, new `test/openspec-lifecycle.test.js`, `Makefile` (new target), `AGENTS.md` (path map entry), a new `openspec/specs/` tree populated by promotion, and `openspec/changes/archive/2026-08-11-streamline-agent-workflow-surface/tasks.md`.
- No website, Chrome-extension, dictionary, or userscript behaviour changes; no generated artifact is rebuilt. Node.js remains the single scripting runtime and the repository keeps its zero-dependency posture — the CLI uses only `node:fs`, `node:path`, and `node:util`.
- Archiving becomes opt-in, so any existing habit or automation that ran the bare command expecting directories to move must pass the new flag.
- The three changes already archived on 2026-08-11 carry four un-promoted spec deltas; promotion is applied to them as part of this change so canonical specs reflect what shipped.
