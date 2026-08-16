## Why

`/add-chu-nom apply` validates a snapshot and then mutates and may roll back repository files without any cross-process lock or final compare-and-swap. Two valid concurrent sessions can therefore both begin, after which a failing session can restore its old snapshot over the other session's successful result; concurrent review writes can likewise lose decisions.

## What Changes

- Introduce repository-scoped coordination for every review-manifest write and apply transaction that can mutate Chu Nôm workflow-owned files.
- Acquire an exclusive, recoverable lock before final validation and hold it through source mutation, generated rebuilds, verification, commit, or rollback.
- Revalidate all source hashes after lock acquisition so a queued session cannot apply a stale plan.
- Define deterministic busy/stale-lock behavior, stable non-zero exit codes, compact diagnostics, and explicit operator remedies.
- Make rollback conditional on transaction ownership so it can never overwrite bytes committed by another session.
- Add multi-process tests for concurrent success, queued stale input, failure rollback, interruption, and stale-lock recovery.

## Capabilities

### New Capabilities

- `chu-nom-transaction-coordination`: Defines lock ownership, post-lock validation, safe rollback, concurrency semantics, and automation-facing results for Chu Nôm review/apply mutations.

### Modified Capabilities

- None. This capability composes with the active `deterministic-chu-nom-entry-workflow` change and must be implemented after its Node.js mutation boundary is established.

## Impact

The change affects `scripts/add-chu-nom.js`, `scripts/add-chu-nom/apply.js`, manifest-review writing, filesystem helpers, Make entry points, workflow tests, and `.codex/commands/add-chu-nom.md`. The manifest schema need not change, but automation callers gain stable lock-related errors and concurrent invocations become serialized or fail safely instead of racing.
