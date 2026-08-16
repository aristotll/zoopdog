## 1. Reproduce and specify concurrency

- [ ] 1.1 Add an isolated multi-process fixture that demonstrates two same-snapshot apply sessions can currently overlap and a failing rollback can overwrite a successful commit.
- [ ] 1.2 Add failing fixtures for concurrent review/apply, queued stale plan, killed process before/after mutation, ambiguous owner, and manual byte changes during rollback.
- [ ] 1.3 Define versioned lock-owner/journal schemas, stable result codes, bounded-wait semantics, and repository-local control-path discovery.

## 2. Lock and journal primitives

- [ ] 2.1 Implement import-safe atomic lock-directory acquisition/release with a unique token and owner metadata.
- [ ] 2.2 Implement atomic phase/file-hash journal updates and conservative local owner-liveness checks without external dependencies.
- [ ] 2.3 Implement explicit recovery planning/execution that never steals a merely old or ambiguously owned lock.
- [ ] 2.4 Unit-test lock contention, token mismatch, PID/start identity, journal corruption, ambiguous ownership, and safe no-mutation recovery.

## 3. Workflow integration

- [ ] 3.1 Wrap every review-manifest mutation in the repository-scoped lock and preserve comment/decision behavior.
- [ ] 3.2 Acquire the same lock before apply's final reads and hold it through post-lock hash validation, snapshot, writes, builds, verification, rollback, and commit.
- [ ] 3.3 Recompute all influencing source hashes after lock acquisition and return the stable stale-plan result before snapshot/write when they differ.
- [ ] 3.4 Guard rollback with lock-token and post-write-hash checks so foreign or manually changed bytes are never overwritten.
- [ ] 3.5 Add default fail-fast contention and explicit bounded-wait/recovery CLI options with compact human/JSON results and stable exit codes.

## 4. Concurrency and interruption verification

- [ ] 4.1 Prove concurrent applies serialize, the later plan becomes stale, and a failed transaction cannot remove a successful entry.
- [ ] 4.2 Prove review/apply conflicts do not lose decisions and busy/timeout paths make no workflow-owned change.
- [ ] 4.3 Prove interruption before mutation can recover cleanly and interruption after mutation either restores recognized bytes or stops for operator recovery.
- [ ] 4.4 Add the isolated concurrency/recovery suite to `make verify` and confirm it never locks or mutates the real repository workflow files.

## 5. Documentation and validation

- [ ] 5.1 Update `.codex/commands/add-chu-nom.md`, Make forwarding, and maintenance docs with busy/stale/recovery remedies and explicit bounded-wait guidance.
- [ ] 5.2 Run ordinary plan/review/apply regressions, full concurrency fixtures, `make verify`, and a direct-repo/submodule path-discovery check.
- [ ] 5.3 Validate all OpenSpec artifacts, confirm sequencing with `delegate-add-chu-nom-to-nodejs`, and reconcile every task with captured evidence.

