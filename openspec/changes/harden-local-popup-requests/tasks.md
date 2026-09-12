## 1. Regression Harness

- [ ] 1.1 Add `test/popup-local-runtime.test.js` with a Node `vm` harness that evaluates the local runtime's request and modal functions without adding dependencies.
- [ ] 1.2 Add tests proving a request rejects when all `GM_xmlhttpRequest` callbacks are dropped, resolves normally on success, rejects synchronous startup errors, and ignores callbacks arriving after settlement.
- [ ] 1.3 Add tests proving opening or editing a Vietnamese term immediately removes the previous datalist options, generated Nôm value, and autofill marker while the existing race guard rejects an older response.
- [ ] 1.4 Add tests distinguishing a successful empty candidate response from transport failure and proving Notes refresh is re-enabled after both success and timeout.
- [ ] 1.5 Run the focused tests before production edits and confirm each new case fails for the missing resilience behavior rather than a fixture or syntax error.

## 2. Bounded Local Transport

- [ ] 2.1 Define one local request timeout constant and add a JavaScript watchdog around `GM_xmlhttpRequest` that does not depend on userscript-manager callbacks.
- [ ] 2.2 Route load, error, manager timeout, watchdog timeout, and synchronous request-start exceptions through a settle-once helper that cancels the watchdog and ignores late outcomes.
- [ ] 2.3 Preserve transport rejection through candidate helpers instead of converting it into an empty candidate array.
- [ ] 2.4 Run the focused transport tests and confirm they pass.

## 3. Term State and Recovery UI

- [ ] 3.1 Add a single helper that clears the Nôm datalist, generated Nôm value, and autofill marker for the current modal.
- [ ] 3.2 Invoke the clearing helper synchronously both when opening the modal for a term and when its Vietnamese term changes, before debounce or network activity.
- [ ] 3.3 Handle initial candidate and Notes transport failures at the modal boundary by preserving legitimate empty-result behavior and showing concise guidance to reload the page and try again.
- [ ] 3.4 Make Notes refresh restoration unconditional after success, server failure, callback loss, or watchdog timeout.
- [ ] 3.5 Run all focused local-popup runtime tests and confirm they pass without warnings.

## 4. Documentation, Build, and Verification

- [ ] 4.1 Update `docs/local-mode.md` to explain the client-owned deadline, stale-state clearing, visible recovery message, and why automatic retries are intentionally avoided.
- [ ] 4.2 Run `node --check scripts/userscript/popupdict-local.runtime.js` and `node scripts/build-popupdict-userscript.js`; confirm the local generated userscript changes and the hosted variant retains no local grant/runtime.
- [ ] 4.3 Run `make verify` and resolve every failure attributable to this change.
- [ ] 4.4 Reload `https://www.v2ex.com/t/1241455` for a fresh userscript context and verify through CDP that `nhân dân tệ` autofills `人民幣`, exposes all returned candidates, and fills the Notes draft.
- [ ] 4.5 Review `git status --short` and the scoped diff, preserving all pre-existing user changes and leaving the work uncommitted for review.
