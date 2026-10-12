# chunom.org standard characters (order + dictionary)

chunom.org's Chu Nom Project publishes the **standard characters** by frequency (<https://chunom.org/pages/standard/>) and the text of the list with
their compounds (<https://chunom.org/pages/standard-list/?max=2000>, tab-separated `#, Unicode, Freq., Text, QN, English`; `&download=1` is the same text as
an attachment; any `max` of 2000 or more gives the same 3930 rows). It is a **separate, generated data file**, not part of the committed dictionaries.

## The file

```sh
node scripts/import-chunom-standard.js --fetch          # reads the list from chunom.org
node scripts/import-chunom-standard.js --file list.txt  # a saved copy
make rebuild-extension-vnedict-json rebuild-userscripts  # the builders fold it in
```

`zd-extension/db_src/chunom_standard.json` is **gitignored** (never in git history) and shipped as a GitHub Release asset with the userscripts
(`make release-userscripts` adds it when this checkout has it). Its shape is that of `mdx_nom.json` (`entries`: reading -> Nom forms, frequency first) plus
`meanings` (English) and `standard` (reading -> the standard character(s), only the rows with a Unicode column). Rows that are no Nom text (two iteration marks, one
stray `None` reading) are left out: 3927 of 3930 rows, 831 characters, 2285 readings. The importer writes this one file and nothing else: **`vnedict2.json` and every
user file are never modified.**

## How the builds use it (`scripts/chunom-standard-layer.js`: the one place duplicates are handled)

Each builder (nom-ruby userscript, popup-dictionary userscript, the extension / website dictionary) folds the file in memory; without the file they build as before.
Precedence, lowest first: **chunom < the dictionaries < the user's own entries and order**.

- **Dictionary words**: a reading the dictionary has gets the Nom forms it lacks, *behind its own* (`insertNomDefinitions`: a form already there, as a definition or
  inside one, is never added again); a reading it lacks becomes an entry with its Nom forms and the list's English (146 new terms, 809 forms on 2026-10-11, e.g.
  `một triệu 𠬠兆`, `rất là 慄𱺵`). Nothing is written back.
- **Order**: the standard character of a reading goes first (`được` -> 特, ahead of 得 / 待), for the 730 readings of the standard characters only (compounds keep
  the dictionaries' order). **Never for a term the user has an entry for or an order row for** (`readNomOrder` in `scripts/chunom-standard-layer.js`): those readings
  keep exactly what the user defined, and the user's `user_nom_order.jsonc` rows come after chunom's anyway. The reader's "Set Chu Nom order" writes only
  `user_nom_order.jsonc`; nothing of chunom's is copied into it. To go back to the old order, delete `chunom_standard.json`.
- **book-translator** reads the same file from the same `--nom-data` directory (`reader/nom_sources.py` `_load_chunom` as a base layer behind `vnedict2.json`,
  `reader/nom_order.py` for the order, with the same user exclusion).

## To know

- A new term's `en` list is its Nom forms first, then chunom's English glosses, the layout `vnedict2.json` already uses (about 18,000 rows). Glosses are kept as
  chunom wrote them, other scripts included: a gloss may cite a Nom spelling (`tư hải`: `... cf. 𦊚𣷷`), and the nom-ruby userscript then reads it as one more
  candidate for that term. This is accepted, not filtered: it is 1 term of the 146, and the extra candidate is a real spelling of it.
- Variants of a standard character (the page's "Variants" column, e.g. `của`: 𧵑 and 𧶮) are not in the text list; only the standard form is.
- The standard form is chunom's choice from historical corpora, not always the modern one (`đặc biệt` is `特别` there, `特別` in the dictionary, which keeps
  priority for compounds): that is why compounds are only added behind, and only characters are ordered.
- Research and probes (the other pages of chunom.org, the speaker, the books): `~/mine/book-translator/docs/research/chunom_org/`.
