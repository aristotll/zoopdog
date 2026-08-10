## Context

`delegate-add-chu-nom-to-nodejs` moved the entire `/add-chu-nom` workflow into a single dependency-free CommonJS file, `scripts/add-chu-nom.js` (~1,220 lines), with a 960-line `node:test` suite. The design is sound — read-only `plan`, hash-gated `apply`, snapshot rollback, builders as the only writers of generated userscripts — but a code review found several defects that reproduce on ordinary input, plus documentation that no longer matches the code.

Reproduced against the current tree:

- `createPlan({words: 'kiểm tra\nkiểm tra'})` emits a second primary candidate with id `L2:I1:full:duplicate` while `primary` stays `true`; `validateManifest` requires every primary entry's id to be exactly `${sourceItemId}:full`, so apply aborts with exit code 2 for the whole batch.
- `parseInputText('đích的 thực食, đánh打 lạc洛')` returns one item whose `original` is `đích thực đánh lạc` — `parseMixedAnnotatedLine` maps every non-Latin character, including `,`/`;`/`|`, to a space. `cleanupInputContent` then re-derives indices with `splitLineRecords` and removes only the first segment, leaving ` đánh打 lạc洛` in `.idea/newfile.md`.
- `upsertUserEntriesJsonc` replaces `nom`/`explain` wholesale; upserting `nom: ['㗂英']` over an existing `nom: ['㗂英','㗂鶯']` drops `㗂鶯`.
- Appending an entry to a file whose last content before `]` is a `//` comment glues the separating comma into the comment, producing invalid JSONC and a full rollback.
- `AGENTS.md` still points at `.claude/rules/*.md` (renamed to `.claude/no-autoload-rules/` on this branch) and still asserts the repo has no task runner or test framework, which the new `Makefile` and `test/add-chu-nom.test.js` contradict. A scratch copy of the command, `codex-add-chu-nom-command.tmp.md`, was committed at the repo root and has already diverged from the canonical `.codex/commands/add-chu-nom.md`.

Constraints carried over from the repository: no `package.json`, no dependencies, no bundler, CommonJS only, generated artifacts tracked in git, and `node --test test/add-chu-nom.test.js` as the whole test story.

## Goals / Non-Goals

**Goals:**

- Fix every reproduced defect with a regression test that fails before the fix.
- Split the CLI into focused modules so each concern is unit-testable without spawning builders or reading dictionary sources.
- Keep `scripts/add-chu-nom.js`'s exported names, CLI flags, manifest schema, structured results, and exit codes byte-for-byte compatible, so the existing suite and the canonical Codex command keep working untouched.
- Make the documented workflow and the real workflow the same thing again.

**Non-Goals:**

- No change to linguistic resolution quality — subphrase expansion, composition, accent folding, and Levenshtein suggestions stay as they are.
- No manifest schema version bump; `schemaVersion` stays `1` because no field's meaning changes.
- No change to `zd-extension/db_src/*` data, to the builders' output bytes, or to the generated userscripts.
- No new dependency, no `package.json`, no test framework.

## Decisions

### 1. Fix duplicate candidates by clearing `primary`, not by loosening validation

`addCandidate` currently spreads the original candidate and only rewrites `id` and `status`, leaving `primary: true` on an id that no longer matches the `${sourceItemId}:full` contract. Two fixes were available: relax the validator to accept a `:duplicate` suffix, or make the suppressed copy non-primary.

Chosen: set `primary: false` on the suppressed copy and give it a distinct id derived from the source item (`${item.id}:duplicate`). The validator's primary-identity rule is a genuine integrity check — exactly one full-phrase entry per source item — and relaxing it would weaken the guard that catches tampered manifests. A suppressed duplicate is not the item's full-phrase entry; it is a record that the key was already claimed. Making that explicit in the data keeps the validator strict.

Consequence: `removedItemIds` is derived from primary approved entries, so a fully-duplicated item is never used for cleanup. That is correct — its text was not applied by that item.

*Alternative rejected*: dropping duplicates from the manifest entirely. The reviewer needs to see that the term was repeated; silently dropping it makes the manifest a poor audit record.

### 2. Split lines before mixed-CJK extraction

Move separator splitting ahead of the mixed-line detection: `splitLineRecords` runs first for every line, then each record is independently tested for CJK annotation. `parseMixedAnnotatedLine` becomes a per-record transform rather than a whole-line one.

This makes the item-index contract hold by construction — `parseInputText` and `cleanupInputContent` both index the same `splitLineRecords` output — which is the root cause of the cleanup residue, not a separate bug. The alternative (teaching `cleanupInputContent` about whole-line items) would leave two parsers that must agree, which is what broke in the first place.

The one behavior change a reviewer will notice: a mixed line with separators now yields several candidates instead of one merged phrase. That matches both the documented input contract and the existing `#### Scenario: Mixed Vietnamese and CJK line becomes one annotated phrase` (which uses a single-item line and still holds).

### 3. Merge on update; require an explicit flag to shrink an entry

`upsertUserEntriesJsonc` gains merge semantics: the resulting `nom`/`explain` are `stableUnique([...existing, ...approved])`. This makes the operation additive, matching the "duplicate-free and idempotent" promise in the command document and the `mergeUserNomEntriesIntoNomMap` behavior the builders already use.

Removal stays possible but must be deliberate: an entry may carry `replace: true` to opt into replacement. `validateManifest` rejects `replace: true` unless the entry is a `needs-review` entry with an explicit apply decision, so nothing can silently shrink an entry.

*Alternative rejected*: always replace, and rely on the reviewer to restate existing values. The reviewer sees the plan's candidate, not the file's current contents, so they cannot reliably restate what they never saw.

### 4. Insert the append separator by span, not by string trimming

The current append computes `updated.slice(0, close).replace(/\s*$/, '')` and appends `,`. Replace this with a structural insertion: reuse `findTopLevelObjectSpans` to locate the last entry's `end` offset, insert `,` immediately after that offset, and insert the new blocks after it. Comments and trailing trivia between the last entry and `]` are then preserved verbatim and never absorbed into the prefix.

The same span-based approach fixes the formatting inconsistency: both the update path and the append path serialize values through one helper so a file does not accumulate two styles.

### 5. Decompose into `scripts/add-chu-nom/` with the entry point as a facade

```
scripts/add-chu-nom.js            CLI arg parsing, command dispatch, exit codes, re-exports
scripts/add-chu-nom/errors.js     WorkflowError, EXIT_CODES
scripts/add-chu-nom/input.js      parseFileMention, splitLineRecords, parseInputText
scripts/add-chu-nom/sources.js    loadLocalSources, foldAccents, levenshtein, resolveSpelling, composeNom
scripts/add-chu-nom/plan.js       makeCandidate, resolveItems, createPlan
scripts/add-chu-nom/manifest.js   validateManifest
scripts/add-chu-nom/jsonc.js      JSONC scanning and upsertUserEntriesJsonc
scripts/add-chu-nom/apply.js      snapshot/restore, atomicWrite, builders, verification
```

The boundaries follow the data flow (text → items → candidates → manifest → files), so each module has one input type and one output type.

### 5a. Revised during implementation

Two adjustments were forced by the code itself:

- **`fsutil.js` exists after all.** The plan put `resolveInsideRoot` and `hashFile` in `apply.js`, but `plan.js` and `manifest.js` both need them while `apply.js` imports `manifest.js` — a require cycle. `scripts/add-chu-nom/fsutil.js` holds `hashFile`, `resolveInsideRoot`, `atomicWrite`, `snapshotFiles`, and `restoreSnapshot`. At five functions the original objection ("a two-function module costs more indirection than it saves") no longer applies.
- **`cleanupInputContent` lives in `input.js`, not `apply.js`.** It must agree with `parseInputText` about how a line divides into items — their disagreement *is* the residue bug. Co-locating them behind one `splitLineRecords` makes that contract local and visible instead of spread across two modules, which is the same reasoning as decision 2.

Two further small modules fell out: `patterns.js` (the two CJK regexes, consumed by `input.js`, `sources.js`, and `manifest.js`) and `util.js` (`stableUnique`, used by five modules). `modularize-dictionary-scripts` folds both into `scripts/lib/`.

`scripts/add-chu-nom.js` keeps its current `module.exports` object, re-exporting from the modules. The existing test file imports `../scripts/add-chu-nom` and must keep passing with zero edits — that is the refactor's correctness check.

*Alternative rejected*: leaving the file whole and only fixing bugs. At 1,220 lines with six concerns, every future fix re-reads the whole file; the review itself needed several passes to establish that `parseInputText` and `cleanupInputContent` disagree, which module boundaries would have made obvious.

### 6. Scope the `NOM_MAP` embed check to embeddable keys

`applyManifest` requires every approved key in both generated maps, but `build-nom-userscript.js`'s `isEmbeddableTerm` intentionally drops single-character ASCII terms. Import `isEmbeddableTerm` into the verification step (exporting it from the builder) rather than duplicating the rule, check `NOM_MAP` only for keys it accepts, and report the excluded keys in the structured result so the outcome stays visible instead of silently weaker.

### 7. Documentation gets a test, not just a fix

`AGENTS.md` corrections are easy to make and easy to re-break. Add assertions to `test/add-chu-nom.test.js` that the local-rules path named in `AGENTS.md` resolves to an existing directory, and that no file outside `.codex/commands/` and `.claude/commands/` contains the command's front-matter description. `codex-add-chu-nom-command.tmp.md` is deleted.

### 8. Make target requires `MANIFEST`

Replace the `MANIFEST ?= /tmp/zoopdog-add-chu-nom.json` default on the apply path with a guard that errors when `MANIFEST` is empty. Planning may still suggest a path in its help text, but nothing writes to or reads from a fixed name in a world-writable shared directory by default.

## Risks / Trade-offs

- **[Decomposition silently changes behavior]** → Move function bodies verbatim in a commit that touches no logic, run the existing 34-test suite unchanged, and confirm `git diff` on `zoopdog-nom-ruby.user.js` and `zoopdog-popupdict.user.js` is empty after a full plan/apply cycle in a temp fixture.
- **[Separator-first parsing changes existing plans]** → The change only affects lines that contain both CJK annotations and a separator; single-item mixed lines keep their current single-item behavior, which the existing scenario pins. Add a regression test for both shapes.
- **[Merge-on-update makes it harder to remove a bad Nom value]** → The `replace: true` opt-in exists for exactly that, and the structured apply result reports which values were merged versus replaced.
- **[Span-based append is more code than string trimming]** → It reuses `findTopLevelObjectSpans`, which is already exercised by the upsert tests, so the added surface is small and covered.
- **[Requiring `MANIFEST` breaks a maintainer's muscle memory]** → The failure is a usage message, not a wrong action; the help target is updated in the same change.

## Migration Plan

No data migration. `user_nom_entries.jsonc`, both generated userscripts, and the manifest schema are unchanged. Land the decomposition first (behavior-neutral, existing tests green), then each fix with its own failing-test-first commit. Rollback is a plain revert; nothing persists state across the change.

## Open Questions

- Should `replace: true` be surfaced in the canonical Codex command as a reviewer-facing option, or stay an internal escape hatch used only when the user explicitly asks to remove a stored Nom value? Leaning internal, to keep the review surface small.
