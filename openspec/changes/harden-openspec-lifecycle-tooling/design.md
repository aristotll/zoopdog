## Context

`scripts/check_openspec_lifecycle.py` was added in commit `8fcfb26` alongside the first use of the archive flow. A code review of that commit found the tool inverts its own safety ordering (archive, then validate only what is left), decides completeness from a parse that ignores indentation, mutates the tree under a `check` name, and leaves `openspec/specs/` permanently empty because nothing promotes deltas into it — which in turn makes `check_canonical_specs()` a no-op, since it returns early when the directory is absent.

The repository constrains the fix. `AGENTS.md` records "There is no `package.json` and no npm dependency", assigns the `Makefile` "Every maintenance entry point", and lists `test/` as "`node:test` suites, including structural contracts". `make verify` syntax-checks `find scripts -name '*.js'`, and `test/scripts-structure.test.js` enumerates `entry.name.endsWith('.js')`. A Python file satisfies none of these: it is invisible to the syntax check, to every structural contract, and to the documented entry points, and it adds an undeclared `python3` dependency to a repo that declares none.

The current archive contains three changes moved on 2026-08-11, carrying four un-promoted spec deltas, and one of them (`streamline-agent-workflow-surface`) has verification checkboxes that contradict the verification notes in the same file.

## Goals / Non-Goals

**Goals:**

- No change can be archived without first passing the structural gate.
- No run of the lifecycle command alters the working tree unless the caller asked for it in the command line.
- Completeness is decided from a parse that sees every task a reader sees, at any indentation.
- Archiving preserves spec content by promoting deltas into canonical `openspec/specs/`, or refuses and says why.
- The tool lives inside the repository's existing runtime, verification command, and structural contracts.
- The archived verification record tells the truth about what was and was not verified.

**Non-Goals:**

- Replacing or wrapping the external `openspec` CLI (v1.3.1). This tool checks repository-local lifecycle hygiene; it does not take over scaffolding or status.
- Automatic semantic merging of `MODIFIED`/`REMOVED` deltas into an existing canonical spec. That is an editorial act and stays one.
- Re-running the browser verifications for the archived change. Restoring the record is in scope; performing the verification is an operator task.
- Any change to website, extension, dictionary, or userscript behaviour.

## Decisions

### Port to Node.js rather than extend `make verify` to cover Python

Adding `.py` to the Makefile's `find` and to the structural test's filter would fix the coverage gap while leaving a second runtime in a repo that documents one. The Node port instead makes the tool ordinary: it inherits `node --check` from the existing `verify-scripts` glob for free, becomes visible to `test/scripts-structure.test.js`, can `require('node:test')` like every other suite, and can share `scripts/lib/` if it ever needs to. It also honours the Makefile comment that the enumeration exists "so a new script joins verification without a Makefile edit" — a claim that is currently false for this file.

*Alternative considered*: keep Python and add a `pyproject.toml`/lint config. Rejected — it introduces the dependency surface `AGENTS.md` explicitly says the project does not have, for one 263-line script.

### `check` reports; `--archive` mutates; `--archive --dry-run` rehearses

The default run performs no filesystem write. When a change is archive-eligible it says so and names the flag, rather than acting. This restores the meaning of the command's name and makes the tool safe for CI, for agents, and for anyone inspecting state — none of whom should discover that a read produced a dirty tree, which `AGENTS.md` git hygiene forbids.

*Alternative considered*: keep archiving as the default and add `--no-archive`. Rejected — the safe behaviour must be the one you get by accident.

### Validate before archiving, and refuse to archive an invalid change

Archive eligibility becomes `structurally valid AND every task checked`. The structural issues are computed first and gate the move. This closes the escape hatch where a change missing `proposal.md` or `specs/**/spec.md` is moved into `archive/`, which nothing validates, and disappears from the gate forever.

### A hand-written paren scanner for `(deferred: ...)`, not a regex

`\(deferred:\s*.+\)` is greedy to the last `)` on the line, and `\(deferred:\s*([^)]+)\)` stops at the first inner `(`. Both are wrong on real task text: the first turns "Load extension (deferred: needs browser) then rerun make verify (see docs/build.md)" into the summary "Load extension", and the second reads "needs Chrome (v120) installed" as the reason "needs Chrome (v120". Regexes cannot balance parentheses; a ten-line scanner that walks from `(deferred:` to its matching close can, and it gives the summary and the reason from one authoritative span.

### One explicit `(operator-only)` tag replaces the prose blocker list

`OPERATOR_BLOCKER_MARKERS` is fifteen English substrings ("run ci on both", "live chained cycle", "live replay"); every one of them matches zero files in this repository. A heuristic over prose both misses real blockers phrased differently — as it just did for tasks 6.3 and 6.5 — and must be maintained forever against how people happen to word tasks. An explicit tag the author writes is unambiguous, greppable, and testable.

*Alternative considered*: broaden the phrase list. Rejected — it makes the false-negative rate a function of vocabulary, which is not something a check can be correct about.

### Promotion materialises a missing canonical spec, and refuses to overwrite an existing one

When a change is archived, each `specs/<capability>/spec.md` delta is promoted. If `openspec/specs/<capability>/spec.md` does not exist, the tool writes it from the delta: strip the `## ADDED Requirements` delta header, keep the requirement blocks, and add the `## Purpose` and `## Requirements` structure the canonical checks require. If it does exist, the tool reports a conflict and archives nothing, because merging `MODIFIED` and `REMOVED` deltas into a living spec changes meaning and a tool that guesses at meaning is worse than one that stops.

*Alternative considered*: append deltas to the canonical file. Rejected — it produces a canonical spec containing delta headers, which `check_canonical_specs()` correctly treats as an error.

### Anchored, depth-independent heading checks

`"## Purpose" in text` is satisfied by `### Purpose blurb`, and `text.find("## Requirements")` matches inside `### Requirements overview` — so the "requirement appears outside main ## Requirements section" check silently passes on a spec that violates it. Heading checks move to line-anchored regexes, matching `DELTA_HEADER_RE`, which already got this right. Canonical specs are discovered with a recursive walk rather than a one-level glob, so change deltas and canonical specs agree on where spec files may live.

### The archived record is corrected with `(deferred: ...)`, not by re-opening the boxes

Tasks 6.3 and 6.5 were never performed and 6.4 was only partially observed; the notes in the same file say so. Setting them back to `[ ]` would make an archived change permanently "incomplete" and re-trigger every gate. Marking them `- [x] ... (deferred: <accurate reason>)` is what the deferral mechanism exists for: the change stays archived, the record stops claiming work that did not happen, and the outstanding browser verifications appear in the operator queue where an operator will find them.

## Risks / Trade-offs

- **Deleting the Python script breaks any local habit or automation that invoked `python3 scripts/check_openspec_lifecycle.py`** → The replacement lands in the same commit with a `make check-openspec` target and an `AGENTS.md` entry, so there is a documented path from day one.
- **Archiving becomes opt-in, so a caller who relied on the bare run to archive will find nothing moved** → The default run prints which changes are archive-eligible and the exact command that archives them, so the new behaviour is self-describing rather than silent.
- **Promotion refuses on conflict, so an archive can be blocked by a hand-edited canonical spec** → The refusal names the file and the delta; resolving it is a one-file editorial merge, and the alternative (a tool that silently merges requirements) risks losing normative content at exactly the moment it becomes canonical.
- **Requiring `(operator-only)` means old tasks written before this change carry no tag** → The tag only drives the advisory "deferral candidate" report, never the gate, so an untagged blocker degrades to today's behaviour rather than to a wrong archive.
- **Correcting an archived file rewrites history in the working tree** → Only checkbox lines and appended deferral reasons change; the verification notes that establish the truth are already in the file and stay untouched, so the correction is auditable against them.
- **Node has no direct `shutil.move` equivalent across devices** → `fs.renameSync` with an `EXDEV` fallback to recursive copy-then-remove, exercised by a test, keeps the move total or absent rather than partial.
