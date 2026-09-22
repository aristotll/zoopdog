# Build and Verification

The repository has no `package.json` and pins no build dependencies. Maintenance tasks run
through the dependency-free `Makefile`; page and style compilation needs `pug` and `stylus`
installed on the machine.

## Verification

```sh
make verify
```

`make verify` runs every suite under `test/` and syntax-checks every first-party JavaScript file
under `scripts/`, `js/`, and `zd-extension/js/` (third-party `lib/` files are excluded). The test
command on its own:

```sh
node --test test/*.test.js
```

## Compiling sources

Root pages are authored in `*.jade` and committed as matching `*.html`; root styles are
authored in `css/*.styl` and committed as matching `css/*.css`. Extension pages and styles
follow the same pattern under `zd-extension/`.

Website pages:

```sh
pug index.jade popupdict.jade pronunciation.jade homophones.jade pronguide.jade
```

Extension pages, with pretty output:

```sh
pug -P zd-extension/frame.jade zd-extension/popup.jade
```

Website styles:

```sh
stylus css/style.styl css/pronunciation.styl
```

Extension styles:

```sh
stylus zd-extension/css/zoopdog.styl zd-extension/css/zoopdog-frame.styl zd-extension/css/zd-pron.styl
```

If these CLIs are missing, say so in the final response. Hand-edit generated output only when
the change is small enough to keep the source and the generated file consistent, and commit
both together.

## Rebuilding the userscripts

```sh
make rebuild-userscripts
```

See [dictionary-data.md](dictionary-data.md) for what each userscript embeds and when a
rebuild is required. The builders also stamp `@version`.

The github-hosted `zoopdog-*.user.js` are gitignored build output, not committed. Publishing:

```sh
npm install                 # once: esbuild is the only dependency
make release-userscripts    # rebuild, minify into dist/, gh release create (DRY_RUN=1 to preview)
```

`make minify-userscripts` writes the esbuild-minified copies to `dist/` (metadata block kept
verbatim; the `-local` builds are not minified). `release-userscripts` needs the GitHub CLI
(`gh`) and uploads them as assets of a new release; `@updateURL`/`@downloadURL` point at
`releases/latest/download/<name>`, so a new release is what makes installed copies auto-update.
The version stamp is derived from the previous local build, so keep the last build around
(or bump manually) when releasing from a fresh clone.

Each builder writes two files: the committed `zoopdog-*.user.js` (updates from github, as
above) and an uncommitted `zoopdog-*-local.user.js` that updates from its own `file://` path on
this machine instead — for `zoopdog-popupdict-local.user.js` that also means it is the only
build carrying the local Chữ Nôm add/edit ability (see
[local-mode.md](local-mode.md)). See `.gitignore` for the `-local` filenames.

### Embedded data format and load cost

The builders embed `NOM_MAP`, `CASE_SENSITIVE_NOM_MAP` and `ZOO_DICTIONARY` as
`JSON.parse("...")` string literals (`jsonParseLiteral` in `scripts/lib/userscript.js`), not object
literals: V8 parses the same data about twice as fast that way (≈140 ms vs ≈275 ms for the popup
dictionary). The runtime templates keep their `{"__ZOOPDOG_*__": true}` placeholders, so a test can
still render one with a plain object. `scripts/add-chu-nom/apply.js` reads the maps back through
`extractAssignedJson`, which understands both forms — never grep the generated file for a raw
`"term":"value"` pair, the quotes are escaped.

`node scripts/bench-nom.js` prints the load and scan timings for the committed userscripts (map
evaluation, matcher build, scan speed). It is not part of `make verify` because timings depend on
the machine; run it before and after a performance change. `test/nom-match-equivalence.test.js`
keeps the matcher honest by running it against a frozen copy of the previous character-trie
engine (`test/support/reference-nom-match.js`) — leave that copy alone.

## Known site compatibility limitations

- **Trusted Types CSP (fixed).** Sites that enforce a Trusted Types Content Security Policy
  (YouTube among them) throw an uncaught `TypeError: ... requires 'TrustedHTML' assignment` on a
  plain `element.innerHTML = string` assignment. That exception used to abort
  `mainListener` in `popupdict.runtime.js` before `popup.show()` ran, so the popup looked
  "impossible to show" on those sites even though word/context detection worked fine. Fixed via
  the `zooSetHTML()` helper (feature-detects `window.trustedTypes` and wraps the string through a
  policy), applied everywhere both `popupdict.runtime.js` and `popupdict-local.runtime.js` used
  to assign `innerHTML` directly.
- **Chữ Nôm ruby glyphs invisible on some sites (fixed for -local, open for the committed
  build).** `nom-ruby.runtime.js` builds its `<ruby>`/`<rt>` annotations with
  `createElement`/`textContent`, so it is unaffected by Trusted Types. But its `@font-face` for
  "Zoopdog Nom Na Tong" loads from a GitHub Releases URL, and on a site whose CSP restricts
  `font-src` (e.g. YouTube) that fetch fails (`document.fonts` reports `status: "error"` for it).
  The browser then falls back to `sans-serif`, which has no glyphs for most of the rare CJK
  Extension B/C code points Nom readings use, so the annotation exists in the DOM (confirmed
  correct `<rt>` markup and CSS) but paints as nothing. The committed build still loads from
  GitHub (keeping it small); the `-local` build instead embeds the whole font as a `data:` URI,
  which no `font-src` directive can block since there is no network fetch to intercept. Place the
  font at `zd-extension/db_src/fonts/NomNaTong-Regular.otf` (gitignored, ~10MB) before running
  `make rebuild-nom-userscript --local-only` -- `nomFontSrcFor()` in
  `scripts/build-nom-userscript.js` falls back to the GitHub URL if that file is absent, so
  forgetting it degrades gracefully rather than breaking the build.
- **A foreign overlay can block hover word-detection entirely (fixed).** A video-caption
  translation widget (Eudict/欧路翻译, Immersive Translate, Dualsub) injects its own overlay
  element over the player. When it has no text of its own and sits far enough from the real
  caption text in the DOM (a sibling subtree under a shared ancestor more than
  `ZD_TEXT_SEARCH_MAX_LEVELS` away, not a close wrapper), `elementFromPoint`/`caretRangeFromPoint`
  name the empty overlay and climbing its ancestors never reaches the real text, so
  `getWordAndContext` reported no word at all under the pointer. Fixed in `zd-words.js` by
  falling back to a `document.body`-wide search (a guaranteed shared ancestor) once the ancestor
  climb is exhausted; `zdTextNodeAtPoint`'s own bounding-box pruning keeps this bounded to what is
  actually painted at that pixel rather than walking the whole page.

## Rebuilding the browser runtime dictionary

```sh
make rebuild-extension-vnedict-json
```

This writes both `zd-extension/js/vnedict.json` and its deterministic revision sidecar
`zd-extension/js/vnedict.meta.json`. Both are gitignored build output (like the userscripts):
run this once after cloning, before loading the unpacked extension. `make release-userscripts`
rebuilds them and attaches them to the GitHub Release. The extension and website compare the sidecar revision with IndexedDB before serving lookups.

## Rebuilding the legacy base dictionary

```sh
make rebuild-extension-dict
```

Regenerates `zd-extension/db_src/vnedict.json` from `zd-extension/db_src/vnedict.txt`. This is
a committed, diffable intermediate, not a runtime artifact -- see
[docs/dictionary-data.md](dictionary-data.md) for how it relates to the runtime dictionary above.

## Packaging the extension distributable

`zd-extension.zip` is a tracked, generated artifact: the reproducible ZIP distributable of
`zd-extension/`, owned by `scripts/lib/extension-package/` and `scripts/build-extension-package.js`.
It is not created by zipping the directory by hand -- that used to be how it went stale (it
tracked a 2017 Manifest V2 build long after the unpacked source moved to Manifest V3).

```sh
make rebuild-extension-package   # rebuilds js/vnedict.json first, then publishes the ZIP
make verify-extension-package    # verifies the tracked ZIP without mutating it or the checkout
```

`verify-extension-package` runs as part of `make verify`.

### What ships

`scripts/lib/extension-package/inventory.js` is the reviewed, hand-maintained list of every
file that ships: `STATIC_ENTRIES` (reachable by following `zd-extension/manifest.json` fields,
then `<script src>`/`<link href>` in the HTML pages they name, then `url(...)` in the CSS those
pages load) and `DYNAMIC_ENTRIES` (loaded at runtime via `chrome.runtime.getURL(...)`/
`importScripts(...)` in `js/background.js`, which static reference scanning cannot infer).
`js/vnedict.json` and `js/vnedict.meta.json` are further generated by
`make rebuild-extension-vnedict-json` and gitignored, so they must exist and be current before
packaging -- `rebuild-extension-package` rebuilds them first.

Building independently re-derives the same file set from the current manifest/HTML/CSS and
fails with `inventory_drift` if the two disagree, so a change to what the manifest or a page
references forces a reviewed edit to `inventory.js` in the same change -- update that file
whenever you add, remove, or rewire a reference to a runtime file.

Excluded by omission: `zd-extension/db_src/**` (dictionary sources and the hand-maintained
Chữ Nôm store), `*.jade`/`*.styl` sources, `icon.png`/`icon/zoopdog.png`/`icon/zoopdog.ai`
(unused by the manifest), and OS metadata (`.DS_Store`, `__MACOSX/`) -- none of these are ever
discovered by reference scanning, so they are simply never part of the plan.

### Reproducibility contract

Archive entries are STORE-only (no compression), path-sorted, use a fixed 1980-01-01 00:00:00
DOS timestamp and fixed Unix `0644` external attributes, and carry no extra fields or comments
-- this is deterministic on any supported Node version (only `node:fs`/`node:zlib`'s CRC-32 math
would matter for reproducibility across compression settings, and compression is never used).
Two independent builds from the same source tree produce byte-identical ZIP bytes, confirmed by
comparing SHA-256. Supported Node versions are whatever `make verify` runs under in CI/locally;
the format itself has no Node-version-sensitive degrees of freedom.

### Output contract

Default output is one line of compact `key=value` diagnostics to stdout on success
(`action=build|verify archive=... manifestVersion=... version=... entryCount=... byteCount=... sha256=...`)
or to stderr on failure (`error=<code> message="..."`, one `problem=<code> path=... message="..."`
line per verification failure). `--json` emits one `{"schema": "zoopdog.extension-package/1", ...}`
object instead, to the same streams. Exit codes: `0` success, `2` usage, `3` configuration
(inventory drift, a missing reference, a missing dynamic resource, an unsupported
`manifest_version`), `4` integrity (stale manifest, unexpected/duplicate/traversal path, symlink
entry, corrupt CRC/size, non-reproducible metadata), `5` I/O (archive unreadable, publish
failed).

### Publishing safety

`rebuild-extension-package` is atomic: it builds the full archive in memory, then writes it to a
temporary file next to the target and renames it into place. Any failure in planning, reference
validation, ZIP encoding, or the rename itself leaves the previously tracked `zd-extension.zip`
completely untouched. `verify-extension-package` only reads: it never rewrites the tracked file,
even when it finds drift.

### Release checklist

1. `make rebuild-extension-package` after any change to `zd-extension/` (manifest, pages,
   styles, runtime scripts, or the dictionary/userscript pipeline that feeds `js/vnedict.json`).
2. `make verify` (runs `verify-extension-package`, which fails the build on drift).
3. Commit the regenerated `zd-extension.zip` alongside the source change that caused it.
4. Load `zd-extension/` (or the unzipped archive) as an unpacked extension in Chrome and smoke
   test per "Manual verification" below before publishing to the Chrome Web Store.

### Rollback

`git checkout -- zd-extension.zip` restores the previously committed archive; there is no
migrated state to undo. To remove the verification gate entirely, revert the `Makefile`'s
`verify-extension-package` target and its `verify:` prerequisite in the same commit as
restoring the ZIP -- this is a single scoped revert, not a data migration.

## Manual verification

Website changes:

- Open the affected root HTML file directly in a browser.
- Check hover popup behaviour on `popupdict.html`.
- Check pronunciation and homophone output on `pronunciation.html`, `homophones.html`, and
  `pronguide.html` when relevant.

Extension changes:

- Open Chrome extension management and load `zd-extension/` as an unpacked extension.
- Verify install/update initializes IndexedDB from `zd-extension/js/vnedict.json`.
- Test popup lookup on a normal webpage, global enable/disable, the lock toggle, and dialect
  selection when affected.

Userscript changes:

- Install the rebuilt userscript and verify word detection and popup lookup on a normal page.
