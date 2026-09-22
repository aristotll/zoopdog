## Context

Zoopdog has two browser clients for the same committed runtime dictionary: the Manifest V3 service worker in `zd-extension/js/background.js` and the website demo in `js/popupdict.js`. Both create a Dexie database named `entries`, decide that any non-zero row count is current enough, and then serve queries from it. The extension only populates on install/update when the database is empty; the website behaves the same on every return visit. Consequently a corrected `zd-extension/js/vnedict.json` does not reach an existing user. The popup's manual `reload-db` path is worse under failure: it commits `clear()` before it fetches/parses/populates the replacement, so a transient error converts a working installation into an empty one.

The popup card is a Chrome sandbox page because Handlebars compilation requires the sandbox's relaxed CSP. Chrome serves such a page in a unique origin, so the current code uses `postMessage(..., '*')`. However, both sides accept every `message` event without checking its source, session, type shape, or numeric bounds. Because the content script runs on `<all_urls>` and the injected iframe is part of the host DOM, this is a real trust boundary, not merely an internal callback. The current Shift handler also posts `toggle-lock` to the sandbox window itself, where no handler consumes it.

Runtime maintenance has a source-of-truth issue as well. The checked-in `zd-extension/frame.html` loads `js/frame.js`, while its authoritative `frame.jade` still embeds a second inline implementation. A future documented Pug rebuild would restore the stale copy. None of `background.js`, `content.js`, `showframe.js`, `frame.js`, or `js/popupdict.js` is directly exercised by the current 116-test suite.

This design must preserve the repository's plain-JavaScript, dependency-free, committed-generated-asset model. It is intended to follow `harden-dictionary-data-pipeline`, which establishes deterministic generation of `zd-extension/js/vnedict.json`; if implemented first, its metadata-builder task must be coordinated with that active change rather than duplicated.

## Goals / Non-Goals

**Goals:**

- Ensure existing extension and website installations notice a newly shipped dictionary without rebuilding IndexedDB on every lookup or page load.
- Preserve the last complete dictionary across fetch, parse, validation, and write failures.
- Give callers and users an explicit ready/fresh/stale/error state rather than silently swallowing refresh failures.
- Reduce sandbox communication to a validated, private session channel and make invalid traffic inert.
- Make initialization additive and idempotent, and ensure only the newest pointer lookup can update UI state.
- Restore one authoritative frame runtime source and verify the runtime architecture with dependency-free tests.
- Remove permissions for which the implementation has no usage-backed need.

**Non-Goals:**

- Redesign the popup card, pronunciation output, dictionary entry schema, or lookup ranking.
- Replace Dexie, Handlebars, the sandbox page, or checked-in generated assets.
- Change the content script's `<all_urls>` product behavior or introduce optional/site-specific access.
- Fix unrelated website metadata paths, legacy browser support, dictionary linguistic content, or repository binary size.
- Add a package manager, DOM test framework, bundler, transpiler, telemetry service, or remote API.

## Decisions

### 1. Generate a small sidecar identity for the exact runtime dictionary

The runtime-dictionary builder will emit `zd-extension/js/vnedict.meta.json` beside `vnedict.json`. It will contain a schema version, SHA-256 revision of the exact JSON bytes, and entry count. Both files are generated from the same in-memory result and written as one build operation. The sidecar is cheap to fetch and gives both clients a stable freshness key without downloading/parsing the multi-megabyte dictionary when nothing changed.

The clients store the accepted revision, entry count, and schema version in a Dexie metadata table. A stored revision is considered current only when the metadata record is complete and the live entry count equals its recorded count; an old database with rows but no metadata is stale and is refreshed once.

*Alternative considered*: use the extension version and a hand-maintained website constant. Rejected because unrelated releases would cause unnecessary rebuilds and maintainers could forget to bump the website value when dictionary bytes change.

*Alternative considered*: depend on HTTP `ETag`/`Last-Modified`. Rejected because extension URLs and local/static hosting do not share a dependable validator contract, and those headers are not part of the committed artifact.

### 2. Share one refresh coordinator with injected browser adapters

A plain browser-compatible file (for example `zd-extension/js/zd-dictionary-runtime.js`) will own metadata validation, payload validation, refresh decisions, the single-in-flight refresh promise, and the state/result vocabulary. It will expose a global for ordinary script loading and a guarded CommonJS export for `node:test`, matching the existing `zd-words.js` pattern. The extension service worker loads it with `importScripts`; the website includes it before `popupdict.js`.

Dexie, `fetch`, status reporting, and URLs are passed as adapters. This keeps the transform/state logic testable with in-memory fakes and prevents the extension and website from drifting into two variants again.

The state vocabulary is: `ready-current`, `ready-refreshed`, `ready-stale`, and `unavailable`, each with revision/count where meaningful and a stable error code/remedy on failure. All concurrent callers await one coordinator promise. Search messages wait for readiness rather than racing `onInstalled` or a manual reload.

*Alternative considered*: keep separate refresh implementations with characterization tests. Rejected because their current non-zero-count shortcut is already a duplicated defect and the state transitions are identical.

### 3. Fetch and validate before one atomic Dexie replacement transaction

On a required or forced refresh, the coordinator will:

1. fetch and validate the metadata sidecar;
2. fetch the dictionary as text, verify parseability, top-level array shape, entry count, required per-entry fields, and SHA-256 revision when Web Crypto is available;
3. open one read-write transaction over entries and metadata;
4. clear entries, bulk-add the validated payload, write its metadata, and confirm the resulting count before commit.

Any transaction failure aborts both tables, preserving their previous bytes/logical rows. A metadata or payload failure occurs before the transaction. A forced manual reload uses the same path even if revisions match. When refresh fails and a previously validated database remains, lookups continue with `ready-stale` plus a warning; when no validated database exists, callers receive `unavailable` and UI reports the remedy.

Dexie will gain a metadata store in a schema-version upgrade. The upgrade creates the store but does not clear existing entries; absence of a revision naturally schedules the one-time refresh.

*Alternative considered*: populate a second database and swap names. Rejected because IndexedDB has no atomic database-name swap, cleanup becomes crash-sensitive, and a single Dexie transaction already provides the required all-or-nothing semantics.

### 4. Use a transferred `MessageChannel` for popup-frame traffic

`ResultFrame` will create a `MessageChannel` in its isolated content-script context. After the iframe's load event, it transfers one port in a versioned `zd:init` message; the sandbox binds once, removes/neutralizes the global initializer, and uses only the port thereafter. The page cannot obtain the retained port from the content script's isolated JavaScript world, while the sandbox's unique origin means the one transfer still uses `'*'` as required by the platform.

Every port message uses a closed set of types and a validator shared by both endpoints. `populate` accepts only bounded arrays in the dictionary result shape plus a known dialect; `resize` accepts only finite non-negative dimensions and the parent applies hard maximums; `lock`, `unlock`, and `toggle-lock` carry no arbitrary payload. Unknown or malformed messages are ignored and cannot mutate DOM or frame geometry. Closing/reloading the frame invalidates the old port.

This also gives Shift-in-frame a real return path: it sends `toggle-lock` on the port to `ResultFrame`, which updates the highlighter and frame lock state through the existing parent controller.

*Alternative considered*: retain global `window` messages with `event.source` checks alone. Rejected because `event.source === parent` cannot distinguish the legitimate isolated content-script sender from host-page code using the same parent window. A per-frame transferred port removes the recurring ambient listener.

*Alternative considered*: set a fixed extension `targetOrigin`. Rejected because Chrome sandbox pages are deliberately served from a unique origin; the platform's documented sandbox communication uses `'*'` for the initial transfer.

### 5. Initialize by readiness, never by assigning event-handler properties

Each browser entry point will expose an idempotent initializer. Code that needs a complete DOM runs immediately when `document.readyState !== 'loading'`, otherwise via `DOMContentLoaded` with `{once: true}`. Content-script listeners that are safe before the DOM may register immediately, while DOM construction waits for readiness. No first-party source assigns `window.onload` or another global event-handler property.

This preserves host-page/other-handler behavior, works when a script loads after the event, and is unit-testable with a small fake event target.

### 6. Make pointer lookups latest-wins

Both the extension and website lookup controllers will increment an epoch for each candidate lookup and for invalidating events such as mouseout, scroll, resize, disable, and hide. Every asynchronous continuation captures its epoch and checks it before highlighting or populating. A miss, rejected request, or stale response releases the word-suppression state; the short anti-flicker delay applies only to a successful current response.

The extension service worker's responses remain structurally compatible, but failures return stable error objects. The content and website controllers surface no unhandled rejection and keep the last valid UI state hidden rather than showing a result for a prior pointer position.

### 7. Restore source/generated ownership and enforce least privilege structurally

`zd-extension/frame.jade` will contain only `<script src="js/frame.js">` for the frame controller, matching the checked-in HTML. A structural test fails if the inline controller identifiers reappear in Jade or if either source/generated page omits `frame.js`. Pug compilation remains the authoritative regeneration step; when `pug` is available, the implementation verification will compile to a temporary directory and compare.

Manifest review shows `chrome.tabs.query`, `sendMessage`, and `create` do not require the `tabs` permission when sensitive tab fields are not read; `activeTab` is unused because no programmatic injection/capture occurs; and the `ajax.googleapis.com` host permission matches no request. The change will retain `storage`, remove those unused grants, and add a test that declared named/host permissions have an enumerated first-party call site or documented resource need.

## Risks / Trade-offs

- **[Risk]** Replacing tens of thousands of IndexedDB rows during an update can briefly delay the first lookup. → Coalesce refreshes, bulk-add in one transaction, expose loading state, and continue using an already-validated stale database if the new asset cannot be obtained.
- **[Risk]** SHA-256 via `crypto.subtle` may be unavailable on an insecure/local website context. → Treat digest verification as required where Web Crypto exists; always require exact entry count and entry-shape validation, and never commit a payload that disagrees with its sidecar. Record reduced validation in the structured result for manual/local contexts.
- **[Risk]** A host page could try to race the one-time sandbox initializer. → Register the iframe load handler before insertion, transfer and bind the port immediately on load, accept exactly one valid initialization, and test that subsequent initializers/messages are inert. Browser verification includes a hostile page script attempting ambient `postMessage` traffic.
- **[Risk]** A new metadata artifact overlaps the unimplemented `harden-dictionary-data-pipeline` builder work. → Sequence the changes or amend that builder once; do not create two generators. The task list explicitly treats the earlier change as the owner of `vnedict.json` generation.
- **[Trade-off]** Keeping a stale validated dictionary available after refresh failure favors lookup availability over immediate freshness. The UI must label the stale state and offer retry; first-run corruption/failure remains a hard unavailable state.
- **[Trade-off]** Dependency-free fake adapters exercise protocol/state logic but are not a substitute for Chrome/IndexedDB integration. Manual browser verification remains an explicit completion task.

## Migration Plan

1. Land or coordinate with `harden-dictionary-data-pipeline`; extend its single runtime builder to generate and commit `vnedict.meta.json` deterministically.
2. Add the shared refresh coordinator and tests, then upgrade both Dexie clients with the metadata store and transactional replacement while preserving the old row store.
3. Add status rendering and structured extension message errors; verify first install, upgrade from a metadata-less database, forced reload success, forced reload rollback, and offline stale fallback.
4. Add the popup protocol/MessageChannel implementation and validators, then switch frame/content/website consumers together so no mixed protocol ships.
5. Change Jade to load `frame.js`, regenerate `frame.html`, replace `window.onload` assignments, add lookup epochs, and remove unused manifest permissions.
6. Run automated and temporary-build checks, then perform real website and unpacked-extension tests including hostile message traffic.

Rollback is code-only except for the additive Dexie metadata table. Reverting the runtime code leaves the existing entries table readable by schema version 2 behavior; the extra store is harmless. The committed dictionary and sidecar can remain or be reverted with their generator without deleting user data.

## Resolved Questions

- The revision sidecar is emitted by the single `build-extension-vnedict-json.js` owner introduced in this change, because `harden-dictionary-data-pipeline` remains an unimplemented proposal. The shared paths and atomic writer are reusable by that later change, so it does not need a competing generator.
- The website retains `file://` support through a same-file-origin `XMLHttpRequest` text-loading fallback. That mode records reduced shape-and-count verification when Web Crypto is unavailable; HTTP(S) and extension contexts use `fetch` and SHA-256 when supported.
