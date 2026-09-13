## Why

`zd-extension/db_src/user_nom_entries.jsonc` has grown past 11,000 lines. Every add or update —
whether from `/add-chu-nom`'s apply step or the reader server's "Add Chữ Nôm entry" / "Set order"
modals (`book-translator`, a separate repository that reads and writes this same file directly) —
reads the whole file into memory, rewrites it whole, and (on the reader server) forces a full
reparse of the entire merged Nôm index before the next lookup, adding a documented ~1–1.5s stall
after every save. It also means every single-entry change is a large, hard-to-scan diff against
an already-huge file. None of this gets better as the dictionary keeps growing — it gets worse.

## What Changes

- **BREAKING**: `zd-extension/db_src/user_nom_entries.jsonc` (single JSONC file, JSON array of
  `{vi, nom, explain}`) is replaced by `zd-extension/db_src/user_nom_entries/` (128 CSV shard
  files: 8 subfolders × 16 files), each holding `vi,nom,explain` rows for the slice of terms whose
  normalized-term hash maps to that shard. `nom` and `explain` stay multi-valued, joined with `|`
  within their CSV cell (a value already never contains `|`; the writer now fails loudly if one
  ever would, instead of silently corrupting a shard).
- A single deterministic sharding algorithm (SHA-256 of the normalized `vi` term, mod 128) is
  documented once and implemented identically in both this repo (JS) and `book-translator` (Python),
  with a shared fixture of term → shard-path test vectors so the two implementations are proven to
  agree, not just assumed to.
- `scripts/user-nom-entries.js` (`readUserNomEntries`/`parseUserNomEntries`) and
  `scripts/add-chu-nom/jsonc.js` (`upsertUserEntriesJsonc`) are reimplemented against the sharded
  CSV layout but keep their existing call signatures and return shapes, so `scripts/add-chu-nom/sources.js`,
  `scripts/add-chu-nom/apply.js`, and both userscript builders (`build-nom-userscript.js`,
  `build-popupdict-userscript.js`) need no behavioral changes — only `scripts/lib/paths.js`'s path
  constant changes from a file to a directory.
- Add/update becomes a true in-place upsert per shard (read ~10–100 rows, not 11,000+; write the
  same shard back) instead of the current "always append a new row, last one wins" pattern still
  used by `book-translator`'s `append_user_nom_entry` — duplicate historical rows for the same term
  stop accumulating.
- `book-translator`'s `scripts/reader/nom_sources.py` (`append_user_nom_entry` → renamed
  `upsert_user_nom_entry`, `load_user_nom_entry`, `_load_user_entries`) and
  `scripts/reader/nom_live.py` (`LiveNomIndex`) are ported to the same shard layout. `LiveNomIndex`
  additionally starts caching the vnedict/MDX base layers separately from the user-entries layer,
  so that saving one Chữ Nôm entry only reparses that one shard plus a re-union of already-cached
  layers, not the tens-of-thousands-of-rows base dictionaries — this is the change that actually
  removes the reload stall, not just the file split by itself.
- A one-time migration script converts the existing `user_nom_entries.jsonc` into the 128 shard
  files (all 128 created up front, including empty ones, so shard enumeration is a fixed list, not
  a directory listing) and verifies the entry set round-trips exactly before the old file is
  deleted.
- `zd-extension/db_src/user_nom_order.jsonc` is unaffected — it stays a single small JSONC file;
  this change is scoped to `user_nom_entries.jsonc` only.

## Capabilities

### New Capabilities
- `sharded-nom-entries-store`: the on-disk shard layout, the CSV row format, the sharding
  algorithm, and the read/upsert contract that both repositories' code implements against.

### Modified Capabilities
- `dictionary-script-toolchain`: the "Repository paths are declared once" requirement's scenario
  naming `user_nom_entries.jsonc` as a path constant needs to describe a directory constant instead.

## Impact

- **Affected code (this repo)**: `scripts/lib/paths.js`, `scripts/user-nom-entries.js`,
  `scripts/add-chu-nom/jsonc.js`, `scripts/add-chu-nom/apply.js` (shard-scoped snapshot/rollback),
  `scripts/add-chu-nom/sources.js` (path resolution only), `test/add-chu-nom.test.js`, `docs/dictionary-data.md`,
  `docs/local-mode.md`, `openspec/specs/dictionary-script-toolchain/spec.md`, a new one-time
  migration script, and the tracked `zd-extension/db_src/user_nom_entries.jsonc` file itself
  (deleted, replaced by `zd-extension/db_src/user_nom_entries/**`).
- **Affected code (`book-translator`, coordinated but separate repository)**:
  `scripts/reader/nom_sources.py`, `scripts/reader/nom_live.py`, and their test coverage
  (`tests/test_reader_annotations.py`, `tests/test_reader_nom_order.py`). `scripts/reader/routes_entries.py`
  only needs its import renamed (`append_user_nom_entry` → `upsert_user_nom_entry`); its call
  contract (pass the complete final `nom`/`explain` lists) is unchanged.
- **Dependents unaffected by call-signature preservation**: `scripts/add-chu-nom/sources.js`,
  `scripts/build-nom-userscript.js`, `scripts/build-popupdict-userscript.js`,
  `scripts/reader/routes_entries.py` (beyond the import rename).
- **Not touched**: `zd-extension/db_src/user_nom_order.jsonc`, `vnedict2.json`, `mdx_nom.json`,
  `vnedict.txt`/`db_src/vnedict.json` (separate, already-tracked pipeline in
  `harden-dictionary-data-pipeline`).
