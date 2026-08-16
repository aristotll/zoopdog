## 1. Baseline and change sequencing

- [x] 1.1 Resolve implementation order with `harden-dictionary-data-pipeline`: make its single `build-extension-vnedict-json.js` owner emit revision metadata, or land that change first and extend the same builder here; record the chosen order without creating a competing generator
- [x] 1.2 Add failing characterization tests for the current runtime gaps: non-empty metadata-less databases are treated as current, `reload-db` commits `clear()` before replacement, ambient window messages can resize/populate, Shift posts to the frame itself, stale lookups can win, and `frame.jade` carries an inline controller copy
- [x] 1.3 Define stable runtime state/error codes and documented remedies for current, refreshed, stale, unavailable, metadata, payload, digest, and transaction failures

## 2. Deterministic shipped-dictionary identity

- [x] 2.1 Extend the runtime-dictionary transform/build tests with exact-byte SHA-256 revision, schema-version, entry-count, deterministic rerun, and changed-content fixtures
- [x] 2.2 Update the single runtime-dictionary builder to generate `zd-extension/js/vnedict.meta.json` from the exact `vnedict.json` bytes in the same build operation, using the shared atomic-write primitive from the data-pipeline change
- [x] 2.3 Regenerate and include `zd-extension/js/vnedict.json` plus `vnedict.meta.json`; independently verify the sidecar hash and count against the generated runtime array
- [x] 2.4 Update `Makefile`, `docs/build.md`, and `docs/dictionary-data.md` so every runtime dictionary rebuild also produces/verifies the sidecar and no manual metadata step exists
- [ ] 2.5 Make runtime JSON and metadata publication failure-atomic as a pair, with an injected second-publication failure test proving the previous matching pair remains intact

## 3. Shared transactional refresh coordinator

- [x] 3.1 Add dependency-free failing tests for metadata/payload validation, current-versus-stale decisions, metadata-less migration, force refresh, single-in-flight coalescing, and stable state/error results using in-memory adapters
- [x] 3.2 Add failing transaction-adapter tests proving fetch/parse/shape/count/digest failures perform no write and a controlled failure after clear aborts entries and metadata together
- [x] 3.3 Implement a plain JavaScript `zd-dictionary-runtime` module with browser global plus guarded CommonJS export, injected fetch/crypto/database/status adapters, and the exact coordinator state machine until 3.1–3.2 pass
- [x] 3.4 Add reduced-validation coverage for contexts without `crypto.subtle`, requiring sidecar count and entry-shape agreement and marking the result explicitly rather than silently claiming digest verification
- [ ] 3.5 Preserve force semantics when `ensureReady({force:true})` arrives during an ordinary in-flight readiness call, with a regression test proving a replacement occurs exactly once

## 4. Extension and website database integration

- [x] 4.1 Upgrade the extension Dexie schema with a revision metadata store and an adapter whose replacement uses one transaction across `entries` and metadata, preserving old version-2 entries until a candidate is validated
- [x] 4.2 Route extension install/update, search readiness, and forced `reload-db` through one coordinator instance; return structured errors from every async message branch and prevent unhandled `chrome.runtime.lastError` noise when tabs lack a content script
- [x] 4.3 Add extension popup loading/current/refreshed/stale/unavailable feedback and disable or re-enable reload controls consistently around the forced refresh result
- [x] 4.4 Load the shared runtime module on `popupdict.jade`, upgrade the website Dexie schema/adapter, and replace its non-zero-count/XHR startup with coordinator readiness and visible retryable stale/error status
- [x] 4.5 Regenerate `popupdict.html` if markup/script ordering changed and add structural tests for shared-module load order in the service worker and website

## 5. Private popup-frame protocol

- [x] 5.1 Add failing validator tests for protocol version/type, dictionary result bounds and shape, allowed dialects, no-payload lock commands, finite non-negative resize fields, and hard dimension limits
- [x] 5.2 Implement one browser/CommonJS popup-protocol definition consumed by `showframe.js` and `frame.js`, with closed message types and pure validators
- [x] 5.3 Add failing fake-window/port tests for one-time `MessageChannel` transfer, rejection of second initialization, closure of old sessions, and inert ambient `window.postMessage` traffic
- [x] 5.4 Refactor `ResultFrame` to create/own/close the channel, send populate/lock commands on its retained port, accept only validated resize/toggle replies, and clamp geometry before touching iframe styles
- [x] 5.5 Refactor the sandbox frame to bind the transferred port once, remove recurring ambient window-message handling, validate before rendering, and send resize plus Shift `toggle-lock` replies on the bound port
- [x] 5.6 Add tests proving dictionary-controlled values remain Handlebars-escaped and malformed/oversized traffic cannot change popup DOM, pin state, or parent frame geometry

## 6. Non-clobbering lifecycle and latest-wins lookup

- [x] 6.1 Add reusable fake-event-target tests for loading/already-ready/double-call initialization and a structural assertion that first-party browser sources assign no `window.onload` property
- [x] 6.2 Replace `window.onload` in extension content/popup and website pronunciation/popup/guide entry points with idempotent ready-state-aware additive initialization, keeping DOM creation at the correct readiness boundary
- [x] 6.3 Add failing extension and website lookup-controller tests where an older result resolves last, a miss/error is retried, and scroll/resize/mouseout/disable invalidates an in-flight request
- [x] 6.4 Implement request epochs and suppression cleanup in `zd-extension/js/content.js` and `js/popupdict.js`; ensure stale callbacks/promises cannot highlight, populate, show, or reset current state

## 7. Source ownership, permissions, and generated artifacts

- [x] 7.1 Replace the inline controller in `zd-extension/frame.jade` with `script(src="js/frame.js")`, regenerate `frame.html`, and add a structural test that both files reference the single runtime while Jade contains no controller identifiers
- [x] 7.2 Remove unused `tabs`, `activeTab`, and unmatched host permissions from `zd-extension/manifest.json`, retaining `storage` and existing content-script match behavior
- [x] 7.3 Add a manifest contract test mapping every declared named/host permission to an enumerated first-party API/resource need and failing on an undocumented future permission
- [x] 7.4 Syntax-check all changed browser modules directly and rebuild any affected committed HTML/CSS/userscript artifact from its documented source, confirming unrelated generated files remain byte-identical

## 8. Verification and rollout

- [x] 8.1 Run focused popup-runtime tests and `make verify`, confirming all existing suites plus new state/protocol/structure tests pass without network, Chrome, full-dictionary fixtures, or repository-data mutation
- [x] 8.2 With `pug` available, compile all documented Jade pages to a temporary directory and compare with committed HTML; either fix every runtime-related drift or record unrelated pre-existing drift separately
- [x] 8.3 Test the website as a first visit, current revisit, metadata-less upgrade, new-revision refresh, forced reload, failed refresh with stale fallback, failed first run, rapid pointer movement, Shift lock, and retry; cover `file://` explicitly if it remains supported. (deferred: the in-app browser denied access to the local test URL; state, rollback, latest-wins, file-protocol fallback, Shift routing, and retry contracts are covered by automated tests but still need operator UI confirmation) (operator-only)
- [x] 8.4 Load the unpacked extension and repeat install/update/current/forced/failure and rapid-lookup flows; confirm ambient hostile `postMessage` payloads cannot populate, resize, or lock the card and Shift inside the frame toggles the parent state. (deferred: local browser access was denied, so loading an unpacked extension or using another browser surface would bypass the environment's explicit decision; protocol and lifecycle behavior are covered by automated tests) (operator-only)
- [x] 8.5 Inspect Chrome's permission UI and runtime console after manifest cleanup, confirm tab broadcast failures are handled, then record manual-browser evidence and any environment-only deferral in this change before archive. (deferred: Chrome UI and runtime-console access are unavailable after local browser permission was denied; manifest permission mapping and runtime.lastError consumption are covered structurally) (operator-only)

## Verification notes

- `make rebuild-userscripts` produced the same SHA-256 bytes for both committed userscripts.
- Temporary Pug builds of all documented website and extension Jade pages matched their committed HTML byte-for-byte.
- The attempted browser visit to `http://127.0.0.1:8765/popupdict.html` was denied by the browser environment. No alternate browser-control surface was used; tasks 8.3–8.5 retain accurate operator-only deferrals.
