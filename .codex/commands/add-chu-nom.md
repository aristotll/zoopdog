---
description: Resolve Vietnamese words to Chu Nom/CJK forms, ask for review, then update user_nom_entries.jsonc and rebuild userscripts.
---

# /add-chu-nom

Resolve a user-provided list of Vietnamese words/phrases into Chu Nom/CJK forms, ask the user to review the proposed entries, then add or update approved entries in `zd-extension/db_src/user_nom_entries.jsonc` and rebuild the generated userscripts.

## Arguments

- `words`: Vietnamese words or phrases, separated by newlines, commas, semicolons, or `|`.
- Optional inline form: `Vietnamese / ChuNom / explanation`.

## Preprocess

Before resolving Chu Nom/CJK forms, clean and interpret the input:

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
2. Check existing local data before proposing anything:
   - `zd-extension/db_src/user_nom_entries.jsonc`
   - `zd-extension/db_src/vnedict2.json`
   - `zd-extension/db_src/mdx_nom.json` when present
   - generated output only as a verification target, not as source of truth
3. Resolve Chu Nom/CJK candidates:
   - Prefer exact local matches from existing dictionary data.
   - If the user supplied an inline Chu Nom form, keep it unless it is clearly malformed.
   - If multiple defensible Chu Nom/CJK forms exist, store all of them in `nom`.
   - Mark uncertain forms clearly in the proposal.
4. Resolve popup explanations:
   - Auto-fill concise English explanations in `explain`.
   - Prefer existing English definitions from exact local dictionary matches.
   - If no local English definition exists, infer a short English explanation only when the meaning is clear; otherwise ask during review.
   - Do not duplicate the Chu Nom/CJK values in `explain`; those belong in `nom`.
   - Preserve Vietnamese text and diacritics exactly.
5. Ask the user to review before editing files:
   - Present a compact table with original input, corrected `vi`, `nom`, `explain`, and source/notes.
   - Ask a direct question such as: "Bạn muốn áp dụng các entry này không, hay sửa candidate nào trước?"
   - Do not update `user_nom_entries.jsonc`, do not rebuild, and do not touch generated userscripts until the user approves.
   - If the user edits the proposal, apply the edited version.
6. Update `zd-extension/db_src/user_nom_entries.jsonc` after approval:
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
7. Rebuild both generated userscripts:

```sh
node scripts/build-nom-userscript.js
node scripts/build-popupdict-userscript.js
```

8. Verify the requested keys were embedded:
   - `zoopdog-nom-ruby.user.js` contains each normalized key in `NOM_MAP`.
   - `zoopdog-popupdict.user.js` contains each normalized key in `ZOO_DICTIONARY`.
9. Run syntax checks:

```sh
node --check scripts/user-nom-entries.js
node --check scripts/build-nom-userscript.js
node --check scripts/build-popupdict-userscript.js
```

10. Finish with a short Vietnamese summary:
   - words added or updated
   - generated files rebuilt
   - any unresolved or uncertain entries
   - any unrelated dirty files left untouched

## Guardrails

- Do not edit `zoopdog-nom-ruby.user.js` or `zoopdog-popupdict.user.js` directly except by running the build scripts.
- Do not auto-apply proposals; user review and approval are required before editing JSONC or rebuilding.
- Do not modify `vnedict2.json` for this command.
- Do not remove existing user entries unless the user explicitly asks.
- Do not revert unrelated worktree changes.
