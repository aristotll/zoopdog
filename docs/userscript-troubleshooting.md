# Userscript troubleshooting notes (popup dictionary, CJK ruby)

What we learned diagnosing "the Zoopdog popup is not displayed" on pages that were machine-translated
(yahoo.co.jp, qiita.com translated to Vietnamese by Immersive Translate / Trancy) and the conflicts
between the Jyutping and Katakana Terminator scripts. Read this before chasing the same symptoms.

## 1. The popup that "worked, but nothing showed" (fixed)

**Symptom.** On a page translated in the browser the popup never appeared. Hover events arrived
(capture, `window` and `document` listeners all saw them), no error was logged, yet
`#zoopdog-userscript-popup` stayed hidden and its `data-last-hover` froze while the pointer moved.
After a reload (page not yet translated) the very same build worked.

**Cause.** A translation extension rebuilds / clones nodes under `<body>` after the userscript ran.
The script kept drawing into its original popup and canvas elements, which were no longer in the
document; the page held a look-alike clone with the same id and the old attributes. Every hover
"succeeded" against a detached element, so nothing was ever painted.

**Fix** (`scripts/userscript/popupdict.runtime.js`, `ensureAttached`). At the start of every hover the
script checks `isConnected` for the canvas and the popup; if either is detached it removes any
look-alike with the same id and re-appends the original to the current `document.body`, counting it in
`data-reattached`. Confirmed working on the translated yahoo.co.jp page.

**Rule.** Anything a userscript injects into a page it does not own can be detached, cloned or
replaced later. Re-check `isConnected` at the moment of use instead of trusting a reference taken at
startup.

## 2. Other causes found on the way (all real, all different)

| Symptom | Cause | Where fixed |
| --- | --- | --- |
| Hover found the Han character of a Nom reading instead of the Vietnamese word (`noword`) | The new Katakana Terminator wrapped Han text *inside* nom-ruby's `<rt>` in its own `<ruby>`. Mutation records hand over nodes from anywhere, and the exclusion only looked at the node's own tag, not its ancestors | `EXCLUDED_SELECTOR` + `closest()` on the parent (now `cjk-ruby.runtime.js`) |
| Jyutping labels hid the katakana English annotation, or vice versa | Two scripts rewrote the same text nodes; each skips `<ruby>`, so whoever ran first won | Merged into one script, `cjk-ruby.runtime.js` |
| Annotations overlapped between lines | Pages use `line-height` ~1.6; a word with an over- *and* under-annotation, plus Nom `<rt>`, does not fit | `*:has(> ruby.zd-cjk-ruby) { line-height: 2.7 !important }` |
| Popup shown nowhere on a translated page while another extension's popup (Tenten) did | Different extensions; do not assume the one you debug is the one failing | n/a |

## 3. The CJK Ruby script (replaces Inject Jyutping and Katakana Terminator)

`scripts/userscript/cjk-ruby.runtime.js`, built by `scripts/build-cjk-ruby-userscript.js` into the
release build (`zoopdog-cjk-ruby.user.js`, minified into `dist/`) and a gitignored `(Local)` build, like
nom-ruby and the popup (see `docs/build.md`).

- One DOM pass, one `<ruby>` per word. Han words get Jyutping (to-jyutping, Worker with a main-thread
  fallback); on Japanese text (`lang="ja"` or a text node already holding kana) the kanji word also gets
  a katakana reading above it and the Jyutping under it (nested ruby; a single two-line `<rt>` was tried and
  reverted: too tall on phones); katakana words get English.
- Readings and English: Google Translate's public key-less `translate_a/single`. The reading is the
  `dt=rm` (romanization) block; several words are sent joined by ` | ` because Google returns ONE
  romanization block per request. Romaji is converted to katakana locally (long vowels become `ー`).
- Fault tolerance: request deadlines, endpoint cool-down (not permanent removal), per-phrase retry
  back-off, batches that cannot be aligned are split in halves, `fetch` when `GM_xmlhttpRequest` is
  missing, a text-labels fallback when `::before` is unusable, open shadow roots, an idempotent re-run.
- Known limits: kanji readings are guessed without context (開催中 reads `Kaisai Naka`), Chinese-only
  characters read oddly under `sl=ja`, and okurigana are a heuristic (kanji plus up to two hiragana,
  a particle-looking hiragana is not taken).

## 4. Diagnosis techniques that paid off

- **CDP bridge:** use `~/mine/book-translator/.claude/tools/cdp-bridge-common.md` for the
  current bridge API and CLI. The CLI is at `~/mine/book-translator/.claude/tools/cdp_session_tool.py`;
  attach to an existing tab by URL using the CLI `ensure` command with `--session-name` and
  `--url-substring`. Follow the bridge documentation before operating the user's tab.
  `cdp_session_tool.py help <command>` prints one command's flags and an example; a result too long to print is stored and read back with `show <handle>`. `run` executes several commands in one call, `probe-control <url> --click <selector>` performs the browser check that must precede a "blocked" verdict, and `recall <host>` prints what an earlier session recorded about a site. After `make install-cdp` in book-translator, the same CLI is `cdp <command>` from this repository too.

- **Leave evidence in the DOM.** A userscript's console lives in an isolated world the CDP bridge
  cannot see; a `data-*` attribute on a page element can be read from anywhere. The popup writes
  `data-last-hover` (why the last hover stopped: `locked`, `excluded`, `nopoint`, `noword`,
  `notcontained`, `same`, `nolookup`, `shown`, with caret / word / context detail) and
  `data-last-error` (a hover that threw). Reading them was what turned guessing into steps.
- **Compare two copies.** Run the same build in the page world (as a second instance) next to the
  installed one: if the page-world copy works and the installed one does not, the problem is the
  environment (realm, detached nodes), not the logic.
- **Check what the browser really holds.** Listener presence and line numbers
  (`DOMDebugger.getEventListeners` on `window`) proved the installed copy was the new build.
- **Test on a clean page.** `cdp_session_tool.py open <url> --profile empty` gives a tab with no other
  userscripts or extensions, so conflicts from other scripts are ruled out.
- **Screenshots are scaled.** A 1500px-wide screenshot of a 1152px viewport is 1.30x; convert before
  turning an image position into a mouse coordinate. Use `elementFromPoint` to confirm what is under it.
- **The bridge rejects big bodies.** `/eval` fails with `Broken pipe` above roughly 60 KB. To inject a
  multi-megabyte build push it in ~30 KB chunks into `window.__c` and `(0,eval)(window.__c.join(''))`.
- **A reload resets the situation.** Translators run after load; a reload through CDP often does not
  re-trigger them, and key presses through CDP do not reach extension shortcuts. When the bug only
  exists on the translated page, ask the user to translate the tab and report.
- **Do not click floating widgets on a live page.** One CDP click landed on an ad and navigated the
  user's tab away.

## 5. Process lessons

- When a symptom survives a fix, add observability first, then fix; three of our "fixes" were real bugs
  but not the one the user was seeing.
- Do not conclude "works" from a synthetic div: the failing state needs the real page after the
  translator ran.
- A userscript manager only picks up a rebuilt Local file when it re-checks it; always tell the user to
  update the script and reload before testing a change, and confirm the new build is the one running.

## 6. Two renderers: `ruby` (default) and `overlay`

Every ruby problem above came from one fact: the script inserts `<ruby>` into the page's own text, so it
shares that text with page CSS, the engine's ruby layout, translators and other scripts. The script is
therefore split into a shared core and two renderers; a site picks one.

- **Core (shared):** `findMatch` (what is annotatable, and which kinds of label), the label queue
  (`queue` / `labels` / `translatePending`: Google, to-jyutping, retries), the mutation observer.
  A label destination is a *sink*: an `<rt>` element, or an overlay sink object with `setLabel`.
- **`ruby`:** wraps each word in `<ruby>` (plus `hoistForeign`, which moves translator output out of it).
- **`overlay`:** never touches the DOM. Words are tracked as `{node, start, text}` records; labels are drawn
  in a fixed, click-through, closed-shadow layer (`#zoopdog-cjk-overlay`) from `Range.getClientRects()`.
  One syllable is placed over each hanzi; a label that would collide is lifted by a line (up to two)
  and then dropped; labels are clamped inside the viewport. Layout runs on scroll/resize, on every scan
  and from a timer (hidden tabs pause animation frames). The layer is re-appended if a page removes it.
- **Choice:** ruby everywhere. `MODE_RULES` (empty now) can force `overlay` for a host; the userscript menu command
  switches the current host between `ruby` and `overlay` (stored in `localStorage` as
  `zoopdogCjkRubyMode:<host>`, then reload). `<html data-zoopdog-cjk-ruby-mode>` shows the active renderer and
  `data-zoopdog-cjk-overlay` shows `labels= records= dropped= pending=`.
- **Per-site fixes (`SITE_FIXES`):** a fix names its hosts and only applies there: `css` (extra rules) and
  `maxRun` (split long Han runs into words of at most N characters so a wide label cannot push a line past its
  container). hupu.com: un-clamps the 48px title box (a fixed height + `-webkit-line-clamp` clipped the second
  line once the ruby line-height grew) and `maxRun: 3`. Reddit needed no fix once the `<wbr>` and nested-ruby
  fixes were in (measured: no overflow, no overlapping labels in ruby mode).
- **A "tap/long-press to reveal" mode was tried and removed:** it hid the problem instead of fixing it.
- **Measuring overlap without screenshots:** take every `rt` fragment (`getClientRects`, a ruby that wraps has
  several; the union rect lies), shrink each to font-size*1.15 around its centre (the `rt` box includes
  half-leading), and intersect with the text-node line rects of text outside that ruby. Sticky headers
  produce false positives when scrolled.
- **Trade-offs of overlay:** labels are not selectable or searchable text; a line with no room above it gets
  lifted labels that can sit over the previous line; many records cost a layout pass per scroll frame.
- **Bug worth remembering:** callbacks created in a `while` loop closed over a `var rec`, so every label
  landed on the LAST word of a text node. Create per-item state in a function of its own.
- **Do not "fix" `ruby-align`:** `space-around` spreads the base characters so each syllable sits over its
  hanzi; `center` broke exactly that on v2ex.

## 7. Shared overlay engine, nom overlay on Zhihu, and Reddit's flat ruby

- **`scripts/userscript/overlay-labels.js`** is the one overlay engine (`zdCreateOverlay`). Both builders inline it
  (`__ZOOPDOG_OVERLAY_LABELS__`) into `cjk-ruby.runtime.js` and `nom-ruby.runtime.js`. A record is a word of a text
  node plus drawing layers (`over`/`under`, per-syllable pieces, colour/font); the engine owns the fixed
  click-through layer, culling, collision lifting, re-attaching the layer, and scroll/resize relayout.
- **Nom ruby has the same two renderers.** `ruby` (default) wraps words; `overlay` matches exactly as before
  (`nomMatcher`), but each match becomes a record: a reading with one character per word puts one character over each
  word (`wordSpans`), any other shape sits over the whole match. Matches that span two text nodes are not drawn in
  overlay mode. `MODE_RULES` in `nom-ruby.runtime.js` puts zhihu.com on `overlay`; the menu command switches a host
  (`localStorage` key `zoopdogNomMode:<host>`); `<html data-zoopdog-nom-mode>` and `data-zoopdog-nom-overlay` are
  the beacons. Verified live on vi.wikipedia.org: 17k records tracked, ~400-500 labels drawn, no `<ruby>` inserted,
  labels follow scrolling.
- On Zhihu the Nom overlay is anchored to document coordinates, so the browser scrolls labels with ordinary
  page text even before the next layout pass. Nested scrollers and fixed elements still need scroll relayout.
- **Reddit's "flat" ruby (some previews only).** `shreddit-post .feed-card-text-preview :not(ol,ul,li,h1) {
  all: revert; display: inline !important; ... }` flattens every descendant, `<ruby>`/`<rt>` included, so the reading
  is drawn inline after the word. Found by disabling the page's stylesheets one at a time until the ruby's computed
  `display` changed (only one sheet did), then fetching that sheet's text and grepping for the class seen in the
  element's ancestor chain (cross-origin sheets cannot be read through `cssRules`). Fix, per site in `SITE_FIXES` of
  both scripts: `:root:root ruby.<ours> { display: ruby !important }` and the same for the `rt`
  (`display: ruby-text`); `:root:root` raises specificity above Reddit's (0,2,2) without touching other sites.
  The nested reading ruby of cjk-ruby got a class (`zd-cjk-inner`) for the same reason.
- **Debug recipe for "my CSS has no effect":** `getComputedStyle(el).display` before/after
  `styleSheet.disabled = true` per sheet names the culprit sheet; `!important` in a page rule means yours needs
  `!important` plus higher specificity.
- **Orphaned Jyutping on translated pages (translated listing pages).** Immersive Translate wraps the *word itself* inside our
  `<ruby>` in a `<font>`. `hoistForeign` took that wrapper for a translation and moved it out, leaving an empty
  ruby holding only the under-reading, so the Jyutping floated away from its kanji (704 of 938 rubies on one such page).
  Fix: the first non-`rt` child of a ruby is the word and is never hoisted. Symptom check: a `ruby.zd-cjk-ruby`
  whose only child is an `rt` (with `data-zd-hoisted`). Not verified live against a translator: the installed
  copy of the script also acts on the tab, so a clean A/B needs it disabled.
- **Nom over unequal-width phrases.** `SITE_FIXES.perWord` (nom-ruby) makes one `<ruby>` per word when the
  reading has one character per word, so each character sits over its word.
- **Private site rules are not in this repo.** `SITE_FIXES` / `MODE_RULES` entries for such hosts live in
  `../book-translator/zoopdog-site-rules.json` (or `$ZOOPDOG_LOCAL_SITE_RULES`) and are injected at build time into the
  `(Local)` builds only (`readLocalSiteRules`, placeholder `__ZOOPDOG_LOCAL_SITE_RULES__`); the published builds get `[]`.
  Rule: `{"host": "<regex>", "scripts": ["nom-ruby","cjk-ruby"], "css", "maxRun", "perWord", "mode"}`.
