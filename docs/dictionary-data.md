# Dictionary Data

Dictionary source data lives under `zd-extension/db_src/`.

## Website runtime dictionary

`zd-extension/db_src/vnedict.json` is a regenerated, bug-fixed copy of the legacy
`zd-extension/db_src/vnedict.txt` base vocabulary. It is not read by the
website at runtime (see below) -- it exists as a diffable, testable intermediate. Regenerate it
with:

```sh
make rebuild-extension-dict
```

The website reads the actively maintained `zd-extension/db_src/vnedict2.json` through generated
runtime files. Rebuild after changing the base dictionary, Chu Nom shards, display order or
optional chunom layer, just as you would rerun `make rebuild-userscripts`:

```sh
make rebuild-extension-vnedict-json
```

The target folds in the hand-maintained `zd-extension/db_src/user_nom_entries/` shard store the
same way both userscript builders do -- its renderings lead lower-priority candidates while its
explanations follow the existing glosses -- and then applies `user_nom_order.jsonc` as the
final override. Without that fold an entry added to the shard store reaches the two userscripts
and stays invisible on the website, which reads only this generated file.

Hoisting from `user_nom_order.jsonc` preserves whole source rows. When a preferred rendering
exists only inside a grouped cell (`巴|芭|𠀧|爸`), the build emits a separate exact row ahead of
that untouched group. This guarantees that every surface shows the local preference first.

The target writes compact `zd-extension/js/vnedict.json`, the immutable
`zd-extension/js/vnedict.<sha256>.json`, `zd-extension/js/vnedict.meta.json`, and
`zd-extension/js/vnedict.collisions.json`. The sidecar records the exact JSON byte hash, schema
version, entry count and immutable payload name used to refresh browser IndexedDB. All are
gitignored build output. Releases include the legacy dictionary, sidecar and current immutable
payload, but not the diagnostic collisions report. Retain previously deployed immutable payloads
as described in [build.md](build.md#rebuilding-the-browser-runtime-dictionary).

### Entry identity and normalized-key collisions

`zd-extension/js/vnedict.json` stores one grouped row per normalized lookup key, not one row per
source headword. Grouping is centralized in `scripts/lib/dictionary-identity.js` and shared
between this builder and `scripts/build-popupdict-userscript.js`, so both consumers resolve a
collision like `Ba Lê` (Paris) / `ba lê` (ballet) exactly the same way. A row looks like:

```json
{
  "key": "ba lê",
  "headwords": ["Ba Lê", "ba lê"],
  "en": [
    {"def": "Paris", "pos": ""},
    {"def": "ballet", "pos": "", "headword": "ba lê"}
  ]
}
```

- `key` is the normalized identity (NFC, `vi-VN` lowercase, collapsed whitespace) used for
  lookup; it is never displayed.
- `headwords` is every distinct display form that normalized to `key`, in first-source-occurrence
  order. `headwords[0]` is the primary display form.
- `en` is the ordered set of retained senses. Exact duplicates and supported spelling or
  inflection variants may fold together, while distinct meaning tokens, nonempty parts of
  speech and their display-headword associations must remain represented. A sense carries a
  `headword` field only when it originated from a display form other than `headwords[0]` -- a
  single-headword group (the common case) carries no `headword` field on any sense at all.

`zd-extension/js/vnedict.collisions.json` is a compact, versioned report of every normalized key
with more than one headword (`{schemaVersion, totalKeys, collisionCount, collisions: [{key,
headwordCount, senseCount}]}`) -- counts only, never the definitions themselves, so it is safe to
read by default. The same counts print to the console as `key=headwordCount/senseCount` lines
when `make rebuild-extension-vnedict-json` finds any collisions.

Browsers persist rows via `zd-dictionary-runtime.js`'s coordinator; its metadata schema version
(`ZD_DICTIONARY_METADATA_SCHEMA_VERSION`, currently 2) must match this builder's
`METADATA_SCHEMA_VERSION`. A mismatch (e.g. a browser that still has schema-1, one-row-per-headword
data from before this change) makes the coordinator treat the installed rows as unusable, so it
always performs a full `entries.clear()` + `bulkAdd()` replace rather than mixing old and new row
shapes in the same IndexedDB table.

## Userscripts

```sh
node scripts/build-popupdict-userscript.js
node scripts/build-nom-userscript.js
```

`zoopdog-popupdict.user.js` embeds dictionary data from `zd-extension/db_src/vnedict2.json`,
the `user_nom_entries/` CSV shards, the optional chunom layer and display order, plus shared
word primitives from `zd-extension/js/zd-words.js`. It does not embed pronunciation code.

`zoopdog-nom-ruby.user.js` embeds a compact lookup table built from `vnedict2.json`, the
optional `mdx_nom.json` and chunom layer, and the `user_nom_entries/` shards and order.

Edit the generator or the source data, never the embedded map by hand. The browser
runtime lives in `scripts/userscript/` as real source files — edit it there, not inside
`scripts/build-*.js`, then rebuild.

### Version stamps and auto-update

The public headers carry `@updateURL` and `@downloadURL` pointing at the latest GitHub Release
assets. Userscript managers update only when the published `@version` is greater. Local builds
use a development stamp, while release preflight obtains both previously published versions
from one release and stamps a version newer than either:

- The development stamp uses the build date, `YYYY.MM.DD`; another content change on the same
  date appends a counter (`2026.09.05.1`). The release stamp must exceed published versions.
- A development stamp moves only when the rest of its local file changes. Generated userscripts
  are gitignored; a clean checkout's local stamp is not the authority for release versions.
- Do not edit `@version` by hand in `scripts/userscript/*.runtime.js`; the header holds the
  `__ZOOPDOG_VERSION__` placeholder and the builder fills it in.

A rebuilt public userscript reaches installed copies after it is published as a GitHub Release
asset. To pull it immediately instead of waiting for Tampermonkey's update interval, use its dashboard:
**Utilities → Check for userscript updates**.

## Supplemental MDX data

To regenerate `zd-extension/db_src/mdx_nom.json` from an external MDX dictionary, install
`js-mdict` outside the repository and expose it through `NODE_PATH`:

```sh
tmp=$(mktemp -d /tmp/mdx-extract.XXXXXX)
cd "$tmp" && npm init -y >/dev/null && npm install js-mdict@6.0.6 >/dev/null
NODE_PATH="$tmp/node_modules" node /path/to/zoopdog/scripts/extract-mdx-nom-data.js "/path/to/dict.mdx"
```

The extractor keeps only real Unicode CJK/Nom code points and skips private-use glyphs from
MDX font encodings.

After regenerating, merge before rebuilding:

```sh
node scripts/merge-mdx-nom-into-vnedict2.js
make rebuild-extension-vnedict-json
make rebuild-userscripts
```

## Hand-maintained Chu Nom entries

Add or correct entries through the `zd-extension/db_src/user_nom_entries/` shard store (see
`SHARDING.md` in that directory) and `user_nom_order.jsonc` — either the popup userscript's
local mode (see [`docs/local-mode.md`](local-mode.md)) or the reader's own modals in the
`book-translator` repo. After a change there, rebuild the userscripts and the website's
runtime dictionary (`make rebuild-userscripts`, `make rebuild-extension-vnedict-json`).
