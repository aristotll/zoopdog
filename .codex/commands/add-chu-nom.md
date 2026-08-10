---
description: Plan and apply reviewed Chu Nom/CJK user entries through the deterministic Node.js workflow.
---

# /add-chu-nom

Use `scripts/add-chu-nom.js` for all parsing, normalization, local lookup, dictionary edits, input cleanup, userscript generation, and verification. The command provides the conversational review layer only.

## Input

Accept inline Vietnamese words/phrases or a file path/mention such as `.idea/newfile.md#L6-L7`. When the user supplies neither, let the script use `.idea/newfile.md`.

Create a temporary manifest path outside the repository, then run exactly one planning form:

```sh
node scripts/add-chu-nom.js plan --words "<inline input>" --manifest "<manifest>"
```

```sh
node scripts/add-chu-nom.js plan --file "<path-or-file-mention>" --manifest "<manifest>"
```

```sh
node scripts/add-chu-nom.js plan --manifest "<manifest>"
```

## Review

Read the generated JSON manifest and present a compact Vietnamese review table containing original input, proposed `vi`, `nom`, `explain`, status, and provenance/notes. Include skipped candidates and unresolved choices.

For candidates with `input-filtered` provenance, treat the removed characters as noise: do not restore filtered characters as Nom evidence. Review the cleaned Vietnamese phrase against local dictionary evidence, supply or correct `nom` and a concise English `explain` when needed, and present the reviewed result for approval.

Help resolve linguistic ambiguity only. Record the reviewed values in the manifest and set every actionable entry's `decision` to `apply` or `reject`. Do not invoke apply, edit dictionary data, clean the input file, or rebuild generated files before the user explicitly approves the reviewed proposal.

If the user requests changes, update only the temporary manifest and present the revised review again.

## Apply after approval

After explicit approval, run:

```sh
node scripts/add-chu-nom.js apply --manifest "<manifest>" --approve
```

Summarize the structured JSON result in Vietnamese: updated keys, skipped/rejected/unresolved entries, removed input items, rebuilt files, and verification results. If the script reports validation, stale-source, build, or verification failure, report it without bypassing the script or editing generated userscripts directly.

Preserve unrelated worktree changes throughout the workflow.
