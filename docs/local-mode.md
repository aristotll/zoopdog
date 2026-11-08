# Local Mode (Popup Dictionary ↔ book-translator Reader Server)

`zoopdog-popupdict.user.js` can talk to a **local HTTP server that lives in a different
repository** — the `book-translator` project's reader/TTS server
(`scripts/reader/tts_server.py` there, started with `--nom-data
<path-to-this-repo>/zd-extension/db_src`). When that server is reachable, the popup gains two
extra actions on every looked-up term: **"+ Add Chữ Nôm"** and **"Set order"**, writing straight
into this repo's `zd-extension/db_src/user_nom_entries/` shard store (128 CSV files, see
`SHARDING.md` in that directory) and `user_nom_order.jsonc` — the same store the reader's own
modals write.

This file only covers the userscript side. The server, its routes, and its Notes-translation
provider chain are documented in the other repository — see the cross-repo pointer at the
bottom.

## Why this exists

The popup dictionary runs on arbitrary third-party pages, hovering over Vietnamese text it
already recognizes. There was previously no way to *add* a term the dictionary didn't already
know, or to pick which of several known Chữ Nôm renderings should lead — those are exactly the
things the reader's own "Add Chữ Nôm entry" / "Set Chữ Nôm order" modals do, but only from
inside a book chapter. Local mode re-hosts the same two modals (suggestions, existing-entry
detection, preview → confirm diff, all of it) against the reader server's API instead, so the
popup can extend the same dictionary from anywhere.

## Where it lives

This ability only ships in the **`-local` build** — `zoopdog-popupdict-local.user.js`, built
from `scripts/userscript/popupdict-local.runtime.js` (search for `ZOO_LOCAL_BASE`) and
`scripts/userscript/popupdict-local.css`. The github-hosted `zoopdog-popupdict.user.js` never
inlines any of it and never asks for the `GM_xmlhttpRequest` / `127.0.0.1` grants it needs — see
"Two builds" below.

`popupdict-local.runtime.js` has no header or IIFE of its own: `scripts/build-popupdict-userscript.js`
concatenates it inside `scripts/userscript/popupdict.runtime.js`'s IIFE (via
`__ZOOPDOG_RUNTIME_SOURCES__`, the same mechanism used for the other inlined browser sources),
so it shares scope with the core runtime. The separately testable `local-transport.js` factory
is inlined ahead of the fragment and receives the userscript manager request function explicitly;
it preserves the same local routes, payloads, timeouts and error responses. The core file calls into it through three
`typeof x === 'function'` guarded call sites (`zooRenderLocalActions`, `zooProbeLocalMode`,
`zooWireSelectionBar`) that are silent no-ops when this fragment isn't built in. Matching styles
are concatenated the same way from `popupdict-local.css` (`zd-local-*`, `zd-modal-*`,
`zd-entry-diff-*`, `zd-selection-bar`, `zd-toast`).

## Resizable Chữ Nôm modals

Both modals ("Add Chữ Nôm", "Set order") are draggable by their heading and resizable by the corner grip
(`zooMakeModalResizable`, CSS `resize: both`). The size is saved on pointer release, only when the user changed
it, under `zd-modal-size:<registrable domain>:<modal id>` (same domain grouping as the saved position, GM storage
when granted, else the page's `localStorage`) and applied by `zooOpenModal`. Mirror of `ReaderShared.modal.makeResizable`
in book-translator, which keeps `modal-size:<host>:<modal id>` in `localStorage`.

## Request recovery on third-party pages

Every local reader-server request has an eight-second client-owned deadline in addition to the
userscript manager's `GM_xmlhttpRequest` timeout. This matters when a manager invalidates its
execution context after sending a request: the reader server may answer, but none of the
manager callbacks reach the popup. The local UI then settles the request itself, restores any
disabled controls, and tells the user to reload the page and try again.

The Nôm entry modal also clears its prior datalist choices, generated Nôm value, and autofill
marker immediately when it opens for a different term or its Vietnamese term is edited. A
slower response for the earlier term is ignored, so suggestions never drift across terms.

The untouched auto-filled Chữ Nôm default is blanked on focus (so the datalist shows every
suggestion) only for keyboard focus. A mouse press keeps the text, and a late suggestion refill
does not blank a pointer-focused field: blanking under the caret left the browser's selection on
the wrong character ("select 糖, delete" removed 蜜).

Save, Preview and Confirm handlers of both modals run through `zooGuard`: while the request is
pending every action button of that modal is disabled (Cancel is not) and a second submit is
ignored, so one press cannot send the same write twice. Mirror of `ReaderShared.modal.guard`.

There is deliberately no automatic retry. A retry from the same invalidated userscript context
can send duplicate server work without producing a usable callback, and it cannot safely reload
or discard a user's unsaved edits. Reloading creates a fresh context under the user's control.

## Google results: explored sites in another colour

On `google.<tld>/search` the `-local` build colours every link to a site book-translator has already explored: green = a
dictionary plugin of `~/mine/online-dict`, yellow = a TTS engine, blue = a translator, purple = only a research note
(`docs/research/*`), grey = listed in book-translator's `docs/explored_sites_blacklist.json` as "no need to explore" (edit
that file; hot reload, no restart).

**The server decides, the userscript reads and paints.** What counts as explored (exact registrable domain, the aliases of
`docs/explored_sites_aliases.json`, same-brand guesses such as `zingnews.vn` ~ `znews.vn` labelled "Probably explored", a
Google-CSE plugin's `searchedSites`, a site *name*) is book-translator's `explored_sites.match_keys`, behind
`GET /v1/explored-sites/match?keys=<json list>` -> `{version, matches: {key: {label, color}}}`. The client has no domain or
name logic: `zooAnchorKeys` turns each link into keys (its direct host, Google's `/url?q=` target, and for an opaque
`/goto?url=` link the hints read off the page by `zooGotoHints`: aria-label, short text, the first lines of the card or
result, the visible `https://host ›` line); `zooPendingKeys` batches the keys not asked yet (each key once, at most 100 per
request); `zooPaintExplored` paints the first key the server matched.

**Painting** (unchanged, measured by screenshot 2026-10-24/25): an organic result (anchor holding an `h3`/`[role=heading]`) gets a
plain background on its result block; a headingless link (AI overview citations, people-also-ask, sitelinks, source cards) is
often a transparent overlay on a chip or card, so it is tinted (`mix-blend-mode: multiply` + a 2 px outline) and a plain fill,
which hid what lay under it, is never used.

**Hot reload and tolerance:** `?keys=[]` doubles as the version probe: the page polls it every minute and a new `version`
(any plugin, engine, research note, alias or blacklist edit) drops the answers and asks again, so nothing needs a reload or
a server restart. The answers are cached in the page's `localStorage` (`zooExploredMatches`) and painted at once; nothing is
asked before the server has answered once; a failed first request is retried after 1.5/3/6/12/24 s (then every minute);
results are repainted on DOM changes, every 2.5 s, and when the tab is shown again; the `/search` check is made at paint time;
links are found under `#search`, `#rso`, `main` or `#main`; one odd result never stops the rest.

**Buttons on Google links** (`scripts/userscript/local-explored-tools.js`), in two forms with the same two buttons. (1) Always present:
every organic result (a link with a title heading), coloured or not, gets them inline right after its title; `decorate` is idempotent and
runs with every repaint, so a result Google re-renders gets them back. (2) Hovering any other link that is not coloured (chips, cards)
shows one small floating pill at its top-right corner (fixed position, outside Google's DOM, no layout shift).
`↻` is a manual retry for the whole page: it asks the server again for the keys (`zooAnchorKeys`) of the clicked link and of every
link still without colour (up to 100), bypassing what was asked or answered before, and colours those explored by now (a toast says how many). `⛔` opens the project-style modal "Blacklist a site: no need to
explore": the site field is pre-filled with the link's own host (editable; the server stores the registrable domain), the reason
defaults to `no search` (editable), and submit sends `POST /v1/explored-sites/blacklist?host=&reason=`, which appends it to
book-translator's `docs/explored_sites_blacklist.json` (hot reload) and answers the finished grey entry; the link is then asked
again and turns grey. The server's own refusal (HTTP 422 `error`) is shown in the modal. The hover pill never appears on a coloured link; the inline buttons stay.
The route is in `test/fixtures/local-mode-contract.json`, identical to book-translator's copy.

Troubleshooting and fixing this feature (a link not coloured, a visual regression): follow book-translator's
`.claude/ai-common/rules/google-explored-highlighter.md` (matching stays on the server, verify on the real page with a screenshot,
never overwrite uncommitted work in this repo).

## Two builds

`scripts/build-nom-userscript.js` and `scripts/build-popupdict-userscript.js` each write two
files per run: the github-hosted `.user.js` (unchanged name, `@updateURL`/`@downloadURL` point
at GitHub Release assets) and a `-local.user.js` variant whose `@name` gets a `(Local)`
suffix and whose `@updateURL`/`@downloadURL` point at `file://<absolute path to that file on
this machine>` instead — so Violentmonkey's "track local file" picks up a rebuild directly,
without waiting on a github push or periodic update check. The `-local` files are never
committed (see `.gitignore`); `make rebuild-userscripts` regenerates both pairs.

The same batched window (book-translator `reader/userscript_rebuild.py`, after Chữ Nôm entries are saved) that runs
`make rebuild-local-userscripts` also regenerates and redeploys the Rime IME (`rime/tools/gen-nom-dict.sh`, `build.sh mac`,
`deploy.sh --apply`), so new entries are typeable at once. That generated Rime dictionary also includes
`db_src/chunom_standard.json` (below the user's own entries); rerun the book-translator Rime cycle after refreshing it.

For `zoopdog-nom-ruby.user.js` the two builds are otherwise identical — that script has no
local-mode ability to gate, so `-local` only changes the update contract, giving a fast local
dev/reinstall loop decoupled from the github auto-update cadence.

`zoopdog-nom-ruby` stands down on a Cloudflare challenge page ("Just a moment..." / the `challenges.cloudflare.com`
Turnstile frame, recognised by its `/cdn-cgi/challenge-platform/.../orchestrate/` script and `#challenge-*-text`
markup, since the title is localized): it adds no ruby and does not patch `attachShadow` there. Annotating the
challenge text left the verification looping on "Why is this verification taking longer?" (`cf_chl_rc_ni` climbing,
no `cf_clearance`; found 2026-10-24 on g102q.com; the same profile passed with the script off). On every other page the
`attachShadow` hook is a `Proxy`, so `attachShadow.toString()` still reads as native code (bot checks read the source of a
plain wrapper as tampering) while open shadow roots are still annotated.

| Piece | Function(s) |
| --- | --- |
| Availability initialization | `zooProbeLocalMode` enables local actions; individual requests report connection failures |
| HTTP transport | `zooHttpRequest` / `zooGetJSON` / `zooPost` — `GM_xmlhttpRequest`, not `fetch` (bypasses CORS; needs `@connect`) |
| Buttons on the hover popup | `zooRenderLocalActions`, wired via `[data-zd-action]` delegation on `popup.body` in `main()` |
| Selection toolbar (multi-word) | `zooWireSelectionBar` / `zooHandleSelectionChange` / `zooShowSelectionBar` |
| "Add Chữ Nôm entry" modal | `zooWireNomForm`, `zooOpenNomModal` |
| "Set Chữ Nôm order" modal | `zooWireNomOrderForm`, `zooOpenNomOrderModal` |
| Modal mechanics (open/close/drag/toast/Escape) | `zooOpenModal`/`zooCloseModal`/`zooSetModalStatus`/`zooShowToast`/`zooMakeModalDraggable`/`zooBindModalDismiss` |
| Preview/diff rendering | `zooRenderEntryDiff` and the `zooEntryDiff*` helpers |
| Suggestion/debounce/edit-tracking plumbing | `zooFetchSuggestions`, `zooFetchNotesRefresh`, `zooDebounce`, `zooTrackEdits`, `zooCreateRaceGuard` |

All of this is a port of the reader's own `scripts/reader/static/reader_nom.js`,
`reader_nom_order.js`, `reader_entry_diff.js`, and the `shared/entry_forms.js` /
`shared/suggest.js` / `shared/modal.js` modules (all in the `book-translator` repo) — same
fields, same preview → confirm flow, just re-hosted on `GM_xmlhttpRequest` since this runs on
someone else's page, not a same-origin app.

**The modals' logic is server-driven, so it is not duplicated here.** What each modal shows —
the candidates in the requested order, the stored entry, the title and "already recorded" line,
the default pick, the refresh-button order toggle, the preview diff rows, and the grouping of
"Refresh all" answers — is decided by the book-translator server (`docs/server_driven_entry_modals.md`
there) and this userscript only renders the answer. Only DOM building, event wiring and the
shadow-root/page-specific mechanics live here. When a rule changes, change it on the server once;
there is nothing to hand-sync in this file except the rendering of a new field.

## Reachability and endpoints

- Versioned request/response and method catalog: [`test/fixtures/local-mode-contract.json`](../test/fixtures/local-mode-contract.json),
  mirrored in book-translator's `tests/fixtures/zoopdog-local-contract.json`. Each repository tests
  its own routes or callers; when both checkouts exist, tests compare the fixtures too. The catalog
  version describes the fixture, not a negotiated network protocol version.
- Base URL: `http://127.0.0.1:8770` (`ZOO_LOCAL_BASE`). Hard-coded — the reader server always
  runs on this port locally (see `AGENTS-book-server.md` in `book-translator`).
- No startup probe: the local build enables its actions immediately. Each request reports its own
  failure, and requests made after the reader starts can succeed without reloading the page.
- `GET /v1/suggest?kind=nom&text=...` — Chữ Nôm candidates for the "Add entry" field's datalist.
- `GET /v1/suggest?kind=nom-notes&text=...` — a live-translated Notes draft. Fetched in parallel,
  never blocking the fields above — see "Known slow paths" below.
- `GET /v1/nom/form?vi=...[&order=zoopdog|default]` — the whole "Add Chữ Nôm entry" state for a
  term in one request: `candidates`, the stored entry, `title`, `existing_info`, `is_update`, and
  `next_order`. The ↻ button sends the previous reply's `next_order`, so one click gives the
  zoopdog dictionary order and the next click returns to the default ranking (the toggle is the
  server's, not kept here). Replaces the separate `kind=nom` + `/v1/nom/entry` lookups.
- `POST /v1/web-search/open?q=<term>&from=<this page's URL>` → `{urls: [{id, name, url}], opened}`; the search icon opens one tab per search engine enabled on the server's `/control` page (Google, Bing, DuckDuckGo, Yahoo, Yandex, Baidu, ... and custom `{q}` URLs). **The server opens the tabs through CDP** (`Target.createTarget` with the `browserContextId` of the tab at `from`), so they appear in the same Chrome profile as the page and no popup blocker applies. The userscript calls `window.open` on the finished `urls` only when `opened` is 0 (no debug port / tab not found). `GET /v1/web-search` returns the settings (`{lang, langs, region, regions, enabled, engines, custom}`), `POST /v1/web-search?lang=&region=&engines=a,b&custom=<json>` saves them; Google is one engine and `region` selects its `gl` parameter; `/v1/google-search` is the same pair, kept for older clients. Language is each engine's own parameter (`hl=`, `setlang=`, `kl=`), set on `/control`. Mirror: book-translator `scripts/web_search.py`.
- Qwen and Tencent Yuanbao receive `#zoopdog_search=<encoded term>` in the finished URL from book-translator. The local popup userscript runs on the destination, inserts the term into the empty chat editor and clicks Send once; it removes the marker before submitting, leaves existing drafts and unmarked tabs alone, and lets the site present any login or age prompts. It also works when search is initiated from the reader, provided this local userscript is installed and enabled on the target site. See book-translator `docs/research/search_engines_explored/README.md`.
- **Redraw at most once every 2 s (2026-11-07):** streamed replies arrive many times a second and redrawing on each made the Notes list flicker; `zooWireNotesAll` draws the first reply at once, then at most once per `ZOO_NOTES_ALL_REDRAW_MS` (2000) with the latest rows, and the final rows always replace the list. Mirrors `NOTES_ALL_REDRAW_MS` in book-translator's `shared/suggest.js`.
- **One connection for Refresh all (2026-11-07):** `zooFetchNotesAll` reads `GET /v1/suggest/stream?kind=&text=` (NDJSON, a `{entry, rows}` line per finished channel, then `{"done": true}`; book-translator `scripts/reader/notes_stream.py`) with one `GM_xmlhttpRequest` (`onprogress` for live lines, `onload` for the full text). Only if that fails does it use the per-channel requests, capped at 5 (`ZOO_NOTES_ALL_CONCURRENCY`): a browser keeps 6 connections per host and 70 channel requests made a 3 ms reading request wait 27 s.
- **Client retry, per channel:** "Refresh all" asks `refresh=all&engines=1` for the channels, then one `refresh=all&engine=<i>&session=<id>` request per channel; every reply carries the finished `rows` over all channels so far (waiting / error rows are built by the server). Each channel request waits 75 s (`ZOO_NOTES_ALL_TIMEOUT`, above the server's 60 s per-channel cut-off) instead of the generic 8 s; the server merges a retry into the call still running for the same channel and text (`coalesced`), so a retry never starts a second engine call. A failing channel is retried alone 3 times (1 s, 2 s, 4 s), then reported with `&error=1`. The list is redrawn with every reply (2026-11-07; `onRows`), so the quick engines' answers show while slow ones (7-30 s) are still a `waiting` row; the final draw has the channels that answered and the failed ones as an error row. Mirrors `shared/suggest.js` in book-translator. A channel that failed 5 times in a row (2026-10-31) comes back as a server-made `failing: <id>` row whose `actions` (a list of `label`, `path`, `params`: "Disable globally", "Disable for this process") the runtime draws as buttons and sends as GETs (`GET /v1/suggest?channel=<id>&disabled=1|0|global`: off for the server process, on again, or off for good in book-translator's `provider-lists.toml`); the runtime decides nothing.
- `GET /v1/suggest?kind=nom-notes&text=...&refresh=all` — every translation engine at once; the
  reply carries `rows`, already grouped and folded server-side (`scripts/notes_grouping.py`), which
  the "Refresh all" list just draws. Each row has a finished `label` (`"edge, google"`, `"ALL"`, or
  `"pair not supported: papago"` for an `unsupported` row: engines that do not offer the pair). Engines whose
  silence is expected (youdao, mirai, weblio: pairs they never answer) are left out of `rows`.
  `translations` (the raw per-engine list) stays for old clients.
- Every preview reply (`preview=1`) carries `diff` — `{changed, rows}` with the character-level
  narrowing already done (`scripts/entry_diff.py`); `zooRenderEntryDiff` only draws segments.
- `GET /v1/nom/entry?vi=...` — kept for older callers; the modal no longer uses it.
- `POST /v1/nom/entries?vi=...&nom=...[&explain=...][&preview=1][&replace=1]` — write a
  new/extended/corrected entry. Extends by default (never drops an existing rendering), so
  the "Add" path skips the preview step entirely; only an *update* (term already on file)
  goes through preview → confirm. `replace=1` is the update-only escape hatch for correcting
  a wrong rendering (a typo, a mis-scanned character): it drops the stored variant(s) instead
  of keeping them alongside the fix. The popup's "Add Chữ Nôm entry" modal surfaces this as a
  "Replace the stored spelling instead of adding a variant" checkbox, shown only once the
  term is recognized as an update.
- `GET /v1/nom/order?vi=...&scope=global` — the term's known renderings plus whatever order is
  already recorded, for the "Set order" picker, with the modal's `title`, `existing_info`,
  `current_hint` and default `pick` (the recorded first choice when it is not already the ruby on screen, else the second rendering: never the shown one) already
  written by the server.
- `POST /v1/nom/order?vi=...&nom=...&scope=global[&preview=1]` — record which rendering leads.
  This one *replaces* the preference, so it always goes through preview → confirm. When the
  case-sensitive option is selected, both preview and save include `caseSensitive=1` so they
  refer to the same exact-spelling row.

- `POST /v1/zoopdog/speak` with a JSON body `{text, confirm}` (optionally `session` and `voice: "next"`: the Eudic plugins' "play all" button rotates the engine per session, the userscript does not use it) — read the selection aloud. Triggered
  by Alt+R (matched by physical key, so macOS Option works) or the 🔊 button in the selection bar
  (shown even for selections too long for a Chữ Nôm entry). The server splits the text by language
  (vi/en/ja/ko/ms/zh), reads each part in the voice set under "Zoopdog reading" in `/control/userscripts` (each engine is labelled with whether it sends the text away), and
  queues it behind whatever is playing, so a reading reader is never interrupted. There is no length
  limit: a very long selection or a long queue answers 409 `{status: "confirm", message}`, the
  script asks with `window.confirm(message)` and resends with `confirm: true`. The toast shows the
  server's `label` (`vi → en`) or `message`; nothing about language or wording is decided here.

`book` is never sent. Both endpoints already treat a missing `book` as "the shared dictionary,"
which is the only thing that makes sense from a page that is not the reader — see the comment on
`_nom_entry` in `book-translator/scripts/reader/routes_entries.py`. `scope` is always `"global"`
for the same reason: there is no "book" to scope a local, book-only order to.

## Known slow paths (already worked around, don't reintroduce)

- **Translations are wanted in number, not trimmed.** "Refresh all" asks every engine at once and
  the Notes draft runs in parallel with the form request, so slowness is bounded by the slowest
  provider, not the sum. Do not "optimise" by asking fewer engines; see
  `book-translator/docs/server_driven_entry_modals.md`.
- **The Notes draft is a live translation API call**, not a local lookup — it goes out to a
  third-party provider from the *server's* machine. It is intentionally fetched in parallel with
  the fast candidate/entry lookups (never `Promise.all`'d together), so it can take
  300ms–1s+ without holding up the rest of the form. See `book-translator`'s
  `scripts/reader/routes_suggest.py` for `NOTES_DRAFT_PROVIDERS` (edge-first, tuned for this
  draft specifically — separate from `DEFAULT_MT_PROVIDERS`, which is the real translation
  pipeline's order and must not be repurposed for this).
- **A `POST /v1/nom/entries` write bumps one `user_nom_entries/` shard's mtime** (128 CSV
  shards replaced the old single `user_nom_entries.jsonc` file — see `SHARDING.md` in that
  directory), which makes the *next* request that touches the Nôm dictionary reparse just that
  one small shard, not the whole tens-of-thousands-of-term merged index —
  `LiveNomIndex`'s base-layer cache (`nom_sources._load_base_layers` in
  `book-translator/scripts/reader/nom_sources.py`) keeps `vnedict2.json`/`mdx_nom.json` around
  across a reload triggered only by a shard or `user_nom_order.jsonc` change. A `POST
  /v1/nom/order` write still bumps `user_nom_order.jsonc`'s single-file mtime, which is cheap to
  reparse on its own. Nothing to fix here; it is how the server stays in sync across
  tabs/sessions without a restart.

## Testing changes here

```sh
node --check scripts/userscript/popupdict-local.runtime.js
node scripts/build-popupdict-userscript.js
make verify
```

`make verify` does not exercise local mode's network calls (there is no DOM/browser harness in
this repo's `test/`); it only checks that the runtime source is syntactically valid and that the
generated userscript stays in sync with it. To verify the feature itself, start the
`book-translator` reader server, install the rebuilt **`zoopdog-popupdict-local.user.js`**
(the plain `zoopdog-popupdict.user.js` has none of this code), and hover/select a Vietnamese
term on any page.

## Cross-repo pointer

**Local mode spans two repositories and they are edited together.** Any change to a local-mode
endpoint, request/response shape, hotkey, setting or its `/control/userscripts` page is made in both
`zoopdog` (this runtime, `docs/local-mode.md`) and `book-translator` (the routes, tests,
`AGENTS-book-server.md`) in the same piece of work, with both docs updated. Never leave one side
describing behaviour the other no longer has.

The server side of everything above — routes, the Nôm/order file formats, the live-reload
index, the MT provider chain — lives in `book-translator`, not here. Read
`AGENTS-book-server.md` and `scripts/reader/routes_entries.py` /
`scripts/reader/routes_suggest.py` /
`scripts/reader/nom_live.py` there before changing any endpoint this userscript calls.


## Translation relay order (2026-10-25)

The shared book-translator service prefers locally computed tokens/signatures, supplied or cached
credentials, and direct HTTP/WebSocket requests. CDP remains the **last resort** when those paths
cannot work; it is not removed from protected channels. This is the same policy documented in
book-translator `AGENTS.md` / `docs/translation_local_first.md` and online-dict `AGENTS.md`.
Baidu AI reuses the Mac's verified account-session cache with local ACS signing and HTTP;
guest-only zero-quota replies are refused. Last-resort CDP may recover existing account
cookies once and retry HTTP, saving only after AI proof (owner-only, expiry bounded to
seven days); in-tab AI translation is the final fallback. DeepL now uses anonymous
oneshot HTTP (`oneshot-free.www.deepl.com/v1/translate`, literal `Authorization: None`),
without cookies/app identity or CDP. Thirteen live checks passed across all seven
project languages with CDP forbidden. Inputs split under 1500 UTF-16 units; transient
errors get at most three attempts before final browser recovery, while explicit
refusals remain respected. The refused legacy JSON-RPC path is retired.
QQ/Mazii use persistent owner-only token caches, migrating temporary entries without
extending expiry; server refusals clear both stores. Missing/expired account/captcha
credentials can still need browser recovery. See book-translator's
`docs/research/translation-cdp-audit-2026-10-25.md` for the complete channel audit.
Model IDs, language codes, URLs and `{outcome, text}` payloads are unchanged, so the userscript
requires no provider-specific source change. No alternate provider or paid API is silently substituted.


## Shared server energy saving (2026-10-26)

The book-translator server owns overnight energy policy: automatic 03:00–07:30
local-time battery saving reduces idle battery probes but keeps **Stay reachable**
enabled, including paused playback. That mode now holds a PID-bound idle-sleep
assertion while selected; saving energy does not release it. Existing explicit
sleep and low-battery safety still apply. Clients keep the same endpoints and
payloads and must not add a polling loop or request sleep to implement this
policy. Implementation, tests and configuration live in book-translator's
`docs/evening_energy_saving.md` and `AGENTS-book-server.md`.

The server also automatically terminates confirmed runaway zsh-autocomplete
shells belonging to its own checkout after two high-CPU observations five
minutes apart and a fresh ownership/identity check. It does not terminate this
repository's processes. Keep this server behavior documented in all three
repositories; client code needs no change while the HTTP contract is unchanged.

## Explored-site colouring on other search engines (2026-11-05)

The Google highlighter (`/v1/explored-sites/match`, refresh and blacklist buttons) also runs on Bing, DuckDuckGo, Yahoo,
Yahoo! JAPAN, Baidu, Brave, Ecosia, Startpage, Qwant, Naver and Seznam. `ZOO_SEARCH_ENGINES` in
`popupdict-local.runtime.js` describes only layout per engine: `scope` (every link section, AI answers included),
`block` (one result; none = paint the link itself), `own` hosts (never keys) and how a redirect link yields its target
(Bing `ck/a?u=a1<base64url>`; Baidu the container's `mu`). Yandex and Sogou (bot check) and Kagi (login) also work in a profile that passed the check / is logged in; Sogou's redirect
links read the host from the address shown in the result. Evidence and per-engine verdicts: book-translator `docs/research/search_engines_explored/`.

### Additional web and AI search pages (2026-11-08)

The local highlighter recognises all built-in reader search URLs, including Yahoo
Hong Kong and Taiwan, 360 Search, new regional engines and AI answer pages.
For 360's opaque result links it reads the original address from `data-mdurl`;
Yahoo redirect `RU` targets are decoded. Other newly added layouts use external
links on the recognised page and exclude header, navigation and footer links.
Citations without result headings use the hover refresh/blacklist controls,
including after colouring; dynamic links are picked up by the existing observer.
Recognition is not proof that a site renders link anchors: sign-in, captchas,
region restrictions, opaque targets and layouts without links can prevent
colouring. Result matching and blacklist storage remain on book-translator.
See `docs/research/search_engines_explored/README.md` there for live checks.

### Adding a search engine

Whenever book-translator gains a built-in web or AI search engine, add its
result-link support to `scripts/userscript/popupdict-local.runtime.js` in the
same change. Cover the engine's observed hosts, search paths, redirects and
regional or AI variants; inspect result and citation layouts, including
dynamically added content. Restrict matching to result links where feasible,
exclude provider/navigation links and recover the destination host from opaque
redirects when evidence permits. Never blacklist the search engine's own
redirect host as if it were a result.

Use the existing `/v1/explored-sites/match` server colours and blacklist route;
the userscript handles page layout and draws refresh and blacklist controls.
Both controls must remain reachable on coloured links and on AI citations
without headings. Cover host/path recognition, redirects, colouring, refresh,
blacklist and dynamic layouts with meaningful tests; the cross-repository test
in `test/popup-local-runtime.test.js` also checks the reader's built-in
catalog. Run the relevant tests and `make rebuild-local-userscripts`.
In addition, run the real-page audit from book-translator:
`.venv/bin/python scripts/audit_search_coloring.py --page-id <target-id>`.
Use a real search that returns at least one known explored or blacklisted site,
opened in the user's Zoopdog Chrome profile, and let results finish. The audit
queries the actual server and fails for any matched result without its colour,
or for a page with zero matched results. Mocks and synthetic colours are not
substitutes. Save repeatable URLs and observed counts in the book-translator
search research note; record unavailable or blocked pages.

Bing Copilot renders citations in its `cpltsrchif=1` search iframe. MetaSo chat
uses clickable source cards rather than anchors; its page-world bridge exposes
the HTTP(S) destination from the card's React props for matching and controls.
The live regression suite is opt-in in book-translator:
`SEARCH_COLOR_E2E=1 .venv/bin/python -m pytest -n0 tests/test_search_coloring_e2e.py -q`.
It requires the current local userscript installed and the documented real tabs
open. On 2026-11-08, version 2026.11.08.37 passed live colour and control checks
on Bing Copilot and a MetaSo chat containing explored sources; the research note
records the counts and the source-free greeting skipped by the suite.

Document the URL, selectors, redirects and real verification in this file and
`~/mine/book-translator/docs/research/search_engines_explored/README.md`.
Inspect via direct HTTP first, then the authorized project CDP bridge where
needed. Record authentication, captcha, regional denial, unavailable sites,
opaque or non-anchor citations and any unverified behavior; recognition of a
URL alone does not prove its results were coloured. Custom user-defined search
URLs need their own layout investigation when requested.
