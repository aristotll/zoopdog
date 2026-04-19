---
description: Resolve Vietnamese words to Chu Nom/CJK forms, ask for review, then update user_nom_entries.jsonc and rebuild userscripts.
---

# /add-chu-nom

Resolve a user-provided list of Vietnamese words/phrases into Chu Nom/CJK forms, ask the user to review the proposed entries, then add or update approved entries in `zd-extension/db_src/user_nom_entries.jsonc` and rebuild the generated userscripts.

## Arguments

- `words`: Vietnamese words or phrases, separated by newlines, commas, semicolons, or `|`.
- `file`: optional path or mention to a text/Markdown file containing Vietnamese words or phrases. Defaults to `.idea/newfile.md` when not specified.
  - Accept plain paths; use `.idea/newfile.md` as the default path.
  - Accept file mentions, including line ranges such as `.idea/newfile.md#L6-L7` or `.idea/newfile.md#L6-7`.
  - If neither `words` nor `file` is specified, read the default path.
- Optional inline form: `Vietnamese / ChuNom / explanation`.

## Preprocess

Before resolving Chu Nom/CJK forms, clean and interpret the input:

- Choose the source:
  - If inline `words` are provided, use them.
  - Else if a `file` path or file mention is provided, read that file.
  - Else read `.idea/newfile.md`.
- For file input:
  - Use the selected line range when the mention includes one.
  - Otherwise use every non-empty line in the file.
  - Ignore Markdown headings, horizontal rules, fenced-code markers, and blank lines.
- Split on newlines, commas, semicolons, or `|`, while preserving inline `Vietnamese / ChuNom / explanation` triples.
- Accept Vietnamese with diacritics, Vietnamese without diacritics, or lightly mistyped input.
- Normalize whitespace and Unicode before lookup.
- For no-diacritic input, accent-fold local dictionary keys and restore the best Vietnamese spelling from exact folded matches.
  - Example: `quan ly` should resolve to `quản lý` if that folded match is unique.
- For typos or ambiguous folded matches, present the possible corrected Vietnamese forms in the review step and ask the user to choose.
- Store the corrected Vietnamese form with diacritics in `vi`; keep the original user input only in review notes.

## Workflow

1. Read the input list and normalize each Vietnamese lookup key with the same behavior as the build scripts:
   - trim
   - NFC normalize
   - lowercase with `vi-VN`
   - collapse repeated whitespace
   - accent-fold only for matching no-diacritic or typo input, never for the stored `vi`
2. Expand multi-word inputs into candidate phrases before lookup:
   - Include the full phrase and meaningful contiguous subphrases of at least two words.
   - Prefer longer phrases first, then shorter subphrases.
   - Example: `kiểm tra xem` should check `kiểm tra xem` and `kiểm tra`; do not add a candidate only if it already exists in `user_nom_entries.jsonc` or earlier in the same batch.
   - De-duplicate candidates by normalized key across the current batch.
3. Check existing local data before proposing anything:
   - `zd-extension/db_src/user_nom_entries.jsonc`
   - `zd-extension/db_src/vnedict2.json`
   - `zd-extension/db_src/mdx_nom.json` when present
   - generated output only as a verification target, not as source of truth
   - If a candidate key already exists in user-added entries, skip adding it and note the skip in the review.
   - Do not skip a candidate only because it exists in the main dictionary data. User entries may intentionally add Chu Nom/CJK or explanation data for an existing dictionary key.
   - When a user entry overlaps an original dictionary key, the popup userscript build merges definitions and removes duplicate definitions during generation.
   - Treat keys added earlier in the same batch as existing for later candidates, so repeated input does not create duplicates.
4. Resolve Chu Nom/CJK candidates:
   - Prefer exact local matches from existing dictionary data.
   - If the user supplied an inline Chu Nom form, keep it unless it is clearly malformed.
   - If multiple defensible Chu Nom/CJK forms exist, store all of them in `nom`.
   - For Vietnamese multi-word phrases and proper names, preserve Vietnamese word order unless an exact local source explicitly gives a different established written form.
     - Do not translate a Vietnamese phrase into Chinese semantic order. For example, `Sao Vàng` should be composed as `𣋀黃`, not `黄星`.
     - When composing from component entries, verify each component's meaning and mark the result as composed/uncertain in the proposal.
   - Mark uncertain forms clearly in the proposal.
5. Resolve popup explanations:
   - Auto-fill concise English explanations in `explain`.
   - Prefer existing English definitions from exact local dictionary matches.
   - If no local English definition exists, infer a short English explanation only when the meaning is clear; otherwise ask during review.
   - Do not duplicate the Chu Nom/CJK values in `explain`; those belong in `nom`.
   - Preserve Vietnamese text and diacritics exactly.
6. Ask the user to review before editing files:
   - Present a compact table with original input, corrected `vi`, `nom`, `explain`, and source/notes.
   - Include skipped candidates in the review notes when they already exist in `user_nom_entries.jsonc` or were already added earlier in the same batch.
   - If a candidate also exists in `vnedict2.json` or `mdx_nom.json`, note that it will be merged/deduped with original dictionary definitions after approval.
   - Ask a direct question such as: "Bạn muốn áp dụng các entry này không, hay sửa candidate nào trước?"
   - Do not update `user_nom_entries.jsonc`, do not rebuild, and do not touch generated userscripts until the user approves.
   - If the user edits the proposal, apply the edited version.
7. Update `zd-extension/db_src/user_nom_entries.jsonc` after approval:
   - Upsert by normalized Vietnamese key.
   - Keep the object shape:

```jsonc
{
  "vi": "tiếng Anh",
  "nom": ["㗂英"],
  "explain": ["English language"]
}
```

   - Preserve comments and keep the file valid JSONC.
8. Remove applied words from the input file after a successful update:
   - Only do this for file input, not inline `words`.
   - Remove lines or line items whose normalized key was added or updated successfully.
   - Preserve unprocessed, skipped, ambiguous, or rejected lines so they can be reviewed later.
   - If a line contains multiple separated words, remove only the applied items and keep the remaining items on that line.
9. Rebuild both generated userscripts:

```sh
node scripts/build-nom-userscript.js
node scripts/build-popupdict-userscript.js
```

10. Verify the requested keys were embedded:
   - `zoopdog-nom-ruby.user.js` contains each normalized key in `NOM_MAP`.
   - `zoopdog-popupdict.user.js` contains each normalized key in `ZOO_DICTIONARY`.
11. Run syntax checks:

```sh
node --check scripts/user-nom-entries.js
node --check scripts/build-nom-userscript.js
node --check scripts/build-popupdict-userscript.js
```

12. Finish with a short Vietnamese summary:
   - words added or updated
   - skipped candidates and why
   - input file lines/items removed after successful add/update
   - generated files rebuilt
   - any unresolved or uncertain entries
   - any unrelated dirty files left untouched

## Guardrails

- Do not edit `zoopdog-nom-ruby.user.js` or `zoopdog-popupdict.user.js` directly except by running the build scripts.
- Do not auto-apply proposals; user review and approval are required before editing JSONC or rebuilding.
- Do not modify `vnedict2.json` for this command.
- Do not remove existing user entries unless the user explicitly asks.
- Do not revert unrelated worktree changes.
