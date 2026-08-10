## Context

`.codex/commands/add-chu-nom.md` currently asks an agent to carry out both linguistic judgment and mechanical repository operations. The same prose covers input parsing, Vietnamese normalization, phrase expansion, three dictionary sources, duplicate handling, JSONC-preserving edits, input cleanup, two Node builds, and generated-data checks. That leaves routine behavior dependent on how an individual agent interprets the instructions, duplicates behavior already present in JavaScript helpers, and provides no equivalent Claude command.

The repository has no package manager or test framework. The implementation must remain lightweight, preserve comments in `user_nom_entries.jsonc`, use the existing Node generators as the only writers of generated userscripts, and leave unrelated dirty worktree changes untouched. A deterministic program cannot safely invent a Chu Nom spelling or English explanation when local evidence is absent or ambiguous, so the review boundary remains part of the architecture.

## Goals / Non-Goals

**Goals:**

- Provide one Node.js CommonJS entry point that is usable as a CLI and importable by JavaScript callers.
- Produce the same ordered plan and apply result for the same arguments and repository bytes.
- Separate read-only planning from explicitly approved mutation with a machine-readable manifest.
- Centralize normalization, source selection, candidate expansion, local lookup, duplicate detection, JSONC upsert, file-input cleanup, build invocation, and verification.
- Keep the Codex command responsible only for gathering input, helping with unresolved linguistic decisions, showing the review, and invoking the script; expose it to Claude through a reference-only command document.
- Make failures detectable through structured output, stable exit classes, and transactional rollback of workflow-owned files.

**Non-Goals:**

- Automatically choose among genuinely ambiguous Vietnamese corrections or Chu Nom variants.
- Use a network service or language model from the Node.js script.
- Replace the existing Node userscript generators or change runtime dictionary behavior.
- Modify `vnedict2.json`, merge MDX data, remove existing user entries, or bypass user approval.
- Introduce a third-party npm dependency, TypeScript/transpilation step, `package.json`, or repository-wide test framework.

## Decisions

### 1. Use a dependency-free Node.js CommonJS module with `plan` and `apply` subcommands

Add `scripts/add-chu-nom.js` with a `#!/usr/bin/env node` entry point, `require.main === module` CLI guard, exported `main(argv, io)` function, and small exported pure functions for parsing, normalization, lookup, manifest validation, and mutations. The script resolves the repository root relative to `__dirname` by default and accepts an explicit root for isolated tests. UTF-8 and NFC are used at every file/API boundary.

Extend `scripts/user-nom-entries.js` to export its existing `cleanText`, `normalizeTerm`, `stripJsonComments`, and array-normalization helpers. The new CLI reuses these helpers, and the two userscript builders import the shared normalization helpers instead of retaining behaviorally duplicate copies. This keeps lookup keys aligned across planning and generation while preserving CommonJS and the project's existing plain-JavaScript style.

`plan` accepts mutually exclusive inline words or a file mention; when neither is supplied it uses `.idea/newfile.md`. It writes a versioned JSON manifest to an explicit output path and emits a concise JSON result on stdout. `apply` consumes that manifest plus an explicit approval flag. Diagnostics go to stderr. Exit classes distinguish success, invalid usage/manifest, stale inputs, and apply/build/verification failure.

This is preferred over shell orchestration because callers need a stable data contract and portable error handling. It is preferred over Python or TypeScript because the repository's relevant parsers and generators are already CommonJS JavaScript and the project intentionally has no transpiler or package-managed toolchain.

### 2. Define deterministic preprocessing and lookup rules completely

The planning pipeline runs in this fixed order:

1. Select inline input over file input only through mutually exclusive CLI arguments; parse `#Lx`, `#Lx-Ly`, and `#Lx-y`-style file mentions into a canonical path and inclusive range.
2. Ignore blank lines, Markdown headings, horizontal rules, and fence markers for file input. Split remaining content on newlines, commas, semicolons, or `|`; recognize a three-field `Vietnamese / ChuNom / explanation` item before separator expansion.
3. Trim, NFC-normalize, lowercase with Unicode semantics, and collapse whitespace for lookup keys. Accent folding uses NFD combining-mark removal plus an explicit `đ`/`Đ` mapping, but never changes stored Vietnamese text.
4. Restore diacritics only for a unique folded key. For lightly mistyped input, compare accent-folded keys with deterministic Levenshtein distance after requiring the same word count; use a maximum distance of `max(1, min(2, character_count // 5))`, order suggestions by distance, then normalized Unicode code-point order, and never silently select a fuzzy match. Fold collisions and fuzzy suggestions remain unresolved choices.
5. Emit the full input phrase, followed by known contiguous subphrases of at least two words ordered by descending token length and ascending start position. A subphrase is “known” only when its normalized or uniquely folded key occurs in a local source. De-duplicate by normalized key in first-seen order.
6. Consult sources in a fixed precedence: user entries for skip detection, then `vnedict2.json`, then optional `mdx_nom.json`. Extract CJK/Nom values and English definitions with stable source order and stable de-duplication. Inline values remain explicit user evidence.
7. If an exact multi-word entry lacks a Nom form, compose one only when every component has exactly one locally supported Nom value; concatenate in Vietnamese order and mark the result uncertain. The script never invents an explanation and never selects between multiple component forms.

The manifest records original text, source location/item identity, corrected `vi`, normalized key, candidate values, provenance, notes, decision state, and whether review is required. Stable ordering is part of the contract; wall-clock timestamps are excluded from semantic output so repeated plans are byte-stable.

### 3. Make the manifest the review handoff, not an authority by itself

The manifest has a schema version and repository-state snapshot containing SHA-256 hashes for every source file that influenced the plan, including the selected input file when applicable. Entries are classified as `proposed`, `needs-review`, or `skipped`. The reviewer may change `vi`, `nom`, and `explain`, then set each actionable entry's decision to `apply` or `reject`.

`apply` requires both an explicit CLI approval flag and a valid manifest. It rejects unknown schema versions, duplicate normalized keys, malformed values, actionable entries without a final decision, `apply` entries without valid Nom/CJK data, path escapes, or changed source hashes. Skipped/rejected/ambiguous entries are never mutated. This two-part gate makes accidental application less likely while still allowing a Node.js or subprocess caller to automate a previously reviewed manifest.

An alternative was a one-command interactive script. That would be inconvenient to embed, would mix deterministic operations with terminal state, and would make Codex review harder to audit.

### 4. Preserve JSONC and make apply transactional

The JSONC updater uses a small lexical scanner that understands strings, escapes, line comments, and block comments. It identifies top-level entry objects and property value spans. Existing entries are updated by replacing only the `vi`, `nom`, and `explain` JSON values, preserving surrounding whitespace and comments; new entries are inserted before the top-level closing bracket using the file's established indentation and newline style. The updated document is parsed through the same comment-stripping rules before replacement of the original file.

For file-sourced input, source coordinates from the plan identify exactly which separated items were applied. Cleanup removes only those items, retains skipped/rejected/unresolved items, and preserves unrelated lines and text. The input-file hash must still match the planned bytes before cleanup.

Before mutation, `apply` snapshots bytes and existence for `user_nom_entries.jsonc`, the selected input file, and both generated userscripts. It writes validated source changes, invokes the existing build scripts in their documented order, checks all applied normalized keys in both embedded dictionaries, and runs the three existing Node syntax checks. On any failure, it restores every workflow-owned file from the snapshots and reports the failed stage. Temporary sibling files plus atomic rename are used for direct Node.js writes.

This is preferred over canonical reserialization because reserialization would discard hand-maintained JSONC comments. It is preferred over leaving partial outputs after a failed build because callers need an all-or-nothing result.

### 5. Keep one canonical command and a Claude reference document

Refactor `.codex/commands/add-chu-nom.md` as the sole canonical workflow document. It documents the exact Node.js `plan` and `apply` invocations, uses a temporary manifest outside tracked paths by default, renders proposed/skipped/unresolved entries for review, and helps the user fill only fields the deterministic plan cannot resolve. It must not reproduce normalization, lookup, editing, build, or verification logic in prose. After approval it updates manifest decisions, calls `apply` with the explicit approval flag, and summarizes the structured result in Vietnamese.

Add `.claude/commands/add-chu-nom.md` containing only a heading and a Markdown reference to `.codex/commands/add-chu-nom.md`; it must not copy CLI invocations, review fields, or workflow prose. This makes Claude support explicit while preventing the two command documents from drifting. Keeping mechanics in Node.js ensures programmatic callers and agents following the canonical instructions execute the same path.

### 6. Verify with `node:test` and real generator smoke checks

Add focused tests using the built-in `node:test` and `node:assert/strict` modules for input mention parsing, Markdown filtering, triple preservation, normalization/accent folding, deterministic ordering, unique/ambiguous correction, source precedence, manifest validation, comment-preserving upsert, item-level cleanup, stale-hash rejection, rollback, and structured exit behavior. Tests use temporary repository fixtures and an injected command runner; smoke coverage runs the real Node builders against an isolated fixture.

No new dependency or `package.json` is required, and tests run directly with `node --test test/add-chu-nom.test.js`.

## Risks / Trade-offs

- **[Refactoring shared normalization exports could alter generated output]** → Reuse the existing function bodies unchanged, update both builders to import them, and assert byte-identical generated output before and after the refactor on current data.
- **[A custom JSONC scanner is more code than reserialization]** → Limit it to the known top-level array/object shape, validate before and after edits, and cover comments/escapes/trailing commas with fixtures.
- **[Repository hashes can reject a valid review after unrelated source regeneration]** → Hash only files that influenced the plan, report exactly which source is stale, and require replanning instead of weakening safety.
- **[Transactional rollback cannot undo external side effects of arbitrary commands]** → Invoke only the repository's local builders/checks and snapshot every file those commands are expected to write.
- **[Local dictionaries cannot settle every linguistic choice]** → Surface unresolved data explicitly and keep the existing human review step; deterministic means reproducible mechanics, not fabricated certainty.
- **[Large dictionary parsing and hashing add startup cost]** → Load each source once per invocation; the data size is acceptable for an on-demand maintenance command.

## Migration Plan

1. Export existing dictionary/normalization helpers without behavior changes and prove current generated output remains byte-identical.
2. Add the Node.js CLI and isolated tests without changing either command adapter.
3. Run planning fixtures and a no-mutation plan against the current repository data.
4. Run apply end-to-end in a temporary repository fixture, including build failure rollback.
5. Refactor the canonical Codex command and add the reference-only Claude command document.
6. Perform manual dry runs from the canonical instructions with inline input and a file mention, stopping before approval, then apply an approved disposable fixture and verify both generated maps.

Rollback consists of restoring the previous Codex command and shared-helper exports, then removing the Node.js CLI, tests, and Claude reference document. User dictionary data requires no migration, and the existing Node generators remain compatible throughout.

## Open Questions

None. The implementation may choose exact flag names and internal function boundaries, but the two-phase manifest contract and safety properties above are fixed.
