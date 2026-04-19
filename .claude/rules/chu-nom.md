# Chu Nom Entry Resolution

Project-specific rules for resolving Vietnamese lookup terms to Chu Nom/CJK entries in Zoopdog dictionary data and userscript generators.

## Lessons Learned

### Lesson Learned: Expand Subphrases and Skip Existing Dictionary Keys (from conversation on 2026-04-19)

**Context**: When processing a phrase such as `kiểm tra xem`, useful candidates can include the full phrase and subphrases such as `kiểm tra`. However, `kiểm tra` already exists in the main dictionary, so adding it again to user-maintained entries would duplicate local data.

**Rule**:
For multi-word Vietnamese input, check the full phrase and meaningful contiguous subphrases of at least two words. Before proposing any candidate, check both `user_nom_entries.jsonc` and the main dictionary sources (`vnedict2.json`, `mdx_nom.json`). Skip candidates that already exist in user-added entries, the main dictionary, or earlier in the same batch; only propose missing candidates.

**Why**: Subphrase expansion catches useful missing entries, while existence checks prevent user-maintained data from becoming a duplicate overlay for entries that the dictionary already owns.

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
