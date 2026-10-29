# Build and Verification

Use Node 24 (see `.nvmrc`) and run `npm ci`. The lockfile pins esbuild, Pug, Stylus and TypeScript; all
are development dependencies, and the shipped website has no runtime npm dependency.

## Quickstart

```sh
npm ci
make verify
make rebuild-extension-vnedict-json
python3 -m http.server 8000
```

Open `http://localhost:8000/popupdict.html`. Installing dependencies requires npm registry
access; the build and verification need no credentials or network after installation. Optional
local-mode reader integration requires a separately running `book-translator` service; see
[local mode](local-mode.md). Publishing a release requires authenticated GitHub access.

## Verification

```sh
make verify
```

`make verify` copies current inputs to a temporary directory unique to the run, builds its
userscripts and dictionary there, runs every suite under `test/`, minifies the userscripts and
checks generated page/style drift in that same temporary directory. It also syntax-checks
first-party JavaScript under `scripts/`, `js/`, and `zd-extension/js/` (third-party `lib/`
files are excluded) and checks the JSDoc types of the review store. It never retries a failed
test or writes generated artifacts to the checkout. The
direct command below is useful during development, but may use or refresh shared artifacts:

```sh
node --test test/*.test.js
```

## Compiling sources

Root pages are authored in `*.jade` and committed as matching `*.html`; root styles are
authored in `css/*.styl` and committed as matching `css/*.css`. `zd-extension/` pages and
styles (the sandboxed popup frame the website embeds) follow the same pattern.

Build all pages and styles using the repository-pinned compilers:

```sh
make build-pages build-styles
```

Check committed outputs without modifying them:

```sh
make check-generated
```

The frame page retains its pretty output; the other pages are compact. Pug emits deprecation
warnings for the existing `.jade` include names. Always edit sources before generated files.

## Rebuilding the userscripts

```sh
make rebuild-userscripts
```

See [dictionary-data.md](dictionary-data.md) for what each userscript embeds and when a
rebuild is required. The builders also stamp `@version`.

The github-hosted `zoopdog-*.user.js` are gitignored build output, not committed. Publishing:

```sh
npm ci                      # install pinned build dependencies
make release-userscripts    # rebuild, minify into dist/, gh release create (DRY_RUN=1 to preview)
```

`make minify-userscripts` writes the esbuild-minified copies to `dist/` (metadata block kept
verbatim; the `-local` builds are not minified). `release-userscripts` needs the GitHub CLI
(`gh`) and uploads them as assets of a new release; `@updateURL`/`@downloadURL` point at
`releases/latest/download/<name>`, so a new release is what makes installed copies auto-update.
Development builds still use the previous local file for their stamp. Release preflight instead
reads both userscript versions from one latest GitHub Release, stamps the minified release
assets with a version newer than both, and checks that the latest tag has not changed before
publishing. This requires an authenticated `gh` and access to the previous release even for a
dry run. `RELEASE_VERSION=2026.10.28.2 make release-userscripts` selects an explicit newer
numeric version; otherwise a date-based version is chosen automatically. A missing or
unreadable prior release is an error, not permission to guess. A dry run builds and stamps
gitignored output but does not publish it. Before the build, the release target captures input
hashes; preflight fails if inputs changed during the build. Its manifest records the commit,
Node/compiler versions, input and output hashes, release versions, and whether optional
chunom/font inputs were present. It is checked again before publishing and included as an asset.

Each builder writes two gitignored files: the release `zoopdog-*.user.js` (updates from GitHub, as
above) and a `zoopdog-*-local.user.js` that updates from its own `file://` path on
this machine instead — for `zoopdog-popupdict-local.user.js` that also means it is the only
build carrying the local Chữ Nôm add/edit ability (see
[local-mode.md](local-mode.md)). See `.gitignore` for the `-local` filenames.

### Embedded data format and load cost

The builders embed `NOM_MAP`, `CASE_SENSITIVE_NOM_MAP` and `ZOO_DICTIONARY` as
`JSON.parse("...")` string literals (`jsonParseLiteral` in `scripts/lib/userscript.js`), not object
literals: V8 parses the same data about twice as fast that way (≈140 ms vs ≈275 ms for the popup
dictionary). The runtime templates keep their `{"__ZOOPDOG_*__": true}` placeholders, so a test can
still render one with a plain object. `scripts/lib/userscript.js`'s `extractAssignedJson` reads
the maps back and understands both forms — never grep the generated file for a raw
`"term":"value"` pair, the quotes are escaped.

`node scripts/bench-nom.js` prints the load and scan timings for the built userscripts (map
evaluation, matcher build, scan speed). It is not part of `make verify` because timings depend on
the machine; run it before and after a performance change. `test/nom-match-equivalence.test.js`
keeps the matcher honest by running it against a frozen copy of the previous character-trie
engine (`test/support/reference-nom-match.js`) — leave that copy alone.

## Known site compatibility limitations

- **Trusted Types CSP.** Sites that enforce a Trusted Types Content Security Policy
  (YouTube among them) throw an uncaught `TypeError: ... requires 'TrustedHTML' assignment` on a
  plain `element.innerHTML = string` assignment. That exception used to abort
  `mainListener` in `popupdict.runtime.js` before `popup.show()` ran, so the popup looked
  "impossible to show" on those sites even though word/context detection worked fine. Fixed via
  the `zooSetHTML()` helper (feature-detects `window.trustedTypes` and wraps the string through a
  policy), applied everywhere both `popupdict.runtime.js` and `popupdict-local.runtime.js` used
  to assign `innerHTML` directly. When the site forbids creation of the
  `zoopdog-userscript` policy, the helper builds the escaped internal templates using DOM
  methods and a restricted tag and attribute set. A local browser smoke test covered both
  an allowed policy and `trusted-types 'none'`; userscript-manager behavior under these
  policies has not yet been verified.
- **Chữ Nôm ruby glyphs invisible on some sites (fixed for -local, open for the committed
  build).** `nom-ruby.runtime.js` builds its `<ruby>`/`<rt>` annotations with
  `createElement`/`textContent`, so it is unaffected by Trusted Types. But its `@font-face` for
  "Zoopdog Nom Na Tong" loads from a GitHub Releases URL, and on a site whose CSP restricts
  `font-src` (e.g. YouTube) that fetch fails (`document.fonts` reports `status: "error"` for it).
  The browser then falls back to `sans-serif`, which has no glyphs for most of the rare CJK
  Extension B/C code points Nom readings use, so the annotation exists in the DOM (confirmed
  correct `<rt>` markup and CSS) but paints as nothing. The committed build still loads from
  GitHub (keeping it small); the `-local` build instead embeds the whole font as a `data:` URI,
  which avoids a network fetch but still depends on the site's CSP allowing data fonts. Place the
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

The website stores the pinned popup position in `localStorage`, scoped to its origin; a legacy
host can inject a position-storage adapter. If storage is unavailable, pinning still works for
the current page without persistence.

## Rebuilding the browser runtime dictionary

```sh
make rebuild-extension-vnedict-json
```

This writes the legacy `zd-extension/js/vnedict.json`, the revision sidecar
`zd-extension/js/vnedict.meta.json`, and a `vnedict.<sha256>.json` immutable payload. All are
gitignored build output. The builder writes the immutable payload before switching the sidecar;
the website loads the payload named by the sidecar and compares its digest before installing it
when Web Crypto is available. Without Web Crypto, a revision-named payload is checked for
shape and count; a mutable legacy payload is not installed because its revision cannot be
verified. Existing usable data remains available as stale in that case.
Old metadata without a payload name and older website clients continue using `vnedict.json`,
whose update is not atomic with the metadata switch. A current client that detects a mismatch
with old metadata checks once for a newer pointer and retries if it changed; old clients do not
have that recovery. `make release-userscripts` includes all
three current files. Deploy the immutable payload alongside the sidecar and retain previously
deployed revision files: an in-flight reader may still hold the prior sidecar. Do not delete old
payloads while clients or caches may reference them. A release asset set alone contains the
current generation; a static hosting deployment must preserve older revision files itself.

For a static server whose document tree is locally writable, build the runtime dictionary,
then publish to its existing `zd-extension/js` directory with:

```sh
node scripts/publish-runtime-dictionary.js /path/to/site/zd-extension/js
```

The command validates both the new source generation and any existing target pointer,
writes the new immutable payload first and the metadata last, and retains older immutable
payloads. It updates the legacy mutable file as well; old clients may still observe a
temporary mismatch during that update. This is a local filesystem operation, not a remote
upload, and hosts that replace their entire deployment tree must preserve old payloads by
another mechanism.

## Rebuilding the legacy base dictionary

```sh
make rebuild-extension-dict
```

Regenerates `zd-extension/db_src/vnedict.json` from `zd-extension/db_src/vnedict.txt`. This is
a committed, diffable intermediate, not a runtime artifact -- see
[docs/dictionary-data.md](dictionary-data.md) for how it relates to the runtime dictionary above.

## Manual verification

Website changes:

- Open the affected root HTML file directly in a browser.
- Check hover popup behaviour on `popupdict.html`.
- Check pronunciation and homophone output on `pronunciation.html`, `homophones.html`, and
  `pronguide.html` when relevant.

Userscript changes:

- Install the rebuilt userscript and verify word detection and popup lookup on a normal page.
