## Context

The local popup runtime uses callback-style `GM_xmlhttpRequest` to reach `http://127.0.0.1:8770`. Its Promise currently settles only from `onload`, `onerror`, or the userscript manager's `ontimeout`. In the observed invalidated Violentmonkey context, the browser sent each request and the server completed it, but none of those callbacks ran. The Promise therefore remained pending indefinitely: the Notes refresh button stayed disabled, the initial suggestion flow never reached its continuation, and options belonging to an earlier term remained in the reused modal.

The runtime is a plain JavaScript fragment concatenated into the generated local popup userscript. The hosted userscript intentionally has no local-server integration. Zoopdog has no package dependencies or browser test framework, so focused tests must use Node's built-in test and VM facilities.

## Goals / Non-Goals

**Goals:**

- Bound every local request even if the userscript manager drops all callbacks.
- Ensure each request settles at most once and late callbacks cannot mutate completed state.
- Keep candidate UI state tied to the currently displayed Vietnamese term.
- Distinguish a valid empty lookup from a transport failure and tell the user how to recover.
- Restore disabled controls after every terminal outcome.
- Preserve successful request latency and the existing reader-server API.

**Non-Goals:**

- Automatically reload a third-party page or restart/reinstall a userscript manager.
- Retry requests after an invalidated extension context; the same broken context cannot reliably complete a retry.
- Change the reader server, its routes, candidate ranking, or Notes translation providers.
- Add local-mode behavior to the GitHub-hosted popup or the Nôm-ruby userscript.

## Decisions

### Add a caller-owned settlement deadline

`zooHttpRequest` will start a normal JavaScript timer in addition to passing `timeout` to `GM_xmlhttpRequest`. A single settlement helper will clear the timer and resolve or reject only the first terminal outcome. The watchdog will fire shortly after the configured GM timeout, preserving the current eight-second request budget while covering the case where Violentmonkey never calls `ontimeout`.

Using only the returned value from `GM_xmlhttpRequest` was rejected because callback-style implementations are the cross-manager contract already used by this script, and an invalidated manager context cannot be assumed to return a working Promise. Automatic retries were rejected because the live failure affected every callback in that page context; retrying would repeat the request on the server without giving the UI a usable response.

### Preserve transport errors until a UI boundary

Candidate helpers will not turn transport failures into an indistinguishable empty array. Modal-level handlers will convert a legitimate successful response with zero candidates into normal empty state, while a rejected request will clear generated values and display concise guidance to reload the page. The Notes refresh handler will use the same distinction and will restore its button in a final continuation.

This keeps errors close to the control that initiated them and avoids a global alert or automatic page action.

### Reset term-derived state before starting asynchronous work

Opening the Nôm modal and editing its Vietnamese term will synchronously clear the candidate datalist, the generated Nôm autofill value and marker, previous transport status, and preview state. The existing race guard remains responsible for preventing an older completed request from filling a newer term.

Clearing only after the next response was rejected because it leaves stale options visible throughout latency and forever when callbacks are lost. Retaining a manually typed Nôm value after changing the Vietnamese key was also rejected because that value belongs to the previous key and is unsafe to save under the new one.

### Test the runtime fragment without a new dependency

A focused Node test will read the runtime fragment, evaluate the relevant functions in a `vm` context, and provide small DOM and `GM_xmlhttpRequest` doubles. Tests will cover callback loss, successful settlement, late callback suppression, immediate stale-state clearing, empty success, visible failure, and control restoration. Existing build and structure checks will continue to verify source/generated consistency.

## Risks / Trade-offs

- **Background-tab timer throttling can delay the watchdog beyond its nominal deadline.** → The request still becomes bounded once the browser schedules timers; foreground interaction receives the normal deadline.
- **A slow Notes provider could reach the client deadline.** → The GM request already uses the same eight-second timeout, so the watchdog adds recovery without shortening the established budget.
- **Reload guidance cannot repair unsaved form edits automatically.** → Clear only generated term-derived values, preserve user-authored Notes where safe, and never reload without consent.
- **A late callback may arrive after the watchdog.** → Route every terminal path through the settle-once helper and ignore subsequent callbacks.

## Migration Plan

1. Add focused failing runtime tests.
2. Implement bounded settlement and term-state reset in the local runtime source.
3. Update local-mode documentation.
4. Rebuild userscripts with `node scripts/build-popupdict-userscript.js`.
5. Run focused tests and `make verify`.
6. Reload the V2EX tab to obtain a fresh userscript context and verify `nhân dân tệ` displays `人民幣` plus the complete candidate list.

Rollback is source-only: revert the runtime, test, documentation, and generated local build together. No stored dictionary or server migration is involved.

## Open Questions

None.
