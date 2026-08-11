## Why

A thorough review of `scripts/add-chu-nom.js` found defects that make the deterministic workflow fail or lose data on ordinary input: a repeated term makes every `apply` abort, a CJK-annotated line containing `,`/`;`/`|` collapses several phrases into one nonexistent term and then leaves already-applied text in the queue file, and the JSONC upsert silently discards existing Nom variants when a reviewed `vi` collides with an existing key. At the same time the 1,200-line single-file CLI mixes six unrelated concerns, and `AGENTS.md` still points at a renamed rules directory and denies that a task runner or test suite exists — so the documented workflow and the real workflow have drifted apart.

## What Changes

**Correctness**

- Duplicate candidates keep a stable, validator-accepted identity so a batch containing the same term twice plans and applies cleanly instead of failing validation.
- Mixed CJK-annotated lines are split on the documented separators (`,`, `;`, `|`) before Latin extraction, producing one candidate per item.
- Item indices assigned at parse time are the same indices input cleanup consumes, so applying an item removes exactly that item's text and nothing else.
- The JSONC upsert merges into an existing entry's `nom`/`explain` instead of replacing them, and refuses to shrink an existing entry without an explicit intent flag.
- Appending new entries after a trailing comment produces valid JSONC (comma placed after the last value, not inside the comment).
- Post-build verification accounts for keys the Nom builder intentionally does not embed, so a legitimate short key no longer rolls back an entire batch.

**Modularity**

- `scripts/add-chu-nom.js` is split into focused modules under `scripts/add-chu-nom/` — input parsing, local-source indexing and resolution, manifest validation, JSONC editing, and the apply transaction — with `scripts/add-chu-nom.js` reduced to CLI wiring. No behavior change beyond the fixes above; the public `module.exports` surface used by tests stays intact.

**Workflow and documentation**

- `AGENTS.md` is corrected: the local-rules path, the "no task runner or test framework" claim, the Important Paths list, and the `/add-chu-nom` description all describe the Make + Node.js workflow.
- The stray root-level `codex-add-chu-nom-command.tmp.md` is removed; a test asserts no duplicate copy of the command document exists outside `.codex/commands/`.
- The `Makefile` stops defaulting the manifest to a predictable shared `/tmp` path and requires `MANIFEST` explicitly for the apply target.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `deterministic-chu-nom-entry-workflow`: adds requirements for duplicate-candidate handling, separator-aware mixed-line parsing, cleanup index consistency, non-destructive JSONC upsert, comment-safe appends, module decomposition, and a single documented entry point for the workflow.

## Impact

- `scripts/add-chu-nom.js` (decomposed), new `scripts/add-chu-nom/*.js` modules.
- `test/add-chu-nom.test.js` — new regression tests for each defect; existing tests must keep passing unchanged.
- `Makefile` — manifest defaults and the apply target's guard.
- `AGENTS.md`, `.codex/commands/add-chu-nom.md`; deletion of `codex-add-chu-nom-command.tmp.md`.
- No change to `zd-extension/db_src/*` data, the builders' output bytes, or the generated userscripts.
- Depends on `delegate-add-chu-nom-to-nodejs`, which introduced the workflow being hardened.
