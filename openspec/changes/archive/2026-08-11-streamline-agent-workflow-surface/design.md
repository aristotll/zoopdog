## Context

The `/add-chu-nom` workflow already separates a deterministic Node.js writer from a conversational review layer, and `scripts/lib/` already establishes the rule that a primitive is defined once and imported everywhere. What is missing is the application of both principles to the surfaces an agent actually touches.

Today an agent runs `plan`, receives `{ok, action, manifest, summary}`, and must open the manifest file to see anything reviewable. The manifest mixes reviewable fields with integrity fields — `sourceHashes`, `source.items`, per-entry `id`, `sourceItemId`, `primary`, `key` — that exist so `validateManifest` can prove the plan still matches the bytes it was planned from. There is no command that writes decisions, so the agent edits that file directly, and `validateManifest` in `scripts/add-chu-nom/manifest.js` throws on the first of roughly thirty checks. An agent editing a strict structure it did not author, told only the first thing wrong, retries.

The browser code has the mirror problem. `zd-extension/js/content.js:1` and `js/popupdict.js:169` hold a byte-identical Vietnamese character class; `scripts/userscript/popupdict.runtime.js` holds a third literal whose character *set* is identical but whose ordering differs. The cursor-to-word functions around them have diverged: the extension copy guards a null `range` from `caretRangeFromPoint`, the website copy falls back to `caretRangeFromPoint(mouse.pageX, mouse.pageY)`. Each is a fix the other lacks.

`AGENTS.md` is loaded in full at the start of every session. Of its 194 lines, the dictionary-data and build-command sections restate what `.codex/commands/add-chu-nom.md` owns, which the file itself declares to be the sole canonical source. It also instructs the agent to read `.claude/no-autoload-rules/*.md` every session — 45 further lines, two of whose three rules the scripts now enforce mechanically.

## Goals / Non-Goals

**Goals:**

- Make the common `/add-chu-nom` path cost two script invocations and no manifest read.
- Make every failure reachable from the review loop self-describing: a stable code, a message, and the corrective action.
- Reduce the writable surface an agent can corrupt to a five-field decision object.
- Give the Vietnamese word primitives one definition, enforced by a test rather than by discipline.
- Reduce fixed per-session context without losing any instruction an agent depends on.

**Non-Goals:**

- No change to popup rendering, highlighting, or pronunciation code. `AGENTS.md`'s rule against broad rewrites in old browser-facing code stands.
- No change to dictionary data, to the merge and extract transforms, or to userscript runtime behavior.
- No new dependency, module system, bundler, or transpiler.
- The explicit-approval gate before `apply` is not relaxed, reshaped, or made implicit by the new `review` command.

## Decisions

### Review projection travels on `plan` stdout, not a separate command

`plan` already computes every field the projection needs. Emitting it in the same result makes the loop `plan` → `review` → `apply`, and `review` re-emits the updated projection so the revise cycle needs no extra call either. The rejected alternative, a `show --manifest` command, is one more invocation on the path that runs every time, to serve a case — re-inspecting without changing anything — that the `review` echo already covers.

The projection omits `sourceItemId`, `primary`, `key`, `sourceHashes`, and `source.items` because they exist for integrity checking, not for review, and it drops empty arrays. `skipped` entries stay in the projection with their reason, because the command document requires presenting them.

### Decisions are recorded through an allowlist, not by editing the manifest

`review --decisions` accepts only `{id, decision, nom?, explain?, vi?, replace?}`. Any other key is an error naming the offending key. This is what removes the retry class: the fields whose corruption produces the confusing failures — hashes, ids, source items — are not addressable at all, so no amount of agent error can reach them.

Accepting `-` for stdin keeps the common case to a single command with no temporary file. A file path is also accepted, because shell quoting of Vietnamese and CJK text in a heredoc is a real failure mode and a file sidesteps it.

The alternative — leave hand-editing in place and add a `validate` dry-run — was rejected. It shortens the feedback loop but leaves the agent authoring a structure with thirty invariants it cannot see.

### `validateManifest` splits into a pure collector and an enforcing caller

The validator becomes `collectManifestIssues(manifest, {repoRoot})`, returning `{errors, applicable}` with every issue found rather than the first. `review` prints the whole list. `apply` keeps the `--approve` gate and raises on the first collected error, preserving its current message text and exit codes so existing tests and callers see no change.

The current function also mutates entries in place — normalizing `vi`, `nom`, `explain`, and assigning `key` — as a side effect of validating. That normalization moves into an explicit step the apply path calls after collection succeeds, so validation can be run for reporting without writing to the manifest it inspects.

### Error codes are a frozen enum, and each raise site names one

`WorkflowError` currently derives `code` from the exit code, which yields three values across roughly thirty distinct failures. It gains a `code` argument drawn from a frozen `ERROR_CODES` map and a `hint` string. Exit codes stay as they are, so shell callers and the `Makefile` are unaffected. A test enumerates the raise sites and fails if one omits a code or uses a value outside the enum — the same enforcement style `test/scripts-structure.test.js` already applies to primitives.

### The word primitives live in `zd-extension/js/zd-words.js` as globals

Location: the website already loads `zd-extension/js/vnedict.json` from `js/popupdict.js:246`, and `scripts/build-popupdict-userscript.js` already reads `zd-extension/js/zd-pron-*.js`. Both consumers therefore already reach into that directory, so no new top-level `shared/` concept is introduced for one file.

Exposure: plain global assignment, guarded so `module.exports` is populated under Node for tests. This follows `zd-pron-functions.js`, which the extension, the website, and the userscript builder already share this way. ES modules were rejected because MV3 content scripts, a plain `<script>` tag on a static page, and a userscript IIFE do not share one module story, and `AGENTS.md` forbids adding a bundler to reconcile them.

Ordering: the extension lists `zd-words.js` before `content.js` in `manifest.json`'s `content_scripts.js` array, which Chrome injects in order; the website lists it before `js/popupdict.js`; the builder substitutes it at the top of the IIFE. A test asserts the extension ordering, because a silent reordering would produce a runtime `ReferenceError` no unit test would otherwise catch.

Character class: the three literals were compared programmatically and contain the same set of code points, differing only in ordering within the literal. The merged definition therefore changes no matching behavior. A test asserts set equality against the pre-change literals rather than relying on that inspection holding.

`getWordAndContext` merges both divergent fixes: the extension's null guard on the `caretRangeFromPoint` result and the website's `pageX`/`pageY` fallback. Each consumer gains the fix it was missing — the only intended behavior change in this change.

### `AGENTS.md` becomes a router and the lessons file is retired

The router keeps what applies to any task in the repository — communication language, the generated-asset policy, editing rules, git hygiene — plus a directory-level path map and pointers to `docs/build.md` and `docs/dictionary-data.md`. Per-file path enumeration and the restated `/add-chu-nom` procedure are removed; the command document is already declared the owner.

`harden-chu-nom-workflow` added a requirement that the documented local-rules path resolve to an existing directory. This change supersedes that: the mandate to read `.claude/no-autoload-rules/*.md` each session is removed rather than repaired. The word-order rule moves into the command document's review section, which is where an agent needs it and where it is loaded only when the workflow runs. The two rules the scripts enforce — skip terms already in `user_nom_entries.jsonc`, clean applied items from the input queue — become `docs/history/chu-nom-lessons.md`, a record of why the code behaves as it does rather than an instruction competing with the code.

## Risks / Trade-offs

- **Splitting the validator silently drops a check.** → The split is mechanical: each existing `throw` becomes a collected issue with its message unchanged. Every current assertion in `test/add-chu-nom.test.js` must pass untouched, and the apply path re-raises the first issue so its observable behavior is identical.
- **The pure validator diverges from the enforcing path over time.** → `apply` calls the same collector rather than keeping a parallel copy; there is one implementation with two callers.
- **Content-script load order breaks the extension at runtime, invisibly to unit tests.** → A test asserts `zd-words.js` precedes `content.js` in `manifest.json`, and the extension load steps in the manual verification checklist cover the popup path.
- **`popupdict.html` cannot be regenerated because `pug` is absent locally.** → The `.jade` edit is a single `<script>` line. If `pug` is unavailable, apply the equivalent one-line edit to the committed `popupdict.html` so source and generated file stay consistent, and say so in the final report, as `AGENTS.md` requires.
- **Generated userscript bytes change.** → Expected: the primitives move from inline literals to a substituted source. `test/scripts-structure.test.js:152` asserts rebuilds are *deterministic*, not that bytes are frozen, so that contract holds. Both userscripts are rebuilt and committed with the change.
- **Trimming `AGENTS.md` removes something an agent silently depended on.** → Nothing is deleted outright; build commands, dictionary-data procedures, and manual verification move to `docs/` and are linked from the router. Only the duplicated `/add-chu-nom` procedure is removed, and only because a canonical copy exists.
- **Stdin decisions mangle Vietnamese or CJK text through shell quoting.** → `--decisions` accepts a file path as well as `-`, and `review` echoes the stored `nom` and `explain` values back in its projection so a mangled value is visible before `apply`.

## Migration Plan

The change is additive at every step until the final deletions, so it can land incrementally:

1. `ERROR_CODES`, `code`, and `hint` — no caller-visible change beyond richer stderr.
2. The validator split, with existing tests as the regression gate.
3. The `review` projection and subcommand, while hand-editing still works.
4. `zd-words.js` plus its three consumers and the structural test; rebuild both userscripts.
5. Documentation restructure and removal of `.claude/no-autoload-rules/chu-nom.md`.

Rollback is per-step and independent: reverting the documentation commit does not touch the CLI, and reverting `zd-words.js` restores three self-contained copies. No data migration is involved, and no manifest written by the current `plan` becomes unreadable — the projection is added to the result, not substituted for the manifest.

## Open Questions

None. The character-set equivalence, the deterministic-rebuild contract, and the existing structural-test precedent were each verified against the repository before this design was written.
