## 1. Baseline

- [x] 1.1 Run `node --test test/add-chu-nom.test.js` and record the passing baseline (34 tests) plus `git status --short` so later diffs are attributable.
- [x] 1.2 Capture SHA-256 hashes of `zoopdog-nom-ruby.user.js` and `zoopdog-popupdict.user.js` to prove the change leaves generated output byte-identical.

## 2. Behavior-neutral decomposition

- [x] 2.1 Create `scripts/add-chu-nom/errors.js` with `WorkflowError` and `EXIT_CODES` moved verbatim; import them back into `scripts/add-chu-nom.js`.
- [x] 2.2 Move `parseFileMention`, `isIgnoredMarkdownLine`, `splitLineRecords`, `parseMixedAnnotatedLine`, `parseInputText`, and `cleanupInputContent` verbatim into `scripts/add-chu-nom/input.js` (see design decision 5a).
- [x] 2.3 Move `foldAccents`, `levenshtein`, `extractNomCandidates`, `addIndexedEntry`, `loadLocalSources`, `resolveSpelling`, and `composeNom` verbatim into `scripts/add-chu-nom/sources.js`.
- [x] 2.4 Move `makeCandidate`, `resolveItems`, and `createPlan` verbatim into `scripts/add-chu-nom/plan.js`.
- [x] 2.5 Move `validateManifest` verbatim into `scripts/add-chu-nom/manifest.js`.
- [x] 2.6 Move the JSONC scanner and `upsertUserEntriesJsonc` verbatim into `scripts/add-chu-nom/jsonc.js`.
- [x] 2.7 Move `runChecked`, `defaultCommandRunner`, `extractAssignedJson`, and `applyManifest` verbatim into `scripts/add-chu-nom/apply.js`, and the filesystem primitives into `scripts/add-chu-nom/fsutil.js` (see design decision 5a).
- [x] 2.8 Reduce `scripts/add-chu-nom.js` to argument parsing, command dispatch, result writing, and a re-export object with the identical `module.exports` key set as before.
- [x] 2.9 Run the unmodified test suite and confirm all 34 tests still pass with no edits to `test/add-chu-nom.test.js`.
- [x] 2.10 Verify both generated userscripts still match the task 1.2 hashes after decomposition.

## 3. Duplicate candidate identity

- [x] 3.1 Add a failing test: `createPlan` on input repeating one term produces a manifest that `validateManifest` accepts and `applyManifest` applies.
- [x] 3.2 Add a failing test: repeating a term that already exists in `user_nom_entries.jsonc` plans and applies with zero approved entries and no validation error.
- [x] 3.3 In `resolveItems`, give the suppressed duplicate `primary: false` and an id derived from its source item, keeping a distinguishable duplicate reason in `notes`.
- [x] 3.4 Confirm `validateManifest`'s primary-identity rule is unchanged and that `removedItemIds` still derives only from applied primary entries.
- [x] 3.5 Make tasks 3.1 and 3.2 pass; re-run the full suite.

## 4. Separator-aware parsing and cleanup

- [x] 4.1 Add a failing test: `parseInputText('đích的 thực食, đánh打 lạc洛')` yields two items with Vietnamese `đích thực` and `đánh lạc`.
- [x] 4.2 Add a failing test: applying both items of that line removes the whole line, and applying only the first leaves exactly ` đánh打 lạc洛`.
- [x] 4.3 Add a passing-guard test that the single-item mixed line `đích的 thực食` still yields exactly one item with unchanged `rawInput` and `filteredInput` metadata.
- [x] 4.4 Reorder `parseInputText` so `splitLineRecords` runs first and `parseMixedAnnotatedLine` applies per record, assigning each item the record's own `itemIndex`.
- [x] 4.5 Verify `validateManifest`'s filtered-input re-parse still round-trips the per-record `rawInput`, and adjust it if the unit it re-parses changed.
- [x] 4.6 Make tasks 4.1 and 4.2 pass; re-run the full suite.

## 5. Non-destructive JSONC upsert

- [x] 5.1 Add a failing test: upserting `nom: ['㗂英']` over an existing entry with `nom: ['㗂英','㗂鶯']` keeps both values.
- [x] 5.2 Add a failing test: appending an entry to a file whose last content before `]` is a `//` comment produces valid JSONC with the comment preserved.
- [x] 5.3 Change the update path in `upsertUserEntriesJsonc` to merge `nom`/`explain` with the existing entry's values via `stableUnique`.
- [x] 5.4 Add the `replace: true` opt-in and reject it in `validateManifest` unless the entry is `needs-review` with an explicit apply decision.
- [x] 5.5 Replace the trailing-whitespace-trimming append with a span-based insertion that places the separating comma directly after the last entry's `end` offset.
- [x] 5.6 Route the update and append paths through one value-serialization helper so a file cannot accumulate two formatting styles; add a test asserting a round-trip update keeps the appended style.
- [x] 5.7 Make tasks 5.1 and 5.2 pass; re-run the full suite and confirm the idempotence test still holds.

## 6. Embed verification for non-embeddable keys

- [x] 6.1 Add a failing test: approving a key excluded by `isEmbeddableTerm` completes successfully instead of rolling the batch back.
- [x] 6.2 Export `isEmbeddableTerm` from `scripts/build-nom-userscript.js` and import it in the verification step rather than duplicating the rule.
- [x] 6.3 Verify excluded keys against `ZOO_DICTIONARY` only and report them in the structured result as intentionally not embedded.
- [x] 6.4 Confirm the existing "generated key is missing" rollback test still fails the apply for an eligible key.

## 7. Workflow and documentation

- [x] 7.1 Add a failing test asserting the local-rules directory named in `AGENTS.md` exists on disk.
- [x] 7.2 Add a failing test asserting no file outside `.codex/commands/` and `.claude/commands/` carries the `/add-chu-nom` command front matter.
- [x] 7.3 Fix the `AGENTS.md` local-rules path to `.claude/no-autoload-rules/*.md`.
- [x] 7.4 Replace the "no `package.json`, task runner, or test framework" claim with the actual Make targets and `node --test test/add-chu-nom.test.js`.
- [x] 7.5 Add `scripts/add-chu-nom.js`, `scripts/add-chu-nom/`, `test/add-chu-nom.test.js`, and `Makefile` to the Important Paths list.
- [x] 7.6 Rewrite the `/add-chu-nom` description in `AGENTS.md` so it names Node.js as the only writer and points at the canonical Codex command.
- [x] 7.7 Delete `codex-add-chu-nom-command.tmp.md`.
- [x] 7.8 Make tasks 7.1 and 7.2 pass; re-run the full suite.

## 8. Make target hardening

- [x] 8.1 Add a failing test asserting `make -n add-chu-nom-apply` without `MANIFEST` fails instead of emitting an apply command.
- [x] 8.2 Remove the shared-`/tmp` default from the apply path and add a guard that errors with a usage message when `MANIFEST` is empty.
- [x] 8.3 Update the `help` target text to match, keeping the existing target names and the `import-chu-nom` alias.
- [x] 8.4 Confirm the existing Makefile contract test still passes when `MANIFEST` is supplied.

## 9. Verification

- [x] 9.1 Run `make verify-add-chu-nom` and confirm every test passes and every syntax check is clean.
- [x] 9.2 Run `plan` twice against unchanged repository data and confirm identical manifests and no plan-induced `git status` changes.
- [x] 9.3 Run a full approved apply in an isolated temporary repository, then confirm the real repository's generated userscripts still match the hashes from task 1.2.
- [x] 9.4 Review the final diff and confirm it touches only `scripts/`, `test/`, `Makefile`, `AGENTS.md`, and the deleted temp command file — no dictionary data and no generated userscripts.
