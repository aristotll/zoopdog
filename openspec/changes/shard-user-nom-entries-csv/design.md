## Context

`zd-extension/db_src/user_nom_entries.jsonc` is a single JSON array of `{vi, nom, explain}`
objects, hand-editable JSONC (comments allowed, though none are currently used — confirmed by
scanning the tracked file: zero `//` or `/* */` lines exist today). Two independent writers touch
it:

- This repo's `/add-chu-nom` workflow (`scripts/add-chu-nom/jsonc.js`'s `upsertUserEntriesJsonc`,
  called from `scripts/add-chu-nom/apply.js`): parses the whole file, finds an existing row by
  normalized key and edits it *in place* (true update), or appends a new row; writes the whole
  file back via `atomicWrite`.
- `book-translator`'s reader server (`scripts/reader/nom_sources.py`'s `append_user_nom_entry`,
  called from `scripts/reader/routes_entries.py`): always appends a new row, text-spliced before
  the closing `]`, and relies on "the *last* row for a given `vi` wins" at read time
  (`load_user_nom_entry`, `_load_user_entries` both take the last match). It never edits an
  existing row.

Both read the entire file into memory and rewrite it whole for a single-row change. On the reader
server, every write also bumps the file's mtime, and `LiveNomIndex.refresh()`
(`scripts/reader/nom_live.py`) treats any of its four watched files' mtime moving as "reload
everything" — `load_nom_data()` reparses `vnedict2.json` (tens of thousands of rows) and
`mdx_nom.json` from scratch even though only the small user-entries file actually changed. That
full reload, documented in `book-translator`'s `docs/local-mode.md`-referenced comment, is the
~1–1.5s stall users see right after saving one entry.

`readUserNomEntries(path)` (`scripts/user-nom-entries.js`) is the only call site the two userscript
builders and `scripts/add-chu-nom/sources.js` use to reach this file — it returns
`{vi, key, nom, explain}[]` regardless of what's on disk underneath. That single choke point is
what makes an on-disk format change contained: as long as the function's signature and return
shape don't change, none of its callers need to.

## Goals / Non-Goals

**Goals:**
- Replace the single 11,000+-line JSONC file with a sharded CSV layout (8 folders × 16 files = 128
  shards) so a single add/update reads and writes on the order of tens of rows, not the whole
  dictionary.
- Make add/update a true in-place upsert on both writers (this repo's and `book-translator`'s),
  removing the "append and rely on last-match-wins" pattern.
- Make the reader server's post-save reload cost proportional to the shard that changed, not to
  the full merged index — the actual fix for the documented reload stall, not just a side effect
  of smaller files.
- Keep every existing call site (`readUserNomEntries` callers, `routes_entries.py`'s call into
  `nom_sources.py`) working with the same function signatures and return shapes.
- One sharding algorithm, specified once, implemented identically in both repositories, proven
  identical by a shared fixture rather than by two people reading the same prose.

**Non-Goals:**
- `zd-extension/db_src/user_nom_order.jsonc` — small, not a stated pain point, stays as-is.
- `vnedict2.json`, `mdx_nom.json`, `vnedict.txt`/`db_src/vnedict.json` — separate pipeline, already
  tracked by `harden-dictionary-data-pipeline`.
- Preserving hand-written comments in the new format. JSONC's comment support exists in the
  current parser but is unused (verified: zero comment lines in the tracked file today); CSV has
  no equivalent, and nothing on disk would be lost by dropping it.
- Changing the wire contract of `/v1/nom/entries` or `/v1/nom/order` (`book-translator`'s reader
  API) — this is a storage-layer change underneath those routes, not a routes change.
- Rebalancing shard count dynamically. 128 fixed shards is a size-of-repository decision, not
  something the code recomputes.

## Decisions

**1. Shard key: `int(sha256(normalizeTerm(vi)).hexdigest()[:4], 16) % 128`, folder =
`shard // 16` (2-digit decimal, `00`–`07`), file = `shard % 16` (2-digit decimal, `00`–`15`) + `.csv`.**
`normalizeTerm`/`_normalize_term` already exist in both repos and are already documented as
mirroring each other (`nom_sources.py`'s module docstring), so hashing their output is the one
normalization boundary that's already proven consistent. SHA-256 matches the hash already used
elsewhere in this repo for integrity (`scripts/add-chu-nom/fsutil.js`'s `hashFile`), so no new
hash primitive enters the toolchain. Taking the first 4 hex chars (16 bits) before the mod gives
more than enough entropy for 128 buckets while keeping the computation trivial to re-derive by
hand when debugging. The algorithm, plus a fixture of ~20 sample terms and their expected shard
paths, is written once to `zd-extension/db_src/user_nom_entries/SHARDING.md` and both repos' test
suites assert their own implementation against that fixture — this is what makes "identical
algorithm" a tested fact instead of an assumption two people copied by hand.
*Alternative considered*: shard by first character of the normalized term (an "alphabetical"
layout). Rejected — Vietnamese term frequency is heavily skewed by first letter/tone, so this
would produce wildly uneven shard sizes instead of the roughly-uniform ~10-per-shard-today,
scaling-together-later distribution a hash gives.

**2. All 128 shard files are created up front (including empty ones, header row only) and always
exist as a fixed, enumerable list — never a directory listing.**
`LiveNomIndex` needs to `stat()` every shard on each request to detect changes; a fixed list of 128
known relative paths (derived from the same `folder × file` ranges the sharding algorithm defines)
is 128 cheap `stat()` calls, same order of magnitude as today's 4. A directory listing would work
too, but makes "how many shards exist" a runtime fact instead of a documented constant, and an
accidentally-deleted shard file would silently look like "this shard is empty" instead of a
missing-file error surfaced the same way a missing `vnedict2.json` already is.
*Alternative considered*: lazily create shard files only when they first get an entry. Rejected —
non-uniform existence makes both the reader server's mtime tracking and any future "list all
shards" tooling stateful in a way that buys nothing (128 near-empty CSV files cost nothing to
keep).

**3. CSV row shape: `vi,nom,explain`, one row per term, `nom`/`explain` each `|`-joined when
multi-valued; standard RFC 4180 quoting handles a literal comma inside an `explain` string (already
happens today — "manager, manage, administer" — with zero special-casing needed beyond using a
real CSV writer/reader on both sides, not manual `.join(',')`).**
`|` never appears in any current `nom` or `explain` value (verified against the full existing
dataset). Both writers validate this at write time and raise (`WorkflowError` here,
`NomEntryWriteError` in `book-translator`) rather than silently join two distinct values into one
on a future collision — consistent with this codebase's existing fail-loud conventions instead of
adding a second escaping layer for a character that has never once appeared in eight years of this
dictionary's growth.
*Alternative considered*: JSON-encode the `nom`/`explain` arrays into a single CSV cell (e.g.
`"[\"管理\"]"`). Rejected — reintroduces JSON parsing per cell for no compactness benefit over a
plain `|`-join, and defeats the goal of the format being more compact and easier to hand-read/diff.

**4. Rows within a shard are kept sorted by normalized `vi`, rewritten in full on every touch to
that shard.**
A shard is ~10–100 rows; rewriting one in full is negligible. Sorting keeps a single insertion a
one-line diff (the new row lands next to its alphabetical neighbors) instead of always appending
at the end, which matters more here than in the old monolithic file because there's no longer a
single "end of file" a human skims to find the newest additions — sorted order is now the only
findability aid.

**5. `readUserNomEntries`/`parseUserNomEntries` (JS) and `_load_user_entries`/`load_user_nom_entry`
(Python) keep their exact current signatures and return shapes; only their internals change from
"read one file" to "read 128 files and concatenate."**
This is what keeps `scripts/add-chu-nom/sources.js`, both userscript builders, and
`scripts/reader/routes_entries.py` untouched (routes_entries.py needs only the renamed import,
`append_user_nom_entry` → `upsert_user_nom_entry`, because the function becomes a true upsert
instead of an always-append). Concatenating 128 small reads costs about the same total I/O as one
big read; the win is entirely on the *write* side (touch one shard, not all 128) and, with Decision
6, on the reader server's *reload* side.

**6. `LiveNomIndex` caches each dictionary layer (`vnedict2.json`, `mdx_nom.json`, the user-shards
layer) independently, keyed by that layer's own mtime signature, and only recomputes the layer(s)
whose signature moved before re-unioning all layers into the annotator.**
This is the decision that actually removes the reload stall — without it, sharding the user file
changes nothing about reload cost, because `load_nom_data()` today reparses *everything* on any
mtime change regardless of which file moved. The user-shards layer's own signature is the tuple of
all 128 shard mtimes; when it changes, only the shard(s) whose individual mtime moved are
reparsed and merged into the cached user-layer dict (shards are disjoint over the hash space, so
merging changed shards into the existing layer dict is a plain per-shard replace, never a
cross-shard merge). The base layers (`vnedict2.json`, `mdx_nom.json`) keep their current
from-scratch-on-change behavior — they change far less often and were never the target of this
change.
*Alternative considered*: keep `load_nom_data()` as one from-scratch function and just point it at
128 files instead of 1. Rejected — this is the "file split with no actual latency win" trap: total
bytes parsed per reload would be unchanged (still all of `vnedict2.json` + `mdx_nom.json` + every
shard, every time), so the documented ~1–1.5s stall would survive this change untouched despite
the file layout looking improved.

## Risks / Trade-offs

- **[Risk]** Two independently-written implementations (JS, Python) of the same SHA-256-mod-128
  sharding algorithm could silently diverge (off-by-one in the modulo, endianness of the hex-slice
  read, a normalization mismatch) and start writing the same term to different shards from each
  side, corrupting the "exactly one row per term" invariant. → **Mitigation**: the shared fixture
  file (Decision 1) is asserted against by both `node:test` and `pytest`; CI in both repos fails if
  either implementation's output for any fixture term disagrees with the documented shard path.
- **[Risk]** The one-time migration (11,000+ lines → 128 files) is a large, un-reviewable-line-by-line
  diff, and a bug in the migration script could silently drop or duplicate an entry. →
  **Mitigation**: the migration script re-parses its own 128 output shards after writing them and
  asserts the resulting `{vi, nom, explain}` set is set-equal (order-independent) to what it read
  from the original file, failing loudly and writing nothing if not; the old file is only deleted
  after that check passes.
- **[Risk]** `LiveNomIndex`'s move from "one `load_nom_data()` call" to "three independently cached,
  independently invalidated layers" is a real increase in that module's complexity, and a bug in
  the merge-changed-shards-into-cached-layer logic could serve stale or duplicated entries for a
  term whose shard just changed. → **Mitigation**: `tests/test_reader_annotations.py` gains cases
  that write to one shard, call `refresh()`, and assert both that the changed term's new value is
  visible and that terms in untouched shards are unaffected and were not reparsed (asserted via a
  reparse-count spy, mirroring how `nom_live.py`'s existing docstring already reasons about the
  check-reload-commit lock).
- **[Trade-off]** 128 small files versus 1 large file means more files to `git status`/`git add`
  per change, and a naive `grep` across the dictionary now needs `grep -r` over a directory instead
  of one file. Accepted per the explicit preference driving this change (many small files over one
  large one); `make` gets a `grep-nom-entries` convenience target so the ergonomics regression has
  a documented answer.

## Migration Plan

1. Document the sharding algorithm and its fixture in
   `zd-extension/db_src/user_nom_entries/SHARDING.md`; add the JS-side fixture test.
2. Write `scripts/migrate-user-nom-entries-to-shards.js`: read the current
   `user_nom_entries.jsonc`, compute each entry's shard, write all 128 CSV files (creating empty
   header-only files for shards that receive nothing), re-parse the output and assert set-equality
   against the input, then report a summary (entries migrated, shards touched, any `|`-collision
   failures found before writing anything).
3. Reimplement `scripts/user-nom-entries.js` (`readUserNomEntries`/`parseUserNomEntries`) and
   `scripts/add-chu-nom/jsonc.js` (`upsertUserEntriesJsonc` → shard-scoped upsert) against the new
   layout; update `scripts/lib/paths.js`'s `userNomEntries` constant from a file path to the shard
   root directory; update `scripts/add-chu-nom/apply.js`'s snapshot/rollback to snapshot only the
   shard files a given manifest's entries actually touch (computed from their keys' shard paths)
   plus the two generated userscripts.
4. Run the migration script once, verify `make verify` (existing `/add-chu-nom` tests, rebuilt
   userscripts byte-comparison where applicable) still passes, delete the old
   `user_nom_entries.jsonc`, commit the 128 shard files.
5. Port `book-translator`'s `scripts/reader/nom_sources.py` (`append_user_nom_entry` →
   `upsert_user_nom_entry`, `load_user_nom_entry`, `_load_user_entries`) and
   `scripts/reader/nom_live.py` (`LiveNomIndex`'s per-layer caching) to the same shard layout and
   algorithm, asserted against the same fixture from step 1; update the one import in
   `scripts/reader/routes_entries.py`.
6. Update `docs/dictionary-data.md`, `docs/local-mode.md` (both repos as applicable), and
   `openspec/specs/dictionary-script-toolchain/spec.md`'s path-constant scenario.

Rollback: each repo's migration is one commit; reverting it restores the previous single-file
format and code path in that repo. Because both repos must agree on which layout is on disk at any
given moment, a rollback in one repo without the matching rollback in the other would break reads
— call this out explicitly in both commit messages, and land `book-translator`'s port promptly
after this repo's migration lands rather than leaving the two repos on different layouts for an
extended period.

## Open Questions

- Should the migration script's fixture-verification step (set-equality check) become a permanent
  `make verify` target that re-derives all 128 shards from scratch and diffs against what's
  committed, catching hand-edits that violate sort order or the shard-assignment invariant? Leaning
  yes, but scoping it here would grow this change; flagging as a likely fast-follow.
- `book-translator` currently has no automated cross-repo test that pins its sharding
  implementation against this repo's fixture file at a specific commit/path. For now the fixture
  is duplicated by hand into both repos' test fixtures (mirroring how `nom_sources.py` already
  duplicates several of this repo's algorithms today); a longer-term fix (shared submodule, published
  package) is out of scope here.
