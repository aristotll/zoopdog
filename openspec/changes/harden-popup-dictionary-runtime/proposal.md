## Why

The repository now verifies its build-time dictionary tooling well, but the popup dictionary runtime can still serve stale or no data and trusts unauthenticated iframe messages on every matched page. This becomes urgent before the proposed `harden-dictionary-data-pipeline` change ships a corrected runtime dictionary: existing extension and website IndexedDB databases currently skip that new asset once they contain any rows.

## What Changes

- Add a deterministic revision contract for the shipped runtime dictionary and make both the extension and website compare that revision with their installed IndexedDB state before serving lookups.
- Replace destructive reloads with validated, transactional database replacement: fetch and validate the complete candidate payload first, then clear and repopulate inside one transaction so a failed download, parse, or write leaves the previous dictionary usable.
- Make install, update, manual reload, and returning-website behavior converge on the same refresh state machine, with structured success/failure results and visible popup/page feedback instead of silent callback failures.
- Define a typed popup-frame message protocol that rejects malformed payloads, accepts resize replies only from the owned iframe window, and uses a per-frame session handshake because Chrome sandbox pages have a unique origin and therefore cannot rely on a fixed `targetOrigin` alone.
- Replace `window.onload` assignments with additive, ready-state-aware initialization; make lookup responses sequence-aware so an older asynchronous response cannot overwrite the word currently under the pointer; and reset suppression state after misses and errors.
- Make `zd-extension/frame.jade` load `js/frame.js`, eliminating the stale inline copy that would return if the Jade source were recompiled, and fix Shift lock/unlock to message the parent rather than the frame itself.
- Add dependency-free `node:test` coverage for dictionary refresh decisions/rollback, message validation and source/session checks, initialization, stale lookup suppression, and source/generated structural contracts; keep browser verification steps for the real extension and website.
- Remove extension permissions that remain unused after the runtime refactor, subject to a usage-backed manifest test.

## Capabilities

### New Capabilities

- `popup-dictionary-runtime`: Defines shipped-dictionary freshness and transactional replacement, the popup iframe communication boundary, non-clobbering initialization, latest-lookup-wins behavior, user-visible failure handling, least-privilege manifest requirements, and verification across the extension and website popup surfaces.

### Modified Capabilities

(none)

## Impact

- Affected extension code: `zd-extension/js/background.js`, `content.js`, `showframe.js`, `frame.js`, `popup.js`, `frame.jade`, generated `frame.html`, and `manifest.json`.
- Affected website code: `js/popupdict.js` and `popupdict.jade`/generated `popupdict.html` if status UI or runtime metadata loading changes.
- Affected generated data/tooling: the proposed runtime-dictionary builder will also emit deterministic revision metadata consumed by both IndexedDB clients; implementation should be sequenced with or immediately after `harden-dictionary-data-pipeline` to avoid competing edits.
- Affected verification: new browser-runtime unit/structural tests, `make verify`, source/generated compilation checks when `pug` is available, plus manual unpacked-extension and website tests.
- No framework, bundler, transpiler, npm dependency, remote service, or dictionary schema migration is introduced. Existing stored data is replaced in place only after validation succeeds.
