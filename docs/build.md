# Build and Verification

Use Node 24 (see `.nvmrc`) and run `npm ci`. The lockfile pins esbuild, Pug, Stylus, TypeScript, `@types/node`, ESLint and `globals`; all
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
files are excluded) and type-checks the modules listed in `tsconfig.json` from their JSDoc
(`make check-types`) and lints for bugs (`make lint`). It never retries a failed
test or writes generated artifacts to the checkout. The
direct command below is useful during development, but may use or refresh shared artifacts:

```sh
node --test test/*.test.js
```

## Fast tests and browser smoke

```sh
make test-fast      # about 15 s instead of ~40 s, in place
make browser-smoke  # real Chromium, needs Playwright
```

`make test-fast` (`scripts/test-fast.js`) runs, directly in the checkout, every `test/*.test.js` that
needs no built artifact: no temporary copy, no rebuild, nothing written to `zd-extension/db_src/`.
A file is left out when it uses the `ensure-built` / `real-build-copy` helpers or names a built
userscript or the built runtime dictionary from `scripts/lib/paths.js`; the skipped files are
listed when it finishes. It is a development shortcut and does not replace `make verify`, which
still builds from a clean snapshot and also minifies and checks the generated pages. It was
checked against a checkout with no build output at all (a copy of the tracked files).

`make browser-smoke` (`scripts/browser-smoke.js`) serves the repository on a throwaway local port
and drives Chromium through Playwright: the website pages load without uncaught errors,
`popupdict.html` reaches a ready dictionary status and shows its popup frame on hover, and the
public popup and nom-ruby userscripts (rendered in memory with a stub dictionary, loaded as plain
scripts with a `GM_addStyle` shim) show the popup on hover, build no UI before the first hover or
in a 10x10 iframe, and annotate text, including text added later. Playwright is not a dependency
of this repository: the script resolves a globally or CI-installed copy, prints "skipped" and
exits 0 without one, and fails instead with `make browser-smoke REQUIRE=1`. It writes only the
gitignored runtime dictionary files (as `make rebuild-extension-vnedict-json` does). CI runs it as a
separate `browser-smoke` job with `continue-on-error`, so it does not block merges yet. Console
errors about fonts blocked by CORS from the sandboxed popup frame are ignored: they come from
serving locally.

`make browser-perf` (`scripts/browser-perf.js`) measures the built userscripts in the same real
Chromium: script evaluation time, the longest long task, total main-thread task time and JS heap
after a forced GC for the popup userscript on a plain page and on a page with five same-origin
iframes (at load, on a first hover, and on a first hover after the pointer idled so the idle
pre-warm could run), and, for nom-ruby, the longest long task, the longest main-thread gap and the
time until the annotation stops changing on a generated 3,000-paragraph Vietnamese page. The header
of the script says exactly how each number is taken. It prints a table (median and range over
`--runs`, default 3) or `--json`, resolves Playwright like `browser-smoke` ("skipped" without it),
builds a missing root userscript with the real builder, serves its pages from memory and writes
nothing into the repository. Pass other builds as arguments to compare two commits:

```sh
git worktree add --detach /tmp/before <commit>
ln -s "$PWD/node_modules" /tmp/before/node_modules
(cd /tmp/before && node scripts/build-popupdict-userscript.js && node scripts/build-nom-userscript.js)
make browser-perf ARGS='/tmp/before/zoopdog-popupdict.user.js /tmp/before/zoopdog-nom-ruby.user.js --json'
rm /tmp/before/node_modules && git worktree remove --force /tmp/before
```

Timings depend on the machine and Chromium build; compare numbers taken on one machine in one
session. It is not part of `make verify`. The results of the phase 1 and 2 changes are recorded in
[the performance plan](performance-and-maintainability-review-2026-11.md) (section 9).

`node scripts/bench-nom.js --json` prints the benchmark numbers as one JSON object.

## Linting

```sh
make lint
```

ESLint (`eslint.config.js`) runs only bug-catching rules from `scripts/lib/lint-config.js`
(`no-undef`, `no-redeclare`, `no-dupe-keys`, `no-unreachable`, `no-fallthrough`, ... and
`no-unused-vars`, all errors); there are no formatting rules. It covers `scripts/`, `test/` and
the standalone browser files in `js/` and `zd-extension/js/`. Those classic scripts share one global
scope, so each file's cross-file globals (`zdPopupProtocol`, `getWordAndContext`, ...) are declared
explicitly in `eslint.config.js`; add a name there when a file starts using another file's global.

The userscript runtimes in `scripts/userscript/` are fragments of one IIFE, so they are not linted
one by one. `scripts/lint-userscripts.js` renders every built userscript (public and `-local`) in
memory with a tiny stub dictionary and lints each as a whole program with browser and
Greasemonkey globals, which checks the shared IIFE scope for undeclared names and duplicate
declarations. It writes nothing and needs no prior build.

## Compiling sources

Root pages are authored in `*.pug` and committed as matching `*.html`; root styles are
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

The frame page retains its pretty output; the other pages are compact. The templates use the `.pug`
extension (they were `.jade`, which Pug deprecated and warned about on every include); the generated
`.html` is byte-identical across that rename. Always edit sources before generated files.

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

The builders embed `NOM_MAP`, `CASE_SENSITIVE_NOM_MAP` and `ZOO_DICTIONARY` as JSON text in string
variables (`NOM_MAP_JSON`, `CASE_SENSITIVE_NOM_MAP_JSON`, `ZOO_DICTIONARY_JSON`; `jsonStringLiteral`
in `scripts/lib/userscript.js`), and the runtime parses them on first use: the dictionary on the
first lookup, the Nom maps (and the matcher built from them) on the first text node that holds a
word character. V8 parses JSON text about twice as fast as the same data written as an object
literal (≈140 ms vs ≈275 ms for the popup dictionary), and a page that never needs the data never
pays for it. To keep that parse out of the user's first hover, the popup queues one idle parse
(`requestIdleCallback`, 2 s timeout; a 200 ms `setTimeout` without it) on the first pointer activity in
a started frame (`zooSchedulePrewarm`); a lookup that comes first parses as before and the pre-warm is
then a no-op, and frames that see no pointer, or are too small to start, still never parse. The runtime templates keep their `{"__ZOOPDOG_*__": true}` placeholders, so a test
can still render one with a JSON string literal. `scripts/lib/userscript.js`'s `extractAssignedJson`
reads the maps back (pass the name without `_JSON`) and understands both forms — never grep the
generated file for a raw `"term":"value"` pair, the quotes are escaped.

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

## CJK Ruby userscript (Jyutping + katakana)

`scripts/userscript/cjk-ruby.runtime.js` is the source; `make rebuild-cjk-ruby-userscript` writes
`zoopdog-cjk-ruby.user.js` (release, minified into `dist/`) and the gitignored
`zoopdog-cjk-ruby-local.user.js` (`… (Local)`, `file://` update URL). It replaces the separate Inject
Jyutping and Katakana Terminator scripts, which fought over the same text: one DOM pass, one `<ruby>`
per word. Han words get Jyutping (to-jyutping); on Japanese text (`lang="ja"` or a text node with kana)
a kanji word also gets a katakana reading above it (Google Translate's public key-less `rm`
transliteration, converted from romaji) with the Jyutping under it (nested ruby); katakana words get
their English original. Text inside any other `<ruby>`/`<rt>` (e.g. zoopdog-nom-ruby's Nom reading) is
never touched, and an `data-last-hover`/`data-last-error` beacon on the popup helps diagnose hover problems.

## Non-local Nôm review selection controls

The published popup userscript shows a review toolbar for short text selections (up to
60 characters / 8 words). The × button closes it and clears the native selection; Escape
also closes it. The − / ＋ control switches between a wrapped label and a compact label.
Controls have touch-sized targets and stay inside the visual viewport. Scrolling or resizing
hides the toolbar; selecting text again shows it. Clicking or tapping elsewhere dismisses
an existing toolbar without reading an unbounded page selection.

Selection checks bound both element and text-node traversal before materializing selected
text. Context capture is bounded too. A storage failure leaves the save button available to
retry instead of displaying a successful save. These controls do not change local-mode
reader endpoints or its separate entry/order forms.
