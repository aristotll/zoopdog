## Context

The Node.js Chu Nôm workflow hashes source inputs during planning/validation, snapshots workflow-owned files, writes sources, rebuilds two userscripts, verifies them, and restores the snapshot on an in-process failure. No lock spans that sequence. Two sessions based on the same snapshot can therefore both validate; rollback from one process is unaware of another process's successful commit. Review-manifest updates have the same lost-update risk.

The solution must remain dependency-free, work from direct repository and submodule paths, and produce deterministic automation-friendly errors. It cannot make a killed process execute JavaScript cleanup, so ownership and stale recovery must be encoded on disk.

## Goals / Non-Goals

**Goals:**

- Serialize all workflow-owned mutations across processes.
- Revalidate plans at the mutation boundary and prevent foreign rollback.
- Recover safely from an interrupted process without silently stealing a live lock.
- Test concurrency and interruption deterministically with isolated fixture repositories.

**Non-Goals:**

- Coordinating arbitrary manual edits outside the workflow.
- Providing distributed locking across machines or network filesystems with weak filesystem semantics.
- Changing linguistic review decisions or source formats.
- Replacing the existing byte snapshot/rollback within one owned transaction.

## Decisions

1. **Use atomic repository-scoped lock-directory creation.** Create a workflow lock directory at a fixed repository-local control path using an operation that fails if it already exists. Store a versioned owner record with PID, process start token/time, operation, and manifest path. A plain advisory file opened for writing was rejected because it is easy to overwrite; OS-specific lock packages were rejected because the repository is dependency-free.

2. **Hold the lock across final validation through rollback/commit.** Planning remains read-only and unlocked, but review-manifest writes and apply acquire the same mutation lock. After acquiring it, apply recomputes every relevant source hash before snapshotting or writing. Waiting sessions therefore become stale cleanly rather than applying old decisions.

3. **Make lock behavior explicit and bounded.** Default CLI behavior fails promptly with a stable `workflow_busy` result and owner metadata; an explicit bounded wait option may queue automation. No unbounded retry is allowed. Output identifies the remedy without dumping the manifest or source data.

4. **Recover stale locks conservatively.** A separate explicit recovery path verifies that the recorded local process is absent and that no transaction journal indicates unresolved mutation. Age alone never proves staleness. If ownership is ambiguous, recovery fails and requests operator inspection.

5. **Tie rollback to owner and preimage.** Before restoring any file, verify the current lock token and the transaction's recorded post-write hash. If ownership or expected bytes differ, stop with a recovery-required error rather than overwrite foreign data. A small atomic journal records phase and file hashes so interruption can be diagnosed and recovered deliberately.

## Risks / Trade-offs

- **[Killed process leaves a lock]** → Persist owner/journal data and provide verified explicit recovery; never steal by timeout alone.
- **[PID reuse misidentifies a live owner]** → Include process-start identity where the platform exposes it and otherwise require conservative operator recovery.
- **[Manual edit during an owned transaction]** → Hash-check before rollback and refuse destructive restore if bytes are not the transaction's output.
- **[Lock adds CLI friction]** → Keep the normal uncontended path silent/fast and return compact owner/remedy fields only on conflict.

## Migration Plan

1. Add isolated multi-process tests that demonstrate the current lost-update/foreign-rollback race.
2. Implement lock and journal primitives with no repository mutations in import-time code.
3. Wrap review writes and the full apply mutation boundary, then add post-lock CAS validation.
4. Add safe rollback ownership checks, recovery CLI behavior, exit codes, Make forwarding, and documentation.
5. Run concurrency, interruption, stale-plan, and ordinary workflow regression tests. Rollback of this feature removes lock/journal integration only after confirming no unresolved journal exists.

## Open Questions

- The implementation must select the repository-local control directory name so it is ignored by Git yet discoverable from both direct-repo and submodule invocation paths.
