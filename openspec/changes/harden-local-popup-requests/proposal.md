## Why

The local popup can send a successful `GM_xmlhttpRequest` to the reader server yet remain permanently pending when its userscript-manager execution context is invalidated: no load, error, or timeout callback runs, controls stay disabled, and candidates from a previous term remain visible. This was reproduced on V2EX with `nhân dân tệ`: the server returned 20 candidates headed by `人民幣`, while the modal retained 30 candidates for an earlier term until the page was reloaded.

## What Changes

- Add a client-owned deadline around every local HTTP request so dropped userscript-manager callbacks cannot leave a Promise pending forever; ignore callbacks arriving after settlement.
- Treat transport failure separately from a legitimate empty candidate result and show actionable reload guidance in the modal.
- Clear the prior term's candidate list, autofill marker, and generated field value as soon as a new term is opened or entered.
- Guarantee that Notes refresh and form controls return to an enabled state after success, server error, callback loss, or timeout.
- Add deterministic runtime tests for callback loss, late callbacks, stale-state clearing, and successful candidate autofill.
- Document the stale-context recovery behavior and rebuild the generated local popup userscript.

## Capabilities

### New Capabilities

- `local-popup-request-resilience`: Defines bounded request settlement, stale-state isolation, visible failure recovery, and control restoration for the popup userscript's local reader-server integration.

### Modified Capabilities

None.

## Impact

- Affected source: `scripts/userscript/popupdict-local.runtime.js` and `docs/local-mode.md`.
- Affected tests: a focused Node runtime test under `test/`, plus existing userscript structure/build verification.
- Generated output: `zoopdog-popupdict-local.user.js` is rebuilt for local installation; the GitHub-hosted popup and Nôm-ruby userscripts retain their existing behavior.
- Server APIs and response formats remain unchanged; no dependency is added.
