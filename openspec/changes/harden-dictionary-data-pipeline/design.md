## Context

The repo ships three independent-looking JSON dictionaries that turn out to have a real (if undocumented) dependency chain:

- `zd-extension/db_src/vnedict.txt` (frozen since the repo's initial commit) → `zd-extension/db_src/make_dict.py` → `zd-extension/db_src/vnedict.json`. This path is Python-only, untested, and has a confirmed data-loss bug (`split(":")` instead of `split(":", 1)`).
- `zd-extension/db_src/vnedict2.json`, seeded at an unknown earlier point and since kept current by `scripts/merge-mdx-nom-into-vnedict2.js` (MDX Nôm merges) and the `/add-chu-nom` workflow (hand-approved entries). This is the dictionary the userscript builders (`scripts/build-popupdict-userscript.js`, `scripts/build-nom-userscript.js`) already embed.
- `zd-extension/js/vnedict.json`, fetched at runtime by both the Chrome extension (`zd-extension/js/background.js:40,52`, via `chrome.runtime.getURL`) and the website's popup dictionary page (`js/popupdict.js:187`, via a relative fetch). `docs/dictionary-data.md` currently claims this file should be copied/transformed from `db_src/vnedict.json`.

Content comparison (entry counts and spot-checked entries such as "A La Hán") shows `js/vnedict.json` (61,531 entries, has Nôm/Hán definitions) tracks `vnedict2.json` (76,178 entries, has the same Nôm merges), not `db_src/vnedict.json` (53,988 entries, no Nôm merges). The documented copy step from `make_dict.py`'s output to `js/vnedict.json` does not match what is actually running in production — `js/vnedict.json` is a stale, minified snapshot of an earlier `vnedict2.json`.

Separately, `scripts/merge-mdx-nom-into-vnedict2.js:138` writes the 6.8MB `vnedict2.json` with a plain `fs.writeFileSync`, and lines 106-114 silently coerce malformed MDX `candidates` to `[]` with no counter — both inconsistent with the atomic-write and error-visibility conventions already established in `scripts/add-chu-nom/`.

## Goals / Non-Goals

**Goals:**
- Stop silent data loss in dictionary regeneration: fix the colon-split bug, add a drop counter for malformed MDX input, and make the primary dictionary write crash-safe.
- Make `zd-extension/js/vnedict.json` a build output of the toolchain, sourced from the dictionary that is actually maintained (`vnedict2.json`), instead of a hand-copied file that nothing regenerates.
- Bring the extension's dictionary generation fully into the Node.js toolchain (`scripts/`, `test/`, `make verify`), consistent with `openspec/specs/dictionary-script-toolchain`.

**Non-Goals:**
- Reconciling `vnedict.txt`/`db_src/vnedict.json` as a *base-vocabulary* input to `vnedict2.json`. `vnedict.txt` has been untouched since 2018 and nothing currently re-syncs new `vnedict.txt` entries into `vnedict2.json`; that gap is real but is a separate base-data-sourcing question, not a data-loss or drift bug this change needs to close.
- Investigating or wiring up `zd-extension/db_src/evdict.txt` (99,174-line StarDict-format file, different schema from `vnedict.txt`, parsed by no script in the repo). It is orphaned and out of scope, deferred to a future repo-hygiene change.
- Website bugs, extension security/reliability items, and repo cleanup (`zd-extension.zip`, `.codemoss/`) surfaced by the same review — explicitly deferred per the proposal.

## Decisions

**1. Two separate scripts, not one, for `make_dict.py`'s replacement and `js/vnedict.json` generation.**
`scripts/build-extension-dictionary.js` ports `make_dict.py`: reads `vnedict.txt`, fixes the colon-split bug, writes `db_src/vnedict.json`. `scripts/build-extension-vnedict-json.js` reads `db_src/vnedict2.json` and writes the compact `js/vnedict.json`. These have different inputs (`vnedict.txt` vs. `vnedict2.json`) and different purposes (legacy-source regeneration vs. runtime-artifact sync) — merging them into one script would make a future reader wrongly assume `js/vnedict.json` still derives from `make_dict.py`'s output, re-creating the exact confusion this change is fixing.
*Alternative considered*: one combined script that runs `make_dict.py`'s logic and then separately copies from `vnedict2.json`. Rejected — conflates two unrelated data sources under one entry point and one CLI invocation, working against the "declare intent by file" convention already used elsewhere in `scripts/`.

**2. `js/vnedict.json` output format matches the existing file's format exactly: compact JSON (`JSON.stringify` with no spacing), array of `{vn, en: [{def, pos}]}` in `vnedict2.json`'s existing key order.**
This is a mechanical drop-in replacement for a file two runtime consumers already parse with `response.json()` / `fetch(...).then(r => r.json())` — no consumer-side change needed. `db_src/vnedict.json` keeps `make_dict.py`'s existing pretty-printed, sorted-keys format (`JSON.stringify(res, null, 4)` with keys in the same `en`/`vn` order Python's `sort_keys=True` produced) so the regenerated file is a content-equivalent, whitespace-only diff from the current committed file, keeping the "generated output stability" expectation from `dictionary-script-toolchain` intact for this file too.
*Alternative considered*: reformat `db_src/vnedict.json` to compact JSON to save the 4.8MB of indentation bytes. Rejected — out of scope for this change (a pure formatting change to an already-legacy file) and would produce a large, low-value diff noise.

**3. Promote `atomicWrite` (only) from `scripts/add-chu-nom/fsutil.js` into `scripts/lib/fsutil.js`; leave `resolveInsideRoot`, `snapshotFiles`, `restoreSnapshot`, and the `WorkflowError` dependency in `scripts/add-chu-nom/fsutil.js`.**
`atomicWrite(target, content)` has no dependency on `WorkflowError` or the add-chu-nom transactional-apply model — it is a generic write-via-temp-file-then-rename primitive, exactly the kind of primitive `dictionary-script-toolchain`'s "Single definition for shared script primitives" requirement already governs. The other three functions are specific to add-chu-nom's manifest-apply snapshot/restore flow and have no caller outside it; moving them would be motion without purpose. `scripts/add-chu-nom/fsutil.js` re-exports (or imports and re-exports) `atomicWrite` from `scripts/lib/fsutil.js` so existing `scripts/add-chu-nom/*.js` call sites and `test/add-chu-nom.test.js` need no changes beyond the import path inside `fsutil.js` itself.
*Alternative considered*: leave `atomicWrite` in `scripts/add-chu-nom/fsutil.js` and have `merge-mdx-nom-into-vnedict2.js` import it from there directly. Rejected — makes an unrelated script depend on a directory named for a different workflow, and the existing spec already requires shared primitives to live in the shared library, not be reached into cross-workflow.

**4. Drop-counter for malformed MDX candidates logs a single summary count, matching `extract-mdx-nom-data.js`'s `skippedNonVietnamese` pattern, not a per-entry log line.**
`merge-mdx-nom-into-vnedict2.js` already prints a summary block (`Updated ${dictionaryPath}`, `Updated existing entries: ...`, etc.) at the end of `main()`; a `Skipped malformed candidates: ${skippedMalformed}` line fits that existing shape. Per-entry logging would be noisy for a 76k-entry merge and isn't how the codebase's existing analogous counter behaves.

**5. New Makefile targets `rebuild-extension-dict` (runs `build-extension-dictionary.js`) and `rebuild-extension-vnedict-json` (runs `build-extension-vnedict-json.js`), kept separate rather than one combined target.**
Mirrors decision 1: the two scripts have independent triggers (editing `vnedict.txt` vs. `vnedict2.json` changing through the merge/add-chu-nom workflows) and a maintainer regenerating one has no reason to also pay the cost of the other. `docs/dictionary-data.md` documents running `rebuild-extension-vnedict-json` after any workflow that touches `vnedict2.json` (the merge script, `add-chu-nom-apply`), the same way it already documents running `make rebuild-userscripts` after those workflows.

## Risks / Trade-offs

- **[Risk]** Byte-for-byte behavioral parity between `make_dict.py` and its Node.js port could subtly differ (Python `re.sub(r'\(\d+\)', '', ...)`, `.strip()`/Unicode whitespace handling, `json.dump(..., ensure_ascii=False)` vs. `JSON.stringify`) beyond the intentional colon-split fix. → **Mitigation**: `node:test` coverage asserts the Node port's output matches a snapshot of the current `db_src/vnedict.json` for every entry *except* the lines with the colon bug (which should now correctly include their additional senses); this makes the intended fix visible as the only diff.
- **[Risk]** Regenerating `js/vnedict.json` from `vnedict2.json` for the first time is itself a large data change (61,531 → 76,178 entries) shipped in one commit, unlike the narrow, targeted diffs this repo's history favors. → **Mitigation**: call this out explicitly in the PR/commit description as an intentional one-time resync (not a regression), and note the new entry count in `docs/dictionary-data.md` so future maintainers have a reference point.
- **[Risk]** `zd-extension/js/vnedict.json` is loaded into IndexedDB via `Dexie` on extension install (`background.js:31-47`) and via the website's own loader (`js/popupdict.js`); a malformed compact-JSON write (e.g. a missing array bracket from a bug in the new script) breaks dictionary loading for both surfaces at once, silently (per the existing, separately-tracked lack of `.catch()` handling — out of scope here). → **Mitigation**: the new script SHALL validate its own output is parseable JSON and has the expected entry count within an order of magnitude of the input before completing, failing loudly (non-zero exit) rather than writing a corrupt file; this is a minimal safety check, not a fix for the unrelated missing-`.catch()` issue.
- **[Trade-off]** Keeping `db_src/vnedict.json` pretty-printed (decision 2) rather than compacting it means this change doesn't reduce the 9.7MB file's committed size. Accepted as scoped-correctly rather than opportunistic cleanup.

## Migration Plan

1. Add `scripts/lib/fsutil.js` with `atomicWrite` (moved from `scripts/add-chu-nom/fsutil.js`); update `scripts/add-chu-nom/fsutil.js` to import and re-export it; run `make verify` to confirm the add-chu-nom test suite is unaffected.
2. Add path constants to `scripts/lib/paths.js` for `vnedict.txt`, `db_src/vnedict.json`, and `js/vnedict.json`.
3. Write `scripts/build-extension-dictionary.js` (the `make_dict.py` port) with tests; run it once and diff the output against the current `db_src/vnedict.json` to confirm the only differences are the intended colon-split fixes.
4. Write `scripts/build-extension-vnedict-json.js` with tests; run it once and commit the regenerated `zd-extension/js/vnedict.json`.
5. Add atomic-write and the malformed-candidate counter to `scripts/merge-mdx-nom-into-vnedict2.js`, with tests.
6. Add the two Makefile targets, wire them into `verify-scripts`' existing `find scripts -name '*.js'` syntax-check sweep (automatic, no Makefile change needed there), and update `docs/build.md` / `docs/dictionary-data.md`.
7. Delete `zd-extension/db_src/make_dict.py`.
8. Manually verify in the extension (load unpacked, trigger `reload-db`) and on the website's popup dictionary page that lookups still resolve correctly post-regeneration, since neither surface has automated test coverage (tracked as a follow-up, consistent with how prior changes such as `2026-08-11-streamline-agent-workflow-surface` deferred browser verification).

Rollback: this change only touches build-time scripts and regenerated data files; reverting the commit restores the previous `db_src/vnedict.json`, `js/vnedict.json`, and `vnedict2.json` write path with no runtime code changes to roll back.

## Open Questions

- Should `vnedict.txt` → `vnedict2.json` base-vocabulary sync (the Non-Goal noted above) become its own future change, given it means new entries added to `vnedict.txt` today have no path into the shipped dictionary at all? Flagging for a separate proposal rather than answering here.
- Is `db_src/vnedict.json` worth keeping as a committed artifact at all, given no runtime consumer reads it after this change? Leaning toward keeping it (it is still the direct, testable regeneration of `vnedict.txt`, useful as a diffable intermediate), but noting the question in case a reviewer prefers to drop it from version control and treat it as a build-only intermediate.
