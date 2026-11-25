# Three-repo review and improvement plan (2026-11-25)

Scope: the newest code of each repository after fetching every branch, back to about 2026-11-17.

| Repository | Head reviewed | Branch |
| --- | --- | --- |
| zoopdog | 641d9ac (+ unmerged a356054) | `claude/blissful-fermat-mzmlon` (+ `claude/zealous-lamport-pcm7fh`) |
| book-translator | 3579579d | `diverge-new3` |
| online-dict | 1a255c9 | `diverge-new3` |

online-dict 1a255c9 (baolingo AES-GCM, huyenbi, therealielts, the searchsite `data-audio` change) produced no finding, so
online-dict gets no change from this plan. The same file is in zoopdog as `docs/2026-11-25-three-repo-review-and-improvement-plan.md`.

## Order of work

The order follows the damage a finding does. First come lost fixes and silent data changes, then wrong output, then
interaction faults, then nits. Each repository is finished and pushed before the next.

1. **zoopdog first**, starting with finding 9, the merge. The other zoopdog fixes touch the same files, so the branch has to
   be merged before they are made.
2. **book-translator:** the study-review data findings (4, 5) come first because they rewrite the user's book files. Then
   the wrong export output (3, 8), the control-page retry (6), and the nits (10, 12, 13).
3. Then this plan's status table is updated and pushed.

## Findings and the planned fix

Status: **done** = committed with tests; **planned** = not yet committed.

### zoopdog

| # | Severity | Where | Problem | Fix | Status |
| --- | --- | --- | --- | --- | --- |
| 9 | pre-existing | `cjk-ruby.runtime.js`, `nom-ruby-scan.js`, `overlay-labels.js` | Two fixes on `claude/zealous-lamport-pcm7fh` (065a9b1, a356054) were never merged. Ruby is still added inside the popup, and under-labels are lifted onto their own word. | Merge the branch (clean merge) and run its tests. | done (0558a0d) |
| 1 | important | `cjk-ruby.runtime.js` `dropStale`/`isFrozen` | A streamed chat answer freezes after 3 token writes and stays bare. The counter never resets and also blocks new text under the same parent. | The count is per text node. Text that only grew is not a rewrite. Only rewrites within 2 s of each other count. A frozen node gets one more look once it has been quiet. jsdom tests cover streaming, freeze, re-check and new text. | done (a801f78) |
| 7 | important | `cjk-ruby.runtime.js` `retryNow` | Every tab return wipes all endpoint cool-downs and back-off, including real 429s. | An `interruptions` epoch counts hidden/offline moments. A failure across one gets no cool-down and a "soft" back-off. Only soft back-off is cleared on return. | done (a801f78) |
| 11 | nit | `cjk-ruby.runtime.js` `LOCAL_SITE_RULES`/`pickSiteFix` | A local `exclude` is dropped, and a local rule is hidden behind a built-in fix for the same host. | Copy `exclude`, and merge every matching fix in table order. | done (a801f78) |
| 2 | important | `local-form-helpers.js`, `local-requests.js` | Closing the Nôm box during a per-channel Refresh all still draws late replies into the next word's list, and the button stays disabled. | Cancelled runs ignore `onRows`, the redraw and `take`. `cancel()` gives the button back at once. `{run, cancel}` is returned. | done (ec4d2dc) |
| 14 | nit | `local-requests.js` `onabort` | An abort by the manager counts as a finished stream, so 'waiting' rows stay forever. | `onabort` resolves `Boolean(control && control.cancelled)`, so the per-channel fallback runs. | done (ec4d2dc) |

### book-translator

| # | Severity | Where | Problem | Planned fix | Status |
| --- | --- | --- | --- | --- | --- |
| 4 | important | `scripts/study_review.py` apply | Phase C resets `STATUS: verified` to `needs_review` for every batch entry. | Keep the stored status on apply (a fix keeps a verified entry verified; only text the reviewer changed is rewritten). Test: a verified entry stays verified with and without a fix. | planned |
| 5 | important | `scripts/study_review.py` apply | A fix whose id is not in the batch is dropped silently, and the whole batch is marked checked. | Compare the answer's ids with the batch ids and report unknown ones. When any fix went unmatched, mark nothing checked. Test with a typo id. | planned |
| 13 | nit | `scripts/study_review.py` `select` | Entries rejected again and again fill every batch, so the pass stops moving. | Record a rejection count per entry in the batch state and move entries rejected twice behind the unchecked rest. Test with 10 entries rejected twice. | planned |
| 3 | important | `scripts/book_export/palettes.py` | With the Night palette, `.par-text`/`.par-other` (and `.prose-reading`, `.tag`) keep their own dark colours, which makes them unreadable. | Add them to the template's text/soft/reading lists. New test: every selector that sets `color` in every layout's CSS is named by the palette. | planned |
| 8 | important | `scripts/check_pdf_layout.py` | The 98th-percentile margin falls on an overflowing edge when more than 2% of lines overflow, and the overflows go unreported. | Derive the limit from the most common right edge (the text column) and the page width. Keep the percentile only as a sanity check. Test with 5.7% overflowing lines. | planned |
| 6 | important | `scripts/reader/static/control.html`, `control_search.html` | A failed first load leaves Save disabled for good with no message (`.catch(() => {})`), and Refresh does not reload the settings. | Show the error with its next step and fold the three GETs into `refresh()` so Refresh retries them (UI rule 2). | planned |
| 10 | nit | `scripts/web_search.py` `engine_groups` | Groups are split by the position of `google-ai`, so `yahoo-jp-ai` lands in Web search. | An `ai` field on `Engine`, grouped by it. Test the group of every AI engine. | planned |
| 12 | nit | `reader_chapter.js`, `study_content.py` | The client decides which study items are numbered (against ui-logic-in-backend). Alternative glosses get a speaking unit but are never spoken. | Send the finished number from `study_sections`. Give alternative glosses no unit (they are not read). Python test. | planned |

## Verification

- zoopdog: `node scripts/test-isolated.js` (whole suite, generated files checked) passed after ec4d2dc, with jsdom from the
  sibling online-dict checkout (`CDP_JSDOM_DIR`). ESLint, `lint-userscripts` and `tsc` are clean.
- book-translator: the cloud container lacks `jieba` (its wheel did not build) and so cannot run some export tests. Each
  fix is verified with the tests of the files it touches, plus `ruff` and `mypy`. Tests the container could not run are
  listed here when the work is finished.
