# Documentation index

What each document is, so a reader knows whether to trust it as the way things work now. Three
statuses are used:

- **Current reference** - describes how the repository works today; kept in step with the code.
- **Plan in progress** - a plan or proposal with open items; the checkboxes are the state.
- **Historical record** - kept as evidence of what was decided or found at the time; it is not
  updated and may describe code that no longer exists.

Start with [`../AGENTS.md`](../AGENTS.md) (the repository rules; `CLAUDE.md` only points to it)
and [build.md](build.md).

## `docs/`

| Document | Status | What it covers |
| --- | --- | --- |
| [build.md](build.md) | Current reference | Build, verification (`make verify`, `test-fast`, `browser-smoke`, `lint`, `check-types`), releases, known site-compatibility limits |
| [dictionary-data.md](dictionary-data.md) | Current reference | Dictionary data pipeline, what every file in `zd-extension/db_src/` is (source, generated or unused), userscript version stamps, MDX data |
| [chunom-standard.md](chunom-standard.md) | Current reference | The generated, gitignored chunom.org standard-character layer and how to refresh it |
| [local-mode.md](local-mode.md) | Current reference | The popup userscript's local mode and its contract with the `book-translator` reader server |
| [nom-validation.md](nom-validation.md) | Current reference | Checking what the nom-ruby userscript or popup would show for a term, locally, with `scripts/nom-inspect.js` (`make nom-annotate`, `make nom-popup`) |
| [pronunciation-engine.md](pronunciation-engine.md) | Current reference | Module ownership of the pronunciation, number and homophone logic |
| [runtime-boundaries.md](runtime-boundaries.md) | Current reference | Data contracts between the website, the userscripts and the tooling; what `make check-types` covers |
| [userscript-troubleshooting.md](userscript-troubleshooting.md) | Current reference | Diagnosing the popup and CJK ruby userscripts on translated pages: symptoms, causes, CDP techniques and the two ruby renderers (each section states whether its bug is fixed) |
| [live-browser-test-plan.md](live-browser-test-plan.md) | Plan in progress | The checklist an AI agent follows to test the website and the userscripts live in the user's own browser (safety rules, DOM evidence, test matrix, results template); results go in `live-test-results-<date>.md` |
| [performance-and-maintainability-review-2026-11.md](performance-and-maintainability-review-2026-11.md) | Plan in progress | The 2026-11-17 performance and maintainability review; phases 0-3 are partly done, phase 4 awaits decisions |
| [maintainability-review-and-improvement-plan.md](maintainability-review-and-improvement-plan.md) | Historical record | The 2026-10-27 review (F01-F17), in Vietnamese, as written before the fixes; most findings were later fixed, see the English edition's status update |
| [maintainability-review-and-improvement-plan.en.md](maintainability-review-and-improvement-plan.en.md) | Historical record | English edition of the same review, with an implementation update of 2026-10-28 to 2026-10-30; the open items it lists were carried into the 2026-11 review |

## `docs/superpowers/`

Implementation plans and a design written with an agent workflow. All were executed and the
behaviour they describe has shipped, so they are historical: their checkboxes were not kept up to
date, and parts refer to the removed browser extension or to the single-file
`user_nom_entries.jsonc` that the CSV shards replaced.

| Document | Status | What it covers |
| --- | --- | --- |
| [plans/2026-08-12-harden-popup-dictionary-runtime.md](superpowers/plans/2026-08-12-harden-popup-dictionary-runtime.md) | Historical record | Revision-aware dictionary loading and the validated popup-frame protocol (now in `zd-dictionary-runtime.js` and `zd-popup-protocol.js`) |
| [plans/2026-09-10-local-nom-precedence-and-async-mobile.md](superpowers/plans/2026-09-10-local-nom-precedence-and-async-mobile.md) | Historical record | Hand-maintained Nom data leading every generated surface; first-line annotation on mobile |
| [plans/2026-09-12-harden-local-popup-requests.md](superpowers/plans/2026-09-12-harden-local-popup-requests.md) | Historical record | Settle-once request wrapper and watchdog for the local popup |
| [specs/2026-09-23-offline-nom-review-queue-design.md](superpowers/specs/2026-09-23-offline-nom-review-queue-design.md) | Historical record | Design of the offline Chữ Nôm review queue, which shipped (`nom-review-store.js`); the behaviour is summarised in build.md |

## `openspec/`

| Path | Status | What it covers |
| --- | --- | --- |
| `openspec/specs/` | Current reference | Canonical capability specs, written by promoting a change's spec deltas |
| `openspec/changes/chunom-layer-hardening/`, `openspec/changes/harden-runtime-and-dictionary-processing/` | Plan in progress (all tasks ticked) | Active changes; `make check-openspec` reports both as archive-eligible, so they are finished work waiting for `make check-openspec ARCHIVE=1` |
| `openspec/changes/archive/` | Historical record | Finished changes (proposal, design, tasks, spec deltas) |

The lifecycle rules are checked by `make check-openspec`; see `scripts/check-openspec-lifecycle.js`.

## Other

| Document | Status | What it covers |
| --- | --- | --- |
| [`../runner.md`](../runner.md) | Current reference | Three-line pointer to the build commands for a CI runner or a new machine |
| [`../zd-extension/db_src/user_nom_entries/SHARDING.md`](../zd-extension/db_src/user_nom_entries/SHARDING.md) | Current reference | The shard-assignment algorithm and fixture shared with `book-translator` |
