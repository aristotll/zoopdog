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
  a katakana reading above it and the Jyutping under it (nested ruby); katakana words get English.
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
