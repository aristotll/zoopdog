# Offline Chữ Nôm review queue (non-local userscript → book-translator `/control`)

## Problem

`zoopdog-popupdict.user.js` (the plain GitHub-hosted build, no local-mode network code — see
[docs/local-mode.md](../../local-mode.md)) has no way to flag a Vietnamese term for a Chữ Nôm
entry while browsing, because that ability only exists in `-local` and only when the
`book-translator` reader server happens to be reachable at that moment. Most of the time the
user is reading on an arbitrary third-party page with no server running, so a term worth
flagging is simply lost today.

## Goal

Let the non-local build queue flagged terms locally (no network), then, later, flush that queue
from a page the user already visits on the same LAN as the reader server: the reader's phone
remote page (`/control`, `scripts/reader/static/control.html` in `book-translator`).

Explicitly out of scope: this does **not** write directly into the shared Chữ Nôm dictionary
(`user_nom_entries/` shards). It produces a plain review list a human still looks at inside the
reader app later. It also does not touch the `-local` build's existing Add/Set-order flow.

## Part A — flag action in the non-local build (zoopdog)

- `renderDefinition()` ([scripts/userscript/popupdict.runtime.js](../../../scripts/userscript/popupdict.runtime.js))
  currently renders `zooRenderLocalActions(vn)` when that function exists (the `-local` build
  only) and nothing otherwise. Add an `else` branch: when `zooRenderLocalActions` is undefined
  (i.e. this is the non-local build), render a `+ Đánh dấu Nôm` button
  (`data-zd-action="queue-nom-review" data-zd-vi="<vn>"`).
- New click handler branch in `main()`'s existing `[data-zd-action]` delegation: action
  `queue-nom-review` reads a GM-stored array (`GM_getValue`/`GM_setValue`, key
  `zoopdog_nom_review_queue`), appends the term with a timestamp if not already present, saves,
  and gives lightweight inline feedback (swap the button label briefly — no toast system exists
  outside the `-local` CSS/JS, so don't invent one for this).
- Manifest change in [scripts/build-popupdict-userscript.js](../../../scripts/build-popupdict-userscript.js):
  move `GM_setValue` / `GM_getValue` out of the `-local`-only grant block into the base grant
  list emitted for **both** builds. `GM_xmlhttpRequest` stays `-local`-only; nothing here needs
  it.
- The `-local` build keeps its current behavior untouched — the new branch only fires when
  `zooRenderLocalActions` is absent.

## Part B — export panel injected on `/control`

- Still in `popupdict.runtime.js` (it runs on every page via `@match *://*/*`), add a
  startup check, guarded the same way as Part A (`typeof zooRenderLocalActions !== 'function'`,
  i.e. non-local build only):
  - `location.pathname === '/control'`, and
  - hostname is `127.0.0.1`, `localhost`, or a private LAN range (`192.168.*`, `10.*`,
    `172.16.x-172.31.x`) — this is the reader's own phone-remote page, reachable both on the
    machine itself and from another device on the LAN.
- No separate reachability probe is needed — being on that exact page already proves the
  server answered.
- If the GM queue is non-empty, inject a small `<section>` into `document.body` (styled inline,
  matching `control.html`'s own dark/minimal look, since nothing from `popupdict.css` is loaded
  there) listing the queued terms with an "Export" button.
- Export does a same-origin `fetch(location.origin + '/v1/nom/entries/import', { method: 'POST',
  headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ words: [...] }) })` —
  same-origin, so no `@connect`/`GM_xmlhttpRequest` grant is needed. On success, remove the
  exported words from the GM queue and update/remove the panel.

## Part C — new endpoint in book-translator

- New route `POST /v1/nom/entries/import` in `scripts/reader/routes_entries.py`, registered in
  `scripts/reader/routes.py` next to the other `/v1/nom/*` routes.
- Body: `{"words": ["...", ...]}` — plain Vietnamese term strings only, no `nom`/`explain`
  fields (the offline queue never collected those, since suggestion lookups need the server).
- Appends new, non-duplicate words to a plain review file under the existing `memory/` root
  (see `MEMORY_ROOT` in `scripts/reader/furigana_overrides.py` for the convention),
  e.g. `memory/nom_review_queue.jsonc`. This file is for a human to read later inside the reader
  app; the route does **not** call `upsert_user_nom_entry` or touch the shard store.
- Response: counts of words added vs. already present, so the userscript knows the whole batch
  was handled and can safely clear its GM queue.

## Testing

- Zoopdog side: `node --check scripts/userscript/popupdict.runtime.js`, rebuild both userscripts
  (`node scripts/build-popupdict-userscript.js`), `make verify`. No DOM harness exists in this
  repo, so the queue button/panel need a manual check (install `zoopdog-popupdict.user.js`,
  flag a term, open the reader's `/control` page, confirm the panel and a successful export).
- book-translator side: whatever this repo's existing test convention is for `routes_entries.py`
  (`AGENTS-book-server.md`) — add a unit test for the new route alongside the existing
  `/v1/nom/entries` tests.
