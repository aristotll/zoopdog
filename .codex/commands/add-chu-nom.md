---
description: Plan and apply reviewed Chu Nom/CJK user entries through the deterministic Node.js workflow.
---

# /add-chu-nom

`scripts/add-chu-nom.js` performs all parsing, normalization, local lookup, dictionary edits,
input cleanup, userscript generation, and verification. This command is the conversational
review layer only.

**Never edit the manifest by hand.** Record decisions with the `review` command; it is the only
supported way to write into a manifest, and it rejects any field that is not a decision.

## 1. Plan

Accept inline Vietnamese words/phrases or a file path/mention such as `.idea/newfile.md#L6-L7`.
When the user supplies neither, let the script use `.idea/newfile.md`.

Create a temporary manifest path outside the repository, then run exactly one planning form:

```sh
node scripts/add-chu-nom.js plan --words "<inline input>" --manifest "<manifest>"
```

```sh
node scripts/add-chu-nom.js plan --file "<path-or-file-mention>" --manifest "<manifest>"
```

```sh
node scripts/add-chu-nom.js plan --manifest "<manifest>"
```

The result carries a `review` array with everything needed to present the batch. Do not read
the manifest file — it holds integrity data that is not yours to inspect or change.

## 2. Review

Present a compact Vietnamese review table from the `review` array: original input, proposed
`vi`, `nom`, `explain`, status, and provenance/notes. Include skipped candidates and unresolved
choices.

Help resolve linguistic ambiguity only:

- **Preserve Vietnamese word order** in multi-word phrases and proper names. Do not translate
  into Chinese semantic order. `Sao Vàng` is `𣋀黃`, never `黄星`. When exact phrase data is
  missing, compose from verified component entries and mark the proposal as composed and
  uncertain so the user can check it.
- For candidates with `input-filtered` provenance, treat the removed characters as noise. Do
  not restore filtered characters as Nom evidence; review the cleaned Vietnamese phrase against
  local dictionary evidence.
- Supply or correct `nom` and a concise English `explain` where needed.

Record the reviewed values, giving every actionable entry a decision of `apply` or `reject`:

```sh
node scripts/add-chu-nom.js review --manifest "<manifest>" --decisions -
```

stdin takes a JSON array whose objects may set only `id`, `decision`, `nom`, `explain`, `vi`,
and `replace`:

```json
[{"id": "L6:I1:full", "decision": "apply", "nom": ["㗂英"], "explain": ["English language"]}]
```

`--decisions <path>` reads the same array from a file, which avoids shell quoting trouble with
Vietnamese and Chu Nom text.

`review` reports every outstanding problem at once, each with a `hint` naming the fix, and
exits non-zero until the manifest would pass the apply-time check. Resolve the reported issues
and run it again; it is idempotent, so re-running with corrected values replaces them.

Present the revised review to the user. Do not invoke apply, edit dictionary data, clean the
input file, or rebuild generated files before the user explicitly approves.

## 3. Apply after approval

After explicit approval, and only once `review` exits zero:

```sh
node scripts/add-chu-nom.js apply --manifest "<manifest>" --approve
```

Summarize the structured JSON result in Vietnamese: updated keys, skipped/rejected/unresolved
entries, removed input items, rebuilt files, and verification results. If the script reports a
validation, stale-source, build, or verification failure, report its `message` and `hint`
without bypassing the script or editing generated userscripts directly.

### Default apply decisions

`apply --approve` rejects the manifest outright unless every actionable entry already carries
an explicit `apply` or `reject` decision — there is no implicit default. An entry left with no
decision after `review` is unresolved and must go back through step 2; `apply` will not run
until each one is explicitly approved or explicitly rejected. Only entries recorded as `apply`
are upserted; `reject` leaves the corresponding dictionary key and input text untouched.

The Node.js CLI owns all mutation: `upsertEntries` merges approved entries into the sharded
`user_nom_entries.jsonc` store, so re-running `apply` with the same manifest, or a later batch
touching the same keys, is idempotent and duplicate-free — an existing key is overwritten in
place rather than appended again.

Preserve unrelated worktree changes throughout the workflow.

## Concurrency: workflow lock, busy/stale/recovery

`review` and `apply` serialize through a repository-local workflow lock (a `.zd-chu-nom-workflow/`
directory next to the repository root, gitignored) so two sessions can never race the same
dictionary files. This is normally invisible: the common uncontended case is silent and fast.
When it is not:

- **`workflow_busy` (exit 5).** Another session holds the lock right now. Report the owner
  info from the error's `details` (pid, operation, when it was acquired) and either wait and
  retry, or re-run the same command with `--wait-ms <n>` (`make add-chu-nom-apply ...
  WAIT_MS=<n>`) to queue for up to that many milliseconds instead of failing immediately. Never
  loop retries indefinitely yourself; pass `--wait-ms` instead.
- **`stale_source` (exit 3) on apply, even though `review` said the manifest was ready.** This
  means another session committed changes to a shared source (most often the sharded
  `user_nom_entries/` store) while this apply was queued behind the lock. The fix is the normal
  stale-source fix: re-run `plan`/`review` against the current state and get approval again.
  This is expected, safe behavior, not a bug — it is what stops a queued session from applying
  a decision made against data that no longer exists.
- **`workflow_lock_recovery_required` (exit 6).** An interrupted session (killed process, crashed
  build) left the lock in a state that cannot be resolved automatically — either the process
  that held it might still be running, or file bytes were found that do not match either the
  pre- or post-transaction state the interrupted session recorded. Do **not** delete
  `.zd-chu-nom-workflow/` by hand. Instead:
  1. Confirm no other add-chu-nom session (human or agent) is legitimately still running.
  2. Run `node scripts/add-chu-nom.js recover --repo-root <repo>` (or `make add-chu-nom-recover
     REPO_ROOT=<repo>`). If it succeeds, the lock is cleared and the workflow is usable again.
  3. If recovery itself reports `workflow_lock_recovery_required`, its `details` name the
     mismatched files. Inspect them (`git status`/`git diff` on the sharded
     `zd-extension/db_src/user_nom_entries/` files and the generated userscripts) and restore
     known-good bytes with `git checkout` before recovering the lock again.
