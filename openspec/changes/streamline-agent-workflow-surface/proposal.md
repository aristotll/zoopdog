## Why

Every agent-facing surface in this repository makes an assistant pay for the same information twice. `/add-chu-nom` writes a full manifest to disk but returns only a summary, so the agent must read the whole JSON — source hashes, source-item metadata, provenance — to review a handful of words. It then has to hand-edit that JSON to record decisions, because no command exists to record them, and `validateManifest` rejects the result at the first of roughly thirty strict checks with a bare message and no remedy. The predictable outcome is a read-edit-fail-guess-retry loop over the most token-expensive artifact in the workflow.

The same duplication runs through the browser code and the documentation. `getWordAndContext` and its supporting primitives exist in three copies — extension, website, and userscript — and have already diverged: the extension copy guards a null `range`, the website copy falls back to `caretRangeFromPoint(pageX, pageY)`, and neither has the other's fix. `AGENTS.md` spends 194 lines restating a workflow it simultaneously declares is owned by `.codex/commands/add-chu-nom.md`, and mandates reading `.claude/no-autoload-rules/*.md` at the start of every session even though the scripts already enforce two of the three rules stored there.

## What Changes

**Review loop that does not require hand-editing the manifest**

- `plan` emits a compact `review` projection on stdout — `id`, `original`, `vi`, `nom`, `explain`, `status`, `provenance`, `notes`, `choices`, with empty arrays omitted — so reviewing a batch no longer requires reading the manifest file.
- A new `review` subcommand records decisions: `review --manifest <path> --decisions <path|->` accepts a small array of `{id, decision, nom?, explain?, vi?, replace?}` objects, merges them into the manifest atomically, and re-emits the updated projection. Source hashes, entry ids, and source-item metadata are not writable through this surface.
- `review` reports **every** validation failure at once instead of throwing on the first, and is idempotent, so the revise-and-re-present cycle is one command rather than a hand-edit.
- `review` exits non-zero while any actionable entry lacks a decision or any value fails validation, moving failure detection out of `apply`.

**Errors an agent can act on**

- `WorkflowError` carries a stable `code` from a frozen enum plus a `hint` naming the corrective action; the structured stderr result reports both. Exit codes are unchanged.

**One definition of the Vietnamese word primitives**

- A new `zd-extension/js/zd-words.js` holds the Vietnamese word character class, `getWordAndContext`, `generateCandidates`, and `mouseInRects` as globals with no bundler or module system. `getWordAndContext` merges both fixes that currently exist in only one copy each.
- The extension loads it through `manifest.json`, the website through `popupdict.jade`, and the userscript builder inlines it through a `__ZOOPDOG_*__` placeholder like the existing runtime sources. The three local copies are deleted.

**Documentation that costs less to load**

- `AGENTS.md` becomes a router: communication, project overview, a directory-level path map, editing rules, git hygiene, and pointers to `docs/build.md` and `docs/dictionary-data.md`. Its restatement of the `/add-chu-nom` workflow is removed, leaving `.codex/commands/add-chu-nom.md` as sole owner.
- **BREAKING (agent instructions):** the instruction to read `.claude/no-autoload-rules/*.md` at session start is removed, reversing the corresponding requirement added by `harden-chu-nom-workflow`. The Vietnamese-word-order rule moves into the command document's review section, where it is actually applied; the two rules the scripts already enforce move to `docs/history/chu-nom-lessons.md` as a record.

## Capabilities

### New Capabilities

- `shared-browser-word-primitives`: a single definition of the Vietnamese word character class and cursor-to-word extraction, consumed unchanged by the extension, the website, and the generated userscripts, with a structural test that fails on any redefinition.

### Modified Capabilities

- `deterministic-chu-nom-entry-workflow`: adds requirements for a compact review projection, a decision-recording command with a restricted writable surface, exhaustive validation reporting, and actionable error codes; changes the repository-documentation requirement so agent context is a router rather than a duplicate of the command document, and so no session-start local-rules read is mandated.

## Impact

- `scripts/add-chu-nom.js` — new `review` command, argument parsing, and result shapes.
- `scripts/add-chu-nom/manifest.js` — validation split into a pure, error-collecting function; the `--approve` gate stays on the apply path.
- `scripts/add-chu-nom/errors.js` — `ERROR_CODES` enum, `code` and `hint` on every raise site.
- `scripts/add-chu-nom/plan.js` — review projection.
- New `zd-extension/js/zd-words.js`; edits to `zd-extension/js/content.js`, `zd-extension/manifest.json`, `js/popupdict.js`, `popupdict.jade` and its generated `popupdict.html`, `scripts/userscript/popupdict.runtime.js`, `scripts/build-popupdict-userscript.js`.
- `test/add-chu-nom.test.js` and `test/scripts-structure.test.js` — coverage for the review loop, the error-code enum, and single-definition enforcement across browser code.
- `AGENTS.md`, `.codex/commands/add-chu-nom.md`; new `docs/build.md`, `docs/dictionary-data.md`, `docs/history/chu-nom-lessons.md`; removal of `.claude/no-autoload-rules/chu-nom.md`.
- No change to `zd-extension/db_src/*` data or to userscript runtime behavior. Generated userscript bytes change because the primitives are inlined from a new source; the existing deterministic-rebuild contract is unaffected.
- Depends on `harden-chu-nom-workflow`, whose modules and documentation requirements this change builds on and, for the local-rules instruction, supersedes.
