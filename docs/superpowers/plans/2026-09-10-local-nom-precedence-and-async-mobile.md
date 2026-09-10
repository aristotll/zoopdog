
# Local Nom Precedence and Async Mobile Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make hand-maintained Nom data deterministically lead every generated dictionary surface and ensure the first asynchronously inserted Vietnamese line is annotated on mobile.

**Architecture:** Treat `user_nom_entries.jsonc` as an implicit preference layer and `user_nom_order.jsonc` as the final explicit preference layer. Share exact-candidate hoisting across the Nom map, popup dictionary, and extension runtime, then make the Nom runtime robust to the mobile async insertion pattern with a regression-tested DOM queue fix.

**Tech Stack:** Plain JavaScript, Node.js `node:test`, JSON/JSONC builders, MutationObserver, Make.

**Execution note:** Work inline in this task. Preserve the user's uncommitted JSONC edits and rebuild all tracked generated assets.

---

### Task 1: Lock local precedence with failing tests

**Files:**
- Modify: `test/user-nom-order.test.js`
- Modify: `test/popup-runtime.test.js`

- [x] Add a failing test proving a local candidate is moved ahead of an existing candidate in the Nom map.
- [x] Add failing tests proving an exact preference is synthesized ahead of a grouped dictionary cell for the popup and extension.
- [x] Run the focused tests and confirm they fail for precedence rather than fixture errors.

### Task 2: Implement one precedence rule across all builders

**Files:**
- Modify: `scripts/user-nom-entries.js`
- Modify: `scripts/user-nom-order.js`
- Modify: `scripts/build-popupdict-userscript.js`
- Modify: `scripts/build-extension-vnedict-json.js`
- Modify: `docs/dictionary-data.md`

- [x] Hoist local `nom` values while retaining non-local candidates behind them.
- [x] Treat presence only as an exact candidate row, so a preferred value inside a grouped cell still receives its own leading row.
- [x] Apply local entry preferences before the explicit order file, leaving `user_nom_order.jsonc` with the final say.
- [x] Run focused tests and confirm they pass.

### Task 3: Reproduce and fix the first async mobile line

**Files:**
- Modify: `test/nom-ruby-runtime.test.js`
- Modify: `scripts/userscript/nom-ruby.runtime.js`

- [x] Add a failing DOM-runtime test matching the first-line insertion/rewrite sequence.
- [x] Run it and confirm the first line is absent before the fix.
- [x] Make the smallest queue/injection change that preserves the first line and avoids duplicate ruby.
- [x] Run the runtime test suite and confirm it passes.

### Task 4: Rebuild and verify tracked outputs

**Files:**
- Modify: `zoopdog-nom-ruby.user.js`
- Modify: `zoopdog-popupdict.user.js`
- Modify: `zd-extension/js/vnedict.json`
- Modify: `zd-extension/js/vnedict.meta.json`

- [x] Run `make rebuild-userscripts` and `make rebuild-extension-vnedict-json`.
- [x] Assert representative local and explicit preferences lead each generated output.
- [x] Run `make verify`, `git diff --check`, and inspect `git status --short`.
