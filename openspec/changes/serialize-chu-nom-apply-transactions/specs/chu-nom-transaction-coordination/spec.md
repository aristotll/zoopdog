## ADDED Requirements

### Requirement: Workflow mutations have one repository-scoped owner
Every Chu Nôm review-manifest write and apply transaction SHALL acquire the same exclusive repository-scoped mutation lock before reading its final preimage or writing any workflow-owned file. Lock acquisition SHALL be atomic, and no second process may enter a mutation boundary while a live owner holds it.

#### Scenario: Two apply processes start together
- **WHEN** two approved manifests based on the same source snapshot invoke apply concurrently
- **THEN** exactly one process owns the mutation boundary and the other waits only if explicitly configured or returns the stable busy result without writing

#### Scenario: Review races with apply
- **WHEN** one process attempts to update review decisions while apply owns the lock
- **THEN** the review write does not overwrite the manifest or any workflow-owned source and reports the documented conflict behavior

### Requirement: Apply revalidates after acquiring ownership
After lock acquisition and immediately before snapshot or mutation, apply SHALL recompute and compare every source hash and path constraint that influenced the plan. A queued or otherwise stale manifest MUST fail without changing sources, generated artifacts, input cleanup, or the manifest.

#### Scenario: Waiting plan becomes stale
- **WHEN** an earlier transaction commits while a second valid-at-start session waits for ownership
- **THEN** the second session detects the changed source hash after acquiring the lock and exits with the stable stale-plan result before mutation

### Requirement: Rollback cannot overwrite foreign bytes
Rollback SHALL verify the current lock token and each transaction-owned post-write hash before restoring its recorded preimage. If ownership changed or current bytes do not belong to that transaction, rollback MUST stop with a recovery-required error and MUST NOT overwrite those bytes.

#### Scenario: One apply succeeds while another fails
- **WHEN** a failing process reaches rollback in a concurrency fixture and another process has committed a valid result
- **THEN** the successful bytes remain intact and the failing process cannot restore an older snapshot over them

#### Scenario: Manual edit appears during failure handling
- **WHEN** a workflow-owned file differs from both the transaction preimage and recorded post-write bytes
- **THEN** automatic rollback leaves it unchanged and reports the exact file as requiring operator recovery

### Requirement: Interrupted ownership is diagnosable and recoverable
The lock SHALL contain a versioned owner record and the transaction SHALL atomically journal its phase and relevant file hashes. An explicit recovery operation SHALL remove or resolve a stale lock only after establishing that its local owner is absent and that recovery will not overwrite unrecognized bytes; age alone MUST NOT authorize lock stealing.

#### Scenario: Process dies before mutation
- **WHEN** the recorded owner no longer exists and the journal shows no file mutation
- **THEN** explicit recovery safely clears the lock and reports the recovered owner and phase

#### Scenario: Process dies after mutation
- **WHEN** the owner is absent but the journal records incomplete writes
- **THEN** recovery verifies current hashes and either completes the documented safe restore or refuses with a recovery-required result without guessing

#### Scenario: Owner status is ambiguous
- **WHEN** the system cannot prove that the recorded owner is absent
- **THEN** recovery leaves the lock and all workflow files unchanged

### Requirement: Lock outcomes are automation-friendly
The CLI SHALL fail promptly by default on contention, SHALL allow only an explicit bounded wait, and SHALL expose stable result/error codes for busy, wait-timeout, stale-plan, ambiguous-owner, and recovery-required outcomes. Default diagnostics SHALL be compact and MUST NOT dump manifest contents or dictionary data.

#### Scenario: Live owner blocks an apply
- **WHEN** apply encounters a valid live lock with no wait option
- **THEN** it exits non-zero with `workflow_busy`, repository-relative operation metadata, and a deterministic remedy

#### Scenario: Bounded wait expires
- **WHEN** an explicitly configured wait duration elapses before ownership is available
- **THEN** apply exits with the stable timeout code and has made no workflow-owned change

### Requirement: Concurrency verification is isolated and deterministic
Automated tests SHALL spawn real competing Node.js processes against isolated fixture repositories and cover concurrent success, stale queued apply, failure rollback, review/apply conflict, interruption phases, and stale-lock recovery. Normal verification MUST NOT lock or mutate the real repository workflow files.

#### Scenario: Repository verification runs
- **WHEN** a maintainer runs `make verify`
- **THEN** concurrency tests use temporary fixture paths, finish without network access, and leave the real worktree unchanged

