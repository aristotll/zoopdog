# Local Mode (Popup Dictionary ↔ book-translator Reader Server)

`zoopdog-popupdict.user.js` can talk to a **local HTTP server that lives in a different
repository** — the `book-translator` project's reader/TTS server
(`scripts/reader/tts_server.py` there, started with `--nom-data
<path-to-this-repo>/zd-extension/db_src`). When that server is reachable, the popup gains two
extra actions on every looked-up term: **"+ Add Chữ Nôm"** and **"Set order"**, writing straight
into this repo's `zd-extension/db_src/user_nom_entries.jsonc` /
`user_nom_order.jsonc` — the same files `/add-chu-nom` and the reader's own modals write.

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

Everything is in `scripts/userscript/popupdict.runtime.js`, in the "Local mode" section near the
top of the file (search for `ZOO_LOCAL_BASE`). Nothing here has its own source module — it is
part of the userscript runtime like everything else, built by
`scripts/build-popupdict-userscript.js` into `zoopdog-popupdict.user.js`. Matching styles are in
`scripts/userscript/popupdict.css` under the "Local mode" comment near the end of the file
(`zd-local-*`, `zd-modal-*`, `zd-entry-diff-*`, `zd-selection-bar`, `zd-toast`).

| Piece | Function(s) |
| --- | --- |
| Reachability probe | `zooProbeLocalMode` — one `GET /healthz`, sets `ZOO_LOCAL_AVAILABLE` |
| HTTP transport | `zooHttpRequest` / `zooGetJSON` / `zooPost` — `GM_xmlhttpRequest`, not `fetch` (bypasses CORS; needs `@connect`) |
| Buttons on the hover popup | `zooRenderLocalActions`, wired via `[data-zd-action]` delegation on `popup.body` in `main()` |
| Selection toolbar (multi-word) | `zooWireSelectionBar` / `zooHandleSelectionChange` / `zooShowSelectionBar` |
| "Add Chữ Nôm entry" modal | `zooWireNomForm`, `zooOpenNomModal` |
| "Set Chữ Nôm order" modal | `zooWireNomOrderForm`, `zooOpenNomOrderModal` |
| Modal mechanics (open/close/drag/toast/Escape) | `zooOpenModal`/`zooCloseModal`/`zooSetModalStatus`/`zooShowToast`/`zooMakeModalDraggable`/`zooBindModalDismiss` |
| Preview/diff rendering | `zooRenderEntryDiff` and the `zooEntryDiff*` helpers |
| Suggestion/debounce/edit-tracking plumbing | `zooFetchSuggestions`, `zooFetchNotesRefresh`, `zooDebounce`, `zooTrackEdits`, `zooCreateRaceGuard` |

All of this is a from-scratch port of the reader's own `scripts/reader/static/reader_nom.js`,
`reader_nom_order.js`, `reader_entry_diff.js`, and the `shared/entry_forms.js` /
`shared/suggest.js` / `shared/modal.js` modules (all in the `book-translator` repo) — same
fields, same suggestion lookups, same preview → confirm flow, just re-hosted on
`GM_xmlhttpRequest` since this runs on someone else's page, not a same-origin app. When the
reader's own modals change shape, this is the code to bring in sync by hand; there is no shared
module between the two repos.

## Reachability and endpoints

- Base URL: `http://127.0.0.1:8770` (`ZOO_LOCAL_BASE`). Hard-coded — the reader server always
  runs on this port locally (see `AGENTS-book-server.md` in `book-translator`).
- Probe: `GET /healthz`. Runs once at `document-idle`; result is not re-checked, so a server that
  starts *after* a page has already loaded needs that page reloaded to pick up local mode.
- `GET /v1/suggest?kind=nom&text=...` — Chữ Nôm candidates for the "Add entry" field's datalist.
- `GET /v1/suggest?kind=nom-notes&text=...` — a live-translated Notes draft. Fetched in parallel,
  never blocking the fields above — see "Known slow paths" below.
- `GET /v1/nom/entry?vi=...` — whether a term is already recorded, to switch the modal into
  update mode.
- `POST /v1/nom/entries?vi=...&nom=...[&explain=...][&preview=1]` — write a new/extended entry.
  Additive only (never overwrites an existing rendering), so the "Add" path skips the
  preview step entirely; only an *update* (term already on file) goes through preview → confirm.
- `GET /v1/nom/order?vi=...&scope=global` — the term's known renderings plus whatever order is
  already recorded, for the "Set order" picker.
- `POST /v1/nom/order?vi=...&nom=...&scope=global[&preview=1]` — record which rendering leads.
  This one *replaces* the preference, so it always goes through preview → confirm.

`book` is never sent. Both endpoints already treat a missing `book` as "the shared dictionary,"
which is the only thing that makes sense from a page that is not the reader — see the comment on
`_nom_entry` in `book-translator/scripts/reader/routes_entries.py`. `scope` is always `"global"`
for the same reason: there is no "book" to scope a local, book-only order to.

## Known slow paths (already worked around, don't reintroduce)

- **The Notes draft is a live translation API call**, not a local lookup — it goes out to a
  third-party provider from the *server's* machine. It is intentionally fetched in parallel with
  the fast candidate/entry lookups (never `Promise.all`'d together), so it can take
  300ms–1s+ without holding up the rest of the form. See `book-translator`'s
  `scripts/reader/routes_suggest.py` for `NOTES_DRAFT_PROVIDERS` (edge-first, tuned for this
  draft specifically — separate from `DEFAULT_MT_PROVIDERS`, which is the real translation
  pipeline's order and must not be repurposed for this).
- **Any write (`POST /v1/nom/entries` or `/v1/nom/order`) bumps a file's mtime**, which makes the
  *next* request that touches the Nôm dictionary on that server pay a one-time reload of the
  whole merged index (tens of thousands of terms, roughly 1–1.5s as of this writing) — see
  `LiveNomIndex.refresh()` in `book-translator/scripts/reader/nom_live.py`. This shows up as
  "the request right after I saved something felt slow," not the save itself. Nothing to fix
  here; it is how the server stays in sync across tabs/sessions without a restart.

## Testing changes here

```sh
node --check scripts/userscript/popupdict.runtime.js
node scripts/build-popupdict-userscript.js
make verify
```

`make verify` does not exercise local mode's network calls (there is no DOM/browser harness in
this repo's `test/`); it only checks that the runtime source is syntactically valid and that the
generated userscript stays in sync with it. To verify the feature itself, start the
`book-translator` reader server, install the rebuilt userscript, and hover/select a Vietnamese
term on any page.

## Cross-repo pointer

The server side of everything above — routes, the Nôm/order file formats, the live-reload
index, the MT provider chain — lives in `book-translator`, not here. Read
`AGENTS-book-server.md` and `scripts/reader/routes_entries.py` /
`scripts/reader/routes_suggest.py` /
`scripts/reader/nom_live.py` there before changing any endpoint this userscript calls.
