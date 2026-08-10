## Why

The current `/add-chu-nom` command describes parsing, normalization, dictionary lookup, file mutation, rebuilding, and verification as prose for an agent to execute, so identical inputs can take different mechanical paths and are difficult to invoke outside Codex. Moving those mechanics behind a reusable Node.js CLI will make the workflow repeatable across programmatic callers, Codex, and Claude while retaining explicit human review for ambiguous linguistic choices.

## What Changes

- Add a repository-local Node.js CommonJS CLI that implements the Chu Nom entry workflow as deterministic, machine-readable `plan` and `apply` phases and reuses the project's existing dictionary helpers.
- Make preprocessing, phrase expansion, local dictionary lookup, duplicate detection, approved-entry upsert, source-file cleanup, userscript rebuilding, and verification reproducible for the same repository state and inputs.
- Represent the review boundary with a persisted JSON manifest: planning never mutates tracked dictionary/generated files, and applying requires an explicitly approved, validated manifest.
- Accept mixed Vietnamese/CJK input such as `đích的 thực食` as one phrase per line, discard the embedded non-Vietnamese characters, resolve the clean Vietnamese phrase only from dictionary evidence, and force the result through AI-assisted review.
- Return structured output and stable exit codes so humans, Node.js callers, Codex commands, Claude commands, and subprocess callers can consume the same behavior.
- Refactor `.codex/commands/add-chu-nom.md` into a thin orchestration prompt that invokes the Node.js CLI, presents unresolved/uncertain candidates for review, records approved edits in the manifest, and delegates mutation and verification back to the CLI.
- Add `.claude/commands/add-chu-nom.md` as a minimal reference document linking to the canonical Codex command instructions, avoiding a second copy of the workflow.
- Preserve the existing user-visible workflow and guardrails, including Vietnamese diacritics, no direct editing of generated userscripts, no mutation before approval, and no changes to `vnedict2.json`.

## Capabilities

### New Capabilities

- `deterministic-chu-nom-entry-workflow`: Defines the two-phase Node.js CLI contract, deterministic candidate planning, explicit approval handoff, safe application, generated-output verification, canonical Codex command delegation, and Claude reference behavior.

### Modified Capabilities

None.

## Impact

- Affected paths include a new JavaScript CLI under `scripts/`, shared exports from `scripts/user-nom-entries.js`, focused `node:test` tests/fixtures, the canonical `.codex/commands/add-chu-nom.md`, a reference-only `.claude/commands/add-chu-nom.md`, `zd-extension/db_src/user_nom_entries.jsonc`, optional input files, and the two generated userscripts.
- The CLI reads `vnedict2.json`, optional `mdx_nom.json`, and existing user entries as sources of truth; it invokes the existing Node build scripts instead of replacing their generation logic.
- No runtime website or Chrome-extension API changes and no new package dependency are introduced. Node.js remains the single scripting/build runtime for this workflow.
