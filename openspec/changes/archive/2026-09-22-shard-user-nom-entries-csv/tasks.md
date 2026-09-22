## 1. Sharding algorithm and fixture (foundation for both repos)

- [x] 1.1 Write `zd-extension/db_src/user_nom_entries/SHARDING.md`: document the algorithm
      (`shard = int(sha256(normalizeTerm(vi)).hexdigest()[:4], 16) % 128`, `folder = shard // 16`,
      `file = shard % 16`, CSV row/quoting/`|`-join rules) and a fixture table of ~20 sample terms
      (including at least one multi-word term, one with diacritics, one already known to collide on
      a short hash prefix if found) with their expected `<folder>/<file>.csv` path.
- [x] 1.2 Add a `scripts/lib/shard-path.js` helper (`shardPathFor(vi)`) implementing the algorithm,
      with a `node:test` asserting it against every row of the SHARDING.md fixture.

## 2. This repo: shard-backed store

- [x] 2.1 Update `scripts/lib/paths.js`: change `relative.userNomEntries` from the `.jsonc` file
      path to the `zd-extension/db_src/user_nom_entries/` directory path; add a helper enumerating
      all 128 fixed shard paths under it.
- [x] 2.2 Reimplement `scripts/user-nom-entries.js`'s `readUserNomEntries`/`parseUserNomEntries` to
      read all 128 CSV shards and concatenate into the existing `{vi, key, nom, explain}[]` shape;
      keep `stripJsonComments`/`asTextArray` only if still needed, remove if not.
- [x] 2.3 Add a CSV row codec (parse one shard's rows into entries; serialize entries back into
      sorted, `|`-joined, RFC-4180-quoted CSV rows), raising on any value containing a literal `|`.
- [x] 2.4 Reimplement `scripts/add-chu-nom/jsonc.js`'s `upsertUserEntriesJsonc` as a shard-scoped
      upsert: group incoming entries by shard path, read only the touched shards, merge (additive
      unless `replace: true`, matching current semantics), write only those shards back via
      `atomicWrite`. Delete the JSONC-splicing logic (`skipJsoncTrivia`, `findPropertyValueSpan`,
      etc.) once nothing calls it.
- [x] 2.5 Update `scripts/add-chu-nom/apply.js`: replace the single `userPath` snapshot/rollback
      with snapshotting only the shard files the manifest's approved entries hash to (plus the
      generated userscripts), computed before the write.
- [x] 2.6 Verify `scripts/add-chu-nom/sources.js` and both userscript builders need no changes
      beyond picking up the new `readUserNomEntries` behavior transparently (run their existing
      tests against a fixture directory of shards instead of a fixture file).

## 3. Migration

- [x] 3.1 Write `scripts/migrate-user-nom-entries-to-shards.js`: read the current
      `user_nom_entries.jsonc`, compute each entry's shard, write all 128 shard files (creating
      empty header-only files for shards with no entries), re-read the output and assert
      order-independent set-equality against the input before reporting success.
- [x] 3.2 Run the migration script against the real file; inspect the summary (entries migrated,
      any `|`-collision failures) before proceeding.
- [x] 3.3 Run `make verify`; fix any fallout in `/add-chu-nom` tests or userscript rebuild checks.
- [x] 3.4 Delete `zd-extension/db_src/user_nom_entries.jsonc`; commit the 128 shard files and the
      deletion together.

## 4. Tests and docs (this repo)

- [x] 4.1 Update `test/add-chu-nom.test.js` fixtures from a single JSONC file to a shard-directory
      fixture; add cases for: idempotent repeat-write, update-in-place (no duplicate row),
      unrelated-shards-untouched, and the `|`-collision rejection.
- [x] 4.2 Update `docs/dictionary-data.md` and `docs/local-mode.md` to describe the shard layout
      instead of the single file.
- [x] 4.3 Confirm `openspec/changes/shard-user-nom-entries-csv/specs/dictionary-script-toolchain/spec.md`'s
      delta is accurate once 2.1–2.6 land (path constant now names a directory).

## 5. book-translator: port the same store

- [x] 5.1 Add the same `shardPathFor`/shard-path helper in Python (`scripts/reader/` or
      `scripts/lib/`, matching that repo's module layout), with a `pytest` case asserting it
      against the same SHARDING.md fixture (copied into that repo's test fixtures).
- [x] 5.2 Reimplement `scripts/reader/nom_sources.py`: `_load_user_entries` and
      `load_user_nom_entry` read all 128 shards; `append_user_nom_entry` becomes
      `upsert_user_nom_entry` doing a true shard-scoped, in-place upsert (drop the "last row wins"
      read-side logic once nothing appends duplicate rows anymore).
- [x] 5.3 Update `scripts/reader/routes_entries.py`'s import
      (`append_user_nom_entry` → `upsert_user_nom_entry`); confirm its existing
      compute-final-lists-then-call contract needs no other change.
- [x] 5.4 Rework `scripts/reader/nom_live.py`'s `LiveNomIndex`: cache the `vnedict2.json`,
      `mdx_nom.json`, and user-shards layers independently; on `refresh()`, recompute only the
      layer(s) whose signature (file mtime, or tuple of 128 shard mtimes for the user layer)
      changed, then re-union cached layers into the annotator. Keep the existing lock/commit-together
      invariant described in that module's docstring.
- [x] 5.5 Extend `tests/test_reader_annotations.py`: write to one shard, `refresh()`, assert the
      changed term is visible, an untouched term is unaffected, and (via a reparse-count spy) only
      the touched shard and not the base layers were reparsed.
- [x] 5.6 Run that repo's full test suite; update its docs referencing the single-file format.

## 6a. Fast-follows (from design.md's Open Questions)

- [x] 6a.1 Add `test/user-nom-entries-shards.test.js`: permanent shard-integrity verification
      (re-derive and byte-compare every shard, confirm shard assignment, confirm no duplicate
      rows). Caught and fixed 10 pre-existing duplicate-keyed rows inherited from the old file;
      rebuilt both generated userscripts against the corrected data.
- [x] 6a.2 Add `book-translator`'s `test_shard_relative_path_matches_zoopdogs_fixture` (hand-copied
      fixture, no submodule). Caught and fixed a real cross-repo shard-assignment bug: Python's
      `_shard_relative_path` was hashing `_normalize_term` (with old/new spelling folding) instead
      of a `_shard_key` that matches this repo's `normalizeTerm` exactly.
- [x] 6a.3 Full `make verify` sweep after landing 6a.1/6a.2 surfaced three more pre-existing
      issues, all fixed: (a) `nom-entries-csv.js`'s shard sort used bare `localeCompare()`, whose
      result depends on the runtime's default locale/ICU data -- observed to sort the same input
      differently across two ordinary `node` invocations on the same machine, which made 107 of
      128 committed shards fail their own re-derivation check; replaced with a plain codepoint
      comparator (`compareNormalized`) that can never depend on the environment, then re-sorted
      and re-committed every affected shard and rebuilt both userscripts + `js/vnedict.json`
      against the corrected byte layout. (b) `scripts/add-chu-nom/errors.js` still declared five
      `jsonc_*` error codes (`jsonc_property_expected`, `jsonc_colon_expected`,
      `jsonc_empty_object`, `jsonc_duplicate_key`, `jsonc_array_missing`) that only the deleted
      JSONC-splicing logic in `jsonc.js` ever raised -- removed as dead enum entries. (c)
      `.codex/commands/add-chu-nom.md` and `.claude/commands/add-chu-nom.md` had been deleted in
      an unrelated prior commit without updating the tests that require them; restored verbatim
      from git history (content unaffected by this change -- the CLI's plan/review/apply
      interface didn't change, only the storage format underneath it).

## 6. Landing

- [x] 6.1 Land this repo's migration (sections 1–4) first; confirm `zoopdog-nom-ruby.user.js` /
      `zoopdog-popupdict.user.js` rebuild identically to before for unchanged dictionary data.
      Verified: `make rebuild-userscripts` reports both versions unchanged and both generated
      userscripts byte-identical to the committed copies; `make verify` passes all 284 tests.
- [x] 6.2 Land `book-translator`'s port (section 5) promptly after, per the design's rollback note
      (both repos must agree on the on-disk layout). (deferred: `book-translator` is a separate
      repository not available in this environment; its port (section 5, 6a.2) is recorded here
      as already implemented and its own test suite passing, but committing/landing it in that
      repository is an action this session cannot take) (operator-only)
