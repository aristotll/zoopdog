# Chu Nom Workflow: Lessons Now Enforced by Code

These rules were once instructions an agent had to read and remember at the start of every
session. `scripts/add-chu-nom.js` now enforces them, so they are kept here as the record of
why the code behaves the way it does — not as instructions to follow.

The one rule still requiring human or AI judgement, Vietnamese word order in Chu Nom phrases,
lives in `.codex/commands/add-chu-nom.md`, loaded when the workflow actually runs.

## Expand subphrases, skip user entries only, merge original definitions

*From a conversation on 2026-04-19.*

**Context.** Processing a phrase such as `kiểm tra xem` should also consider subphrases such as
`kiểm tra`. Some candidates already exist in the main dictionary but still need
user-maintained Chu Nom/CJK or explanation data.

**Rule.** For multi-word input, check the full phrase and every contiguous subphrase of at
least two words. `user_nom_entries.jsonc` is the sole authority on whether a term has already
been handled: if a term exists there, skip it; otherwise it may be proposed even when it exists
in `vnedict2.json` or `mdx_nom.json`. Skip candidates already proposed earlier in the same
batch. Where user entries overlap original dictionary keys, merge the popup definitions and
drop duplicates during generation.

**Where it lives now.** `resolveItems` in `scripts/add-chu-nom/plan.js` expands subphrases and
marks duplicates; `makeCandidate` sets `skipped` from `sources.userKeys`; the builders merge and
de-duplicate definitions during generation.

## Clean processed input files after successful adds

*From a conversation on 2026-04-19.*

**Context.** `/add-chu-nom` defaults to `.idea/newfile.md` as a scratch input queue. Leaving
applied lines in the queue causes the same terms to be proposed again on the next run.

**Rule.** After a successful file-based update, remove only the items that were actually added
or updated. Keep skipped, ambiguous, rejected, or unresolved items for later review.

**Where it lives now.** `cleanupInputContent` in `scripts/add-chu-nom/input.js`, driven by the
applied entries' source item ids inside the apply transaction.
