## 1. Structured errors

- [x] 1.1 Add a frozen `ERROR_CODES` enumeration to `scripts/add-chu-nom/errors.js` covering every distinct failure cause in the workflow, and extend `WorkflowError` with `code` and `hint` while keeping `exitCode` and `details` unchanged.
- [x] 1.2 Give every `throw new WorkflowError` site across `scripts/add-chu-nom.js` and `scripts/add-chu-nom/*.js` a code from the enumeration and a hint naming the corrective action.
- [x] 1.3 Change the stderr result in `scripts/add-chu-nom.js` to report the error's own `code` and `hint` instead of deriving a code from the exit code; leave exit-code values as they are.
- [x] 1.4 Add a test asserting every raise site supplies an enumerated code, that no two distinct causes share a code, and that exit codes for stale-source and validation failures are unchanged.

## 2. Validation split

- [x] 2.1 Extract `collectManifestIssues(manifest, {repoRoot})` from `validateManifest` in `scripts/add-chu-nom/manifest.js`, returning `{errors, applicable}` with every issue found and each existing message preserved verbatim.
- [x] 2.2 Move the entry normalization that `validateManifest` currently performs in place — `key` assignment and `vi`/`nom`/`explain` cleaning — into an explicit step the apply path calls after collection succeeds, so collection has no side effects.
- [x] 2.3 Rewrite `validateManifest` as a thin caller that enforces `--approve`, calls the collector, and raises the first collected issue, so its observable behavior and messages are identical.
- [x] 2.4 Run `node --test test/add-chu-nom.test.js` and confirm every existing assertion passes without modification.
- [x] 2.5 Add a test asserting `collectManifestIssues` reports multiple independent defects in one call and leaves the manifest bytes unchanged.

## 3. Review projection and command

- [x] 3.1 Add a projection builder in `scripts/add-chu-nom/plan.js` emitting `id`, `original`, `vi`, `nom`, `explain`, `status`, `provenance`, `notes`, and `choices`, omitting empty collections and excluding `sourceItemId`, `primary`, `key`, `sourceHashes`, and `source.items`.
- [x] 3.2 Include the projection in the `plan` stdout result alongside the existing `manifest` path and `summary`.
- [x] 3.3 Add a `review` command to `scripts/add-chu-nom.js` accepting `--manifest` and `--decisions <path|->`, parsing a decision array whose objects allow only `id`, `decision`, `nom`, `explain`, `vi`, and `replace`, and rejecting any other field by name.
- [x] 3.4 Merge accepted decisions into the manifest with `atomicWrite`, then call `collectManifestIssues` and emit the updated projection plus every issue found.
- [x] 3.5 Exit non-zero from `review` while any actionable entry lacks an apply/reject decision or any value fails validation; exit zero only when an approved apply would pass.
- [x] 3.6 Add tests: decisions recorded without editing the manifest, an unrecognized field rejected with the manifest unchanged, integrity fields unreachable, re-running with a corrected value replacing only the named entry, and Vietnamese/CJK values surviving both stdin and file input byte-identically.
- [x] 3.7 Add a `review` target to the `Makefile` alongside the existing plan and apply targets, requiring `MANIFEST` under the same guard.

## 4. Shared browser word primitives

- [x] 4.1 Create `zd-extension/js/zd-words.js` defining the Vietnamese word character class, `getWordAndContext`, `generateCandidates`, and `mouseInRects` as globals, guarded so `module.exports` is populated under Node.
- [x] 4.2 Merge both divergent fixes into `getWordAndContext`: the null guard on the caret-range result and the `pageX`/`pageY` fallback.
- [x] 4.3 Add a test asserting the consolidated character class matches the same code-point set as the three pre-change literals, with none added or removed.
- [x] 4.4 Add `zd-extension/js/zd-words.js` to `zd-extension/manifest.json` ahead of `content.js`, and delete the now-duplicate definitions from `zd-extension/js/content.js`.
- [x] 4.5 Add the script to `popupdict.jade` ahead of `js/popupdict.js`, recompile `popupdict.html`, and delete the duplicate definitions from `js/popupdict.js`. If `pug` is unavailable, apply the equivalent single-line edit to the committed `popupdict.html` and record that in the final report.
- [x] 4.6 Add a `__ZOOPDOG_WORD_PRIMITIVES__` placeholder to `scripts/userscript/popupdict.runtime.js`, remove `ZOO_WORD_CHAR_RE` and the local primitive copies, and substitute the shared source in `scripts/build-popupdict-userscript.js` following the existing runtime-source mechanism.
- [x] 4.7 Extend `test/scripts-structure.test.js` so the character class and each primitive name appear exactly once across `js/`, `zd-extension/js/` excluding `lib/`, and `scripts/userscript/`, and so the manifest content-script ordering is asserted.
- [x] 4.8 Add unit tests importing `zd-words.js` under Node and covering the merged `getWordAndContext` behaviors — no caret range, and client coordinates yielding no range while page coordinates do.
- [x] 4.9 Rebuild both userscripts with `make rebuild-userscripts` and commit the regenerated files.

## 5. Documentation restructure

- [x] 5.1 Create `docs/build.md` with the pug and stylus compilation commands, the verification commands, and the manual verification checklists moved out of `AGENTS.md`.
- [x] 5.2 Create `docs/dictionary-data.md` with the MDX extraction, merge, and userscript rebuild procedures moved out of `AGENTS.md`.
- [x] 5.3 Create `docs/history/chu-nom-lessons.md` holding the two lessons the scripts now enforce — skipping terms already in `user_nom_entries.jsonc`, and removing applied items from the input queue — as a record of why the code behaves as it does.
- [x] 5.4 Move the Vietnamese-word-order rule into the review section of `.codex/commands/add-chu-nom.md`, with its worked example.
- [x] 5.5 Update `.codex/commands/add-chu-nom.md` to describe the `plan` → `review` → `apply` loop, stating that the manifest is never edited by hand and that approval remains required before apply.
- [x] 5.6 Rewrite `AGENTS.md` as a router: communication, project overview, a directory-level path map, editing rules, git hygiene, and pointers to the new `docs/` files and the command document. Remove the restated `/add-chu-nom` procedure and the session-start local-rules instruction.
- [x] 5.7 Delete `.claude/no-autoload-rules/chu-nom.md` and confirm no remaining reference to that directory exists in the repository.
- [x] 5.8 Add a test asserting `AGENTS.md` contains no session-start local-rules instruction and no duplicate of the command document's procedure, extending the existing single-canonical-copy check.

## 6. Verification

- [x] 6.1 Run `make verify` and confirm every suite passes and every script under `scripts/` syntax-checks.
- [x] 6.2 Exercise the full loop end to end on a scratch manifest outside the repository: `plan`, `review` with decisions on stdin, `review` again with a corrected value, then approved `apply`; confirm no manifest file was read or edited by hand.
- [x] 6.3 Load `zd-extension/` as an unpacked extension and verify popup lookup, highlighting, and dialect selection still work on a normal page. (deferred: needs a Chrome profile with the unpacked extension loaded, which is not available in this environment) (operator-only)
- [x] 6.4 Open `popupdict.html` directly in a browser and verify hover popup behavior is unchanged. (deferred: the popup card itself was never observed because blocked external font requests stall the demo page's init; the underlying primitives were confirmed) (operator-only)
- [x] 6.5 Install a rebuilt userscript and verify word detection and popup lookup are unchanged. (deferred: needs a userscript manager, which is not available in this environment) (operator-only)
- [x] 6.6 Run `git status --short` and confirm the commit contains each source edit together with its generated artifact, with no unrelated worktree change reverted.

### Verification notes

- 6.2 covered `plan` → `review` (stdin) → `review` (correction) → apply-time validation clean.
  The approved `apply` leg itself was not run against the working repository so no dictionary
  entry was added without being asked for; that leg is covered by the isolated end-to-end suite
  test, which runs the real builders against a temporary repository root.
- 6.3, 6.4 and 6.5 carry `(deferred: ...)` markers rather than a plain check: none of them was
  fully performed, and `make check-openspec --operator-queue` is where they wait for an operator.
  They were briefly recorded as plainly complete; the markers restore what these notes have
  said all along.
- 6.4 confirmed in a real browser that the shared primitives load, that `getWordAndContext`
  resolves the correct word and context at real coordinates, that `generateCandidates` produces
  the expected candidates, and that no console errors remain. The popup card itself could not be
  observed: this environment blocks the page's external font requests, so Pace never fires
  `done`, the demo page never finishes its init, and the result iframe is never injected. That
  stall is independent of this change.
- Verification caught a regression the plan had not anticipated: `zd-extension/js/highlighter.js`
  used the global `chars` that both consumers happened to define. Consolidating removed both
  definitions and broke it in the extension and on the website. It now calls the shared
  `zdIsWordChar`, and a structural test fails on any `.match(chars)`/`.test(chars)` use, plus
  the load-order guards now cover every consumer rather than only `content.js`.
