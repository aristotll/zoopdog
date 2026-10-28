# Zoopdog Maintainability Review and Improvement Plan

Review date: 2026-10-27 (Asia/Kuala_Lumpur). Commit: `237845170e69b3953f8bb00e5b366be26f297798`.

## Conclusion

The static website architecture and plain JavaScript suit this project. Shared modules for identity, data merging, matching, and pronunciation reduce divergence between the website, userscripts, and CLI. This review gives no reason to replace the framework or rewrite the application.

The highest priorities are data integrity, annotation lifecycle, UI result contracts, and reproducible builds and releases. The current green test suite does not prevent several issues that have concrete reproductions. Once these gaps are closed, incrementally split up the runtimes and add static checks.

This document records findings and an implementation plan; the issues below are **not fixed**. This review did not change source code, tests, dictionary data, lockfiles, or third-party libraries.

## Scope and method

The review covered the tracked-file map of 426 files, entry points, dependencies, and important paths in:

| Area | Components | Focus |
| --- | --- | --- |
| Website | `*.jade`, generated HTML/CSS, `js/popupdict.js`, `js/zd-pron.js` | Script loading, UI adapters, selection, lookup, render contracts |
| Shared browser runtime | `zd-extension/js/zd-*.js`, `frame.js`, `showframe.js`, `highlighter.js` | Matching, pronunciation, IndexedDB, MessageChannel, state |
| Userscripts | Three runtimes under `scripts/userscript/`, matching CSS | Mutations, ownership, selection, storage, local requests |
| Data/build | Builders, `scripts/lib/`, user entries/order, chunom layer | Normalization, lossless grouping, CSV, artifact/version |
| Workflow | `Makefile`, package/lockfile, watcher, release, OpenSpec lifecycle | Ordering, reproducibility, freshness, failure handling |
| Tests/docs | `test/`, helpers, docs, AGENTS, active OpenSpec changes | Gate reliability, integration gaps, stale documentation |

The review focused on paths that affect how the project can be changed and maintained; it was not a line-by-line proof of correctness. Large dictionary files and minified libraries were treated as inputs/dependencies, not audited entry by entry or internally. No network-based dependency security audit, real-browser run, GitHub release, or `book-translator` service test was performed.

I read the existing [review](../openspec/changes/harden-runtime-and-dictionary-processing/review.md), [design](../openspec/changes/harden-runtime-and-dictionary-processing/design.md), and [tasks](../openspec/changes/harden-runtime-and-dictionary-processing/tasks.md). F01–F09 below correspond to R1–R9 in that change and were reverified on the current commit; they are not new findings. F10–F17 extend the maintainability review.

Priority definitions: P1 = may lose or alter user content or dictionary meaning; P2 = functional, build/release, or gate issue that should be addressed soon; P3 = architectural and workflow debt. No P0 issue was confirmed within this review's scope.

## Findings by priority

### F01 — P1: Deduplicating meanings by one shared token loses content

- Source: [dictionary-identity.js](../scripts/lib/dictionary-identity.js), `isRedundantVariant` around lines 434–450 and `verifyLossless` around lines 612–638.
- Current behavior: one shared token is enough to treat two meaning bundles as duplicates. The validator reuses the same predicate, so it does not catch a bad merge decision.
- Reproduction: `sharp, biting, cutting` and `sharp, acute, keen` collapse to the first bundle. Real data for `bao bọc` loses `protect` in the popup builder output.
- Maintainability impact: adding a heuristic can silently lose meanings in both the website and userscript while verification still passes.
- Direction: use directional coverage; keep both bundles when they only partially overlap. Verify content, POS, and headword independently rather than reusing the merge predicate.
- Acceptance: regression fixtures and `bao bọc` retain all meanings; a deliberately incomplete output must be rejected by the validator. Do not edit source data to make the test pass.
- Tracking: existing OpenSpec change, item 1.

### F02 — P1: A cross-node ruby annotation is not fully cleaned up when a later node changes

- Source: [nom-ruby.runtime.js](../scripts/userscript/nom-ruby.runtime.js), `annotateAcrossNodes`, around lines 496–546; bookkeeping records only the insertion in the first segment around lines 530–532.
- Reproduction in the existing DOM harness: two wrappers contain `tình ` and `cảm`; after annotation, the page changes the second text node to `bạn`. Visible text becomes `tình bạncảm`, and ruby annotations remain `情 / 伴 / 感`.
- Impact: the userscript corrupts visible text in captions/widgets that update dynamically. Fixing only the matcher will not repair ownership of inserted DOM nodes.
- Direction: track ownership for every source segment in a span; when one segment changes, reconcile the full annotation while preserving the page's new content.
- Acceptance: mutations at the first/middle/last node, removals, multiple matches in a source node, NFC/NBSP, shadow roots, and trailing text do not duplicate or lose content.
- Tracking: existing OpenSpec change, item 3.

### F03 — P2: CSV with an unclosed quote is accepted and consumes the next entry

- Source: [nom-entries-csv.js](../scripts/lib/nom-entries-csv.js), `parseCsv`, lines 28–86.
- Reproduction: `vi,nom,explain\nba,巴,"\nbốn,四,\n` returns one `ba` entry whose explanation is `bốn,四,`; serializing it no longer has a separate `bốn` entry.
- Impact: a typo in a hand-maintained shard can silently change its structure; a later write can preserve the swallowed form.
- Direction: reject EOF while still `inQuotes`, quotes in invalid positions, and malformed row structures; include file/shard and position in errors. Do not auto-correct malformed data.
- Acceptance: malformed quoting fails before any write; valid multiline fields, escaped quotes, blank lines, and headers continue to round-trip.
- Tracking: existing OpenSpec change, item 2.

### F04 — P2: The Make graph allows minification before builds finish

- Source: [Makefile](../Makefile), lines 43–48.
- Reproduction: ran the real graph `make -j4 release-userscripts` with `NODE` replaced by a logger; the real publisher was not called. Minification finished about 290 ms before the three builders.
- Impact: a clean checkout may lack artifacts; an existing checkout may release stale dist files. Waiting for all prerequisites before publishing does not mean minify used fresh inputs.
- Direction: express build → minify → publish dependencies in the graph. Keep `DRY_RUN=1` from publishing, but document that it still may build outputs.
- Acceptance: mocked start/end events confirm ordering at `-j1` and `-j4`; a builder failure blocks minification/publication; a minifier failure blocks publication.
- Tracking: existing OpenSpec change, item 2.

### F05 — P2: A text-node mutation bypasses ancestor exclusions

- Source: [nom-ruby.runtime.js](../scripts/userscript/nom-ruby.runtime.js), `mutationHandler` lines 115–126 and text-node dispatch lines 221–222.
- Reproduction: changing a text node inside `<code>` from `foo` to `bạn` after startup creates a `伴` ruby, despite initial traversal excluding that region.
- Impact: the “do not annotate code/editors” contract depends on how content is updated, making the entry points difficult to maintain consistently.
- Direction: use one ancestor-aware eligibility function for initial scans, additions, and characterData; recheck eligibility when flushing queued work.
- Acceptance: excluded tags, contenteditable, and nodes moved into an editor while queued remain unchanged; valid text outside excluded areas is still annotated.
- Tracking: existing OpenSpec change, item 4.

### F06 — P2: A small mutation can rescan a large container

- Source: [nom-ruby.runtime.js](../scripts/userscript/nom-ruby.runtime.js), line 126 queues `mutationRecord.target`.
- Reproduction: after an initial scan of 100 paragraphs without matches, appending an empty div to the body causes 300 reads of old text-node `nodeValue`s.
- Impact: work scales with feed/SPA size instead of the changed region. An interval and requestAnimationFrame do not reduce the work in each flush.
- Direction: queue dirty/added regions and bounded connection regions; deduplicate and discard own mutations. Preserve the documented recovery behavior for a missed first line.
- Acceptance: counter tests cover at least two DOM sizes; a small append does not read all old text while cross-wrapper and delayed-line regressions still pass.
- Tracking: existing OpenSpec change, item 4.

### F07 — P2: Popup lookup accepts an inherited property as a dictionary entry

- Source: [popupdict.runtime.js](../scripts/userscript/popupdict.runtime.js), `lookupContext`, lines 570–580.
- Reproduction: a dictionary parsed with `JSON.parse` containing only `bạn` returns the function inherited from `Object.prototype` for lookup `constructor`. The consumer expects an array and can throw while rendering.
- Direction: check own properties or use a dictionary without a prototype, while retaining a legitimate entry named `constructor`.
- Acceptance: a missing key returns no match; an actual `constructor` entry returns its data; exercise payloads parsed by `JSON.parse`, not only specially constructed object literals.
- Tracking: existing OpenSpec change, item 5.

### F08 — P2: Core and UI adapters disagree on empty results

- Source: [zd-pron.js](../js/zd-pron.js), lines 39–52 and 89–94; [zd-pron-core.js](../zd-extension/js/zd-pron-core.js), `getMultiWordHomophones`, around lines 517–519.
- Reproduction using the real source adapter in a VM: three spaces cause pronunciation to throw `Cannot read properties of null (reading 'forEach')`; homophone rendering throws `results.forEach is not a function`.
- Cause: `!input.value` misses whitespace; `.zd.match(...)` may return null, while the homophone core returns an HTML sentinel `&nbsp;` instead of an array.
- Direction: handle empty state in the adapter; return a consistent empty array from the core, with placeholders owned by the UI. Preserve the over-limit count behavior or migrate to a tagged result type in a separate change.
- Acceptance: empty/space/tab/newline/punctuation, zero, unsupported input, and valid input after an empty state are covered by core and adapter tests.
- Tracking: existing OpenSpec change, item 5.

### F09 — P2: Result-count limits do not prevent stack overflow by token count

- Source: [zd-pron-core.js](../zd-extension/js/zd-pron-core.js), `getPermutations`, around lines 491–494.
- Reproduction: `getMultiWordHomophones(Array(4000).fill('xyz').join(' '), 10000)` throws `RangeError: Maximum call stack size exceeded` even though there is just one possible combination.
- Direction: generate the Cartesian product with a loop/iterator; only join complete results; preserve ordering and current limits.
- Acceptance: 4,000 singleton tokens do not overflow; small multi-branch products preserve order; cases at and above the limit do not build all results.
- Tracking: existing OpenSpec change, item 5.

### F10 — P2: Release version depends on a local artifact ignored by Git

- Source: [userscript.js](../scripts/lib/userscript.js), lines 178–208; [release-userscripts.js](../scripts/release-userscripts.js), `main`; root userscripts are ignored by `.gitignore`. Build documentation mentions keeping a previous build but does not enforce it.
- Reproduction in a temporary directory on one day: two content-changing builds have versions `2026.10.27` and `2026.10.27.1`; a clean path building newer content again gets `2026.10.27`. `compareVersions(fresh, published)` returns `-1`.
- Impact: a release from a clean machine may not be treated as an update by userscript managers. Even the same commit cannot fully determine the version when local state is missing.
- Direction: use an authoritative release version source independent of the local root artifact: an explicit release version or verified release metadata. Fail if the build cannot prove the version exceeds the last published one. Separate development stamping from release stamping.
- Acceptance: two same-day releases from clean directories get increasing versions; equal/older versions are blocked; repeated builds with the same manifest retain the version; tests do not call GitHub.

### F11 — P2: Two atomic renames are not a transaction for dictionary and metadata

- Source: [build-extension-vnedict-json.js](../scripts/build-extension-vnedict-json.js), lines 160–177.
- Reproduction via writer injection on temporary files: immediately after the dictionary write, its SHA-256 differs from the revision in the previous metadata. The “never a mix” comment overstates the guarantee.
- Impact: a server reading during rebuild can receive a mismatched pair and enter stale/unavailable state. Existing digest checking reduces the chance of installing wrong data; this is an availability/publication risk, not evidence of corrupted data being installed.
- Direction: publish immutable payloads by revision and switch the metadata/pointer last; consumers then fetch the matching payload. A smaller alternative is to stop serving during the generation switch, with that limitation made explicit. Catch/rollback handles some exceptions, not process crashes or concurrent readers.
- Acceptance: readers interleaved with writes and fault injection never receive a generation without its matching payload; crashes/retries preserve the previous generation; stale fallback tests continue to pass. If using revision URLs, plan old consumer compatibility and release asset naming deliberately.

### F12 — P2: Verification depends on existing artifacts and rebuilds after any test failure

- Source: [ensure-built.js](../test/helpers/ensure-built.js), lines 9–16 and 40–54; [Makefile](../Makefile), lines 96–103.
- Static observation: the userscript helper checks existence only. The runtime helper checks mtimes for some inputs but omits `scripts/user-nom-order.js`, `scripts/user-nom-entries.js`, and `scripts/chunom-standard-layer.js`, which directly or indirectly affect builder output.
- The Make retry reruns the whole suite after any failure, without distinguishing stale artifacts, a source defect, or a flaky test. Multiple test files invoke helpers at top level and may initialize shared outputs concurrently on a clean checkout under Node's parallel test execution.
- Impact: results can depend on machine history and scheduling; the first failure can be obscured; tests and builders may write the same output. The concurrency risk is inferred from structure and was not stress-tested in this review.
- Direction: add an explicit preparation step once before testing and use a distinct artifact directory per run. Use a complete input manifest/hash or always build during preparation. The test gate should preserve the first failing exit status; any refresh/retry should be opt-in.
- Acceptance: clean and warm checkouts yield the same result; changing each real input refreshes output or invalidates the cache; an intentional test failure still fails the gate; two test processes never write the same file. Do not simulate every case by only changing mtimes.

### F13 — P2: Page and stylesheet build tools are not pinned in the repository

- Source: [package.json](../package.json) pins only esbuild; [docs/build.md](build.md), lines 3–5, says there is no package.json; no tracked Node version pin or `engines` field was found.
- Impact: a new contributor cannot infer all compatible runtimes/CLIs; committed HTML/CSS output can vary by locally installed Pug/Stylus versions. Cloud setup has CLIs outside the checkout for the current machine, but that does not make the repository reproducible.
- Direction: choose a supported Node LTS and specify the minimum required by current APIs; pin Pug CLI and Stylus against a reviewed output baseline; add Make targets to build/check pages and styles. Use `npm ci` with the lockfile. Do not upgrade compilers and commit broad output churn without reviewing it.
- Acceptance: a clean machine can install/build/test using repository instructions alone; compile into a temporary directory and compare generated artifacts; classify differences as intentional changes or failures.

### F14 — P2: No tracked CI configuration enforces the existing gates

- Evidence: `git ls-files` found no `.github/workflows/*` or common root CI configuration. This does not imply that the organization has no CI outside this repository.
- Impact: local verification is a convention, not evidence of automatic execution on every PR; package/build/minification and HTML/CSS drift checks lack a complete CI target.
- Direction: add a PR workflow using the pinned toolchain, frozen install, preparation, tests, syntax, build/minification, and drift check; do not publish from a PR. Report optional audits separately rather than silently excluding them.
- Acceptance: PRs with deliberate syntax, regression, build, or artifact-drift failures go red; docs-only changes may use a lighter check if path filters are correct. Maintainers can make checks required after the workflow is stable.

### F15 — P3: Large runtimes use shared lexical scope, making changes hard to isolate

- Source: popup runtime has 1,412 lines, the local fragment 1,937, and nom runtime 685 at this commit. The local fragment is concatenated into the same IIFE and shares helpers/globals by name with the core; multiple call sites use `typeof zoo... === 'function'` guards.
- Impact: concatenation order and function names act as an implicit API. A local feature can depend on storage, selection, HTTP, form state, and DOM rendering at once. File size alone is not a bug; undeclared dependencies create the risk.
- Direction: incrementally extract queue/storage, selection UI, popup geometry/rendering, local transport, and modal state; pass dependencies or a small namespace API. Continue generating standalone userscripts with the existing builder; a new framework/bundler is not required.
- Acceptance: public API and start/stop lifecycle are clear; modules have isolated tests; dictionary/rendering parity, metadata grants, and bundle size are compared against baseline. Do not split all three runtimes in one PR.

### F16 — P3: The `book-translator` and browser-global contracts lack a centralized check

- Source: [popupdict-local.runtime.js](../scripts/userscript/popupdict-local.runtime.js), `ZOO_LOCAL_BASE`, `zooHttpRequest`, and forms; [showframe.js](../zd-extension/js/showframe.js), lines 12 and 65–81, still has `chrome.runtime`/`chrome.storage` fallbacks; [local-mode.md](local-mode.md) describes forms mirrored from another repository.
- Impact: mocked unit tests may pass when the server changes shape; the website usually has no `chrome.storage`, so pin position is not persisted and the exception is swallowed. This fallback path was observed in source, but real-browser behavior was not tested in this review.
- Direction: maintain an endpoint/method/request/response/version contract and shared compatibility fixtures in both repositories; use explicit storage/URL adapters for website, userscript, and legacy host. If changing the API, update and test `book-translator` at the same time per AGENTS.md.
- Acceptance: old/new fixtures and error responses are tested; website startup does not require extension APIs; pin persistence is documented and tested through a storage adapter. Do not add automatic retries to write requests without idempotency.

### F17 — P3: Documentation and some structural tests no longer reflect current contracts

- Source: [docs/build.md](build.md) begins by saying there is no package.json and still describes generated outputs as committed; [AGENTS.md](../AGENTS.md) still mentions `user_nom_entries.jsonc` in its overview although the store uses shards; [local-mode.md](local-mode.md), “Two builds”, still says raw GitHub URL; [runner.md](../runner.md) instructs users to build then `git add -A`/push, although current userscripts are distributed via release assets.
- Structural tests such as [scripts-structure.test.js](../test/scripts-structure.test.js) use regexes to check source; performance tests use wall-clock ratios. Both have value, but they cannot replace behavioral regressions and can make refactors brittle/flaky if overused.
- Direction: create one quickstart and a source → generated artifact → publication table; link detailed documentation to it. Add JSDoc typedefs for grouped rows, popup tuples, order rows, readiness, and transport payloads; introduce scoped static checks beginning with pure modules. Keep structural checks for genuine architecture contracts; move spelling assertions toward behavior where appropriate; use counter gates and separate benchmarks for performance.
- Acceptance: commands in docs work on a clean checkout; claims match package/ignore/release behavior; renaming an internal variable does not break a behavioral test; boundary shape errors are detected. Do not enable repo-wide linting and mass-format data/libraries in one change.

## Foundations to preserve

- Share `dictionary-identity`, `nom-merge`, `text`, `zd-nom-match`, `zd-words`, and the pronunciation core across consumers; strengthen contracts around them rather than creating a second implementation.
- The dictionary coordinator has validation, SHA-256 when supported, IndexedDB transactions, and stale fallback. Keep these distinct states when changing publication.
- The sandboxed iframe and MessageChannel validate bounded payloads; do not replace them with unchecked broad message handling.
- Tests include characterization, matcher equivalence, a DOM harness, filesystem fixtures, and import-side-effect checks. Extend the missing integration points instead of replacing the whole test framework.
- Hand-maintained shards/order are user data. Do not reset/stash/discard them to fix tests; do not mix data cleanup into refactors.
- The OpenSpec lifecycle defaults to read-only and makes archiving opt-in; preserve the distinction between inspection and state-changing operations.

## Phased implementation plan

Effort estimates are relative estimates for a maintainer familiar with the code, excluding coordination and follow-up discoveries. Split each phase into small PRs; only check off items after acceptance evidence exists.

| Phase | Scope | Estimated effort | Dependencies | Exit condition |
| --- | --- | --- | --- | --- |
| A | Baseline, F01–F03 | 3–5 days | None | No lost meanings, duplicated annotation text, or silent CSV corruption |
| B | F04–F09 | 3–5 days | Phase A baseline; F04 can be independent | Runtime/UI regressions and parallel build graph pass |
| C | F10–F12 | 3–5 days | F04 before release gate | Authoritative version, consistent generations, tests do not self-heal failures |
| D | F13–F14, documentation F17 | 2–4 days | Phase C preparation before complete CI | Reproducible clean checkout, PR checks and drift checks pass |
| E | F15–F17 | 4–7 days, split into several PRs | Regressions from A–D | Modules/API clear, behavior parity and browser smoke pass |

### A — Protect data and DOM ownership

- [ ] Record baseline source revision, candidate order, entry count, artifact digest, and intentional output. Do not use a whole-output digest as the sole oracle when correct output must change.
- [ ] Add failing F01 tests, then fix grouping and validate independently; review semantic differences in senses/headwords/POS on real data.
- [ ] Add failing F02 tests, then fix ownership for every segment; preserve cross-node/shadow/removal regressions.
- [ ] Add malformed CSV fixtures for F03; retain codec round-trip and error context at the loader boundary.
- [ ] Use the corresponding tasks in the existing OpenSpec change; do not create a second change describing R1–R3.

### B — Runtime behavior and cost

- [ ] Fix the Make graph and test order/failure propagation with an event logger (F04).
- [ ] Unify eligibility and bound dirty regions, measuring with counters (F05–F06). Preserve first-line recovery before optimization.
- [ ] Block inherited dictionary hits and test a real entry with the same name (F07).
- [ ] Normalize empty results in the core/UI and add VM adapter tests (F08).
- [ ] Remove token-count recursion from the Cartesian product while preserving ordering and limits (F09).
- [ ] Close the OpenSpec harden-runtime change only after its tasks/tests/browser evidence are satisfied; documentation alone is not completion evidence.

### C — Trustworthy builds and releases

- [ ] Define version authority and separate local development stamping from release preflight; mock release metadata/registry in tests (F10).
- [ ] Choose a generation publication design and compatibility plan; add interleaved-reader and crash/fault cases (F11).
- [ ] Separate preparation from verification, use per-run artifact directories, and remove blanket gate retries; test cold/warm/concurrent preparation (F12).
- [ ] Generate a manifest with commit, Node/tool versions, input hashes, optional chunom/font state, artifact hashes, and release versions. Record absent optional inputs explicitly; builds with and without a data layer are not equivalent.
- [ ] Release dry-run validates manifest, version, metadata/header, artifact presence, and digest; tests must not call `gh release create`.

### D — Contributor workflow and CI

- [ ] Pin toolchain/CLIs and add `build-pages`, `build-styles`, `check-generated`, or clearly named equivalents (F13).
- [ ] Add a quickstart with `npm ci`, preparation, verification, and serving; document Node version, optional local mode, and required/optional network/secrets (the default flow requires no secrets).
- [ ] Add PR CI for reproducible gates; build/minify and generated-artifact drift checks run in a temporary directory (F14).
- [ ] Run the optional dictionary audit separately by schedule/data changes and report the actual outcome; a skipped test is not a completed audit.
- [ ] Correct stale instructions in build/local-mode/AGENTS/runner when the related contract changes; review docs and commands together (F17).

### E — Reduce coupling deliberately

- [ ] Extract transport and storage adapters first, then queue/selection/modal modules; preserve entry points and builder output (F15).
- [ ] Document shapes and dependency map briefly; pilot static checking on pure modules before expanding scope.
- [ ] Standardize the local-mode contract with `book-translator` maintainers; do not change endpoints/payloads/hotkeys/control UI only in this repository (F16).
- [ ] Add minimum browser smoke checks: fresh/stale/retry IndexedDB dictionary, sandbox frame/message/resize, whitespace and long-input pronunciation, selection/pointer, dynamic cross-node rewrite, excluded editor, and open shadow root.
- [ ] Test strict Trusted Types CSP and actual userscript managers; the current pass-through policy does not prove compatibility with every CSP. Test policy creation and fallback before claiming support.
- [ ] Separate noisy performance benchmarks from gates; keep deterministic counter/complexity regressions. Record before/after measurements on the same dataset and machine.

## Verification strategy and completion criteria

1. Start each bug fix with a regression that fails on current source; fix the behavior without removing assertions or changing source data to avoid the failure.
2. Use small fixtures for pure modules and real-data parity tests with recorded provenance. Avoid multiple test processes writing shared root artifacts.
3. After builder/runtime changes, rebuild into temporary or Git-ignored output and compare content, version, grants, and size. For intentional output changes, review semantic differences rather than requiring absolute byte identity.
4. Run Node tests, syntax checks, minification, page/style builds, generated-artifact checks, and relevant OpenSpec lifecycle checks. Preserve real exit statuses and distinguish failed/skipped/unrun checks.
5. Browser smoke must exercise real interaction and IndexedDB/MessageChannel; a DOM harness does not fully model layout, fonts, CSP, selection, or userscript manager behavior.
6. Before merge, inspect `git status --short`; a PR should contain only its related source/test/docs/artifact changes. Do not add a large dependency just to split code.

The plan is complete when F01–F14 have regression/gate evidence and closure, F15–F17 have accepted module boundaries/documentation/contracts, and required browser smoke has recorded results. Any deferral should state the reason, affected scope, and revisit condition; do not label an issue “fixed” just because the current suite is green.

## Evidence collected in this review

| Check | Result |
| --- | --- |
| `node --test test/*.test.js` | Exit 0; 359 tests: 358 passed, 0 failed, 1 skipped; about 28 seconds |
| Skipped audit | `ZD_REVIEW_DICTIONARY=1` was not enabled; the dictionary meaning audit is not claimed as passed |
| `find scripts -name '*.js' -print0 \| xargs -0 -n1 node --check` | Exit 0 |
| `make verify-browser` | Exit 0 |
| `make check-openspec` | Exit 0; harden-runtime change actionable; chunom-layer-hardening archive-eligible; nothing archived |
| F01–F09 reproductions | Reran the two code blocks in the existing OpenSpec review against real source; all nine behaviors remain reproducible |
| F04 mocked release | Logger replaced NODE in the real Makefile; no publication, push, or GitHub API call |
| F10 version | Real version writer API on a temporary directory; fresh build version was lower than the second same-day version |
| F11 publication | Writer injection on temporary files confirmed payload/metadata revisions differ between writes |
| Browser, book-translator, dependency security audit | Not run; compatibility and overall security are not claimed as fully verified |

Review logs on the machine: `/tmp/zoopdog-review-tests.log`, `/tmp/zoopdog-review-repro-1.log`, `/tmp/zoopdog-review-repro-2.log`. These temporary files are not committed artifacts or required to use this plan.

Verification environment: Node `v24.19.0`, npm `11.9.0`. The review ran the suite and syntax targets directly to avoid invoking `make verify`'s blanket rebuild/retry branch. Runtime source and data were preserved; only this plan document was added.

Vietnamese version: [maintainability-review-and-improvement-plan.md](maintainability-review-and-improvement-plan.md).
