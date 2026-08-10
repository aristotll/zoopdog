# Chu Nom Entry Resolution

Project-specific rules for resolving Vietnamese lookup terms to Chu Nom/CJK entries in Zoopdog dictionary data and userscript generators.

## Lessons Learned

### Lesson Learned: Expand Subphrases, Skip User Entries Only, and Merge Original Definitions (from conversation on 2026-04-19)

**Context**: When processing a phrase such as `kiểm tra xem`, useful candidates can include the full phrase and subphrases such as `kiểm tra`. Some candidates may already exist in the main dictionary but still need user-maintained Chu Nom/CJK or explanation data.

**Rule**:
For multi-word Vietnamese input, check the full phrase and meaningful contiguous subphrases of at least two words. Before proposing any candidate, check `user_nom_entries.jsonc` first. If the word already exists there, skip it. If the word does not exist in `user_nom_entries.jsonc`, it may be proposed even when it exists in the main dictionary sources (`vnedict2.json`, `mdx_nom.json`). Also skip candidates already proposed or added earlier in the same batch.

When user entries overlap original dictionary keys, merge their popup definitions with the original dictionary definitions during generation and remove duplicate definitions in that process.

**Why**: `user_nom_entries.jsonc` is the authority for whether a user entry has already been handled. Original dictionary overlap is allowed because user entries can supplement missing Chu Nom/CJK data; the generated popup output should dedupe the merged definitions instead of showing duplicate blocks.

### Lesson Learned: Clean Processed Input Files After Successful Adds (from conversation on 2026-04-19)

**Context**: `/add-chu-nom` defaults to `.idea/newfile.md` as a scratch input queue. After approved words are added and generated userscripts are rebuilt, leaving the same lines in the queue causes repeated proposals on the next run.

**Rule**:
After a successful file-based `/add-chu-nom` update, remove only the lines or separated items that were actually added or updated. Keep skipped, ambiguous, rejected, or unresolved items in the file for later review.

**Why**: The input file should behave like a work queue: completed items disappear, unresolved work remains visible.

### Lesson Learned: Preserve Vietnamese Word Order in Chu Nom Phrases (from conversation on 2026-04-19)

**Context**: While adding `Sao Vàng`, the first proposal used `黄星`, which is Chinese semantic order for "yellow star". The user corrected it because Zoopdog needs Vietnamese/Chu Nom phrase order, so the corrected entry is `𣋀黃`.

**Rule**:
When resolving Vietnamese multi-word phrases or proper names to Chu Nom/CJK forms, preserve Vietnamese word order unless an exact trusted local source explicitly provides a different established written form. Do not translate the phrase into Chinese semantic order. If exact phrase data is missing, compose from verified component entries and mark the proposal as composed/uncertain for review.

**Code Example**:

```
// Correct
Sao Vàng -> 𣋀黃

// Wrong
Sao Vàng -> 黄星
```

**Why**: Chinese translation order can invert or replace the Vietnamese phrase structure, producing entries that look plausible but are wrong for a Vietnamese popup dictionary and Chu Nom ruby output.
