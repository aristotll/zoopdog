# Harden Popup Dictionary Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship revision-aware, failure-safe dictionary loading and a private validated popup-frame protocol across the Chrome extension and static website.

**Architecture:** A deterministic builder emits `vnedict.json` plus a SHA-256/count sidecar. A browser/CommonJS refresh coordinator drives both Dexie clients through injected adapters and an all-or-nothing transaction. A browser/CommonJS popup protocol validates a one-time transferred `MessageChannel`; readiness helpers and lookup epochs make lifecycle and async UI updates deterministic.

**Tech Stack:** Plain JavaScript, Node.js `node:test`, Node.js `crypto/fs/path`, Dexie 2.x, Manifest V3 service worker/content scripts, Jade/Pug generated HTML, Make.

**Execution note:** Work inline in this task. Do not create commits unless the user separately requests them; use focused test runs and `git diff` as checkpoints.

---

### Task 1: Runtime dictionary builder and sidecar

**Files:**
- Create: `scripts/lib/fsutil.js`
- Create: `scripts/build-extension-vnedict-json.js`
- Create: `test/popup-runtime.test.js`
- Create: `zd-extension/js/vnedict.meta.json`
- Modify: `scripts/lib/paths.js`
- Modify: `Makefile`
- Modify: `docs/build.md`
- Modify: `docs/dictionary-data.md`

- [ ] **Step 1: Write failing builder tests**

Test `serializeRuntimeDictionary(entries)` returns compact JSON, and `buildMetadata(json)` returns `{schemaVersion: 1, revision: sha256(json), entryCount}`. Assert deterministic reruns and changed revisions.

- [ ] **Step 2: Verify RED**

Run: `node --test test/popup-runtime.test.js --test-name-pattern='runtime dictionary'`
Expected: FAIL because `scripts/build-extension-vnedict-json.js` does not exist.

- [ ] **Step 3: Implement builder and atomic write**

Implement CommonJS exports with a guarded CLI:

```js
function serializeRuntimeDictionary(entries) {
  return JSON.stringify(entries.map(normalizeEntry));
}
function buildMetadata(json) {
  return {
    schemaVersion: 1,
    revision: createHash('sha256').update(json).digest('hex'),
    entryCount: JSON.parse(json).length,
  };
}
```

Use one shared `atomicWrite(target, content)` implementation and write JSON before its sidecar.

- [ ] **Step 4: Verify GREEN and regenerate**

Run focused tests, then `make rebuild-extension-vnedict-json`. Independently hash/count the generated files with Node.

### Task 2: Shared refresh coordinator

**Files:**
- Create: `zd-extension/js/zd-dictionary-runtime.js`
- Modify: `test/popup-runtime.test.js`

- [ ] **Step 1: Write failing validation/state tests**

Cover metadata schema/hash/count, entry shape, current/stale decisions, forced refresh, unavailable versus stale fallback, no-Web-Crypto validation, and stable error codes/remedies.

- [ ] **Step 2: Verify RED**

Run: `node --test test/popup-runtime.test.js --test-name-pattern='coordinator|metadata|payload'`
Expected: FAIL because refresh exports are absent.

- [ ] **Step 3: Implement minimal browser/CommonJS module**

Expose `validateMetadata`, `parseDictionary`, `createCoordinator`, `STATES`, and `ERRORS`. `ensureReady({force})` fetches sidecar, checks stored state, validates the payload before `adapter.replace`, coalesces one in-flight promise, and returns structured state.

- [ ] **Step 4: Verify GREEN and rollback behavior**

Use an in-memory transactional adapter that snapshots entries/metadata and restores them on controlled failure; assert zero mutation for pre-transaction errors.

### Task 3: Extension and website database adapters

**Files:**
- Modify: `zd-extension/js/background.js`
- Modify: `zd-extension/js/popup.js`
- Modify: `zd-extension/popup.jade`
- Modify: `zd-extension/popup.html`
- Modify: `js/popupdict.js`
- Modify: `popupdict.jade`
- Modify: `popupdict.html`
- Modify: `test/popup-runtime.test.js`

- [ ] **Step 1: Write failing structure/adapter tests**

Assert Dexie version 3 defines `metadata: '&key'`, replacement uses one transaction over both stores, the service worker loads the coordinator before use, and website Jade/HTML load it before `popupdict.js`.

- [ ] **Step 2: Verify RED**

Run the focused structure tests; expect missing metadata store/module ordering failures.

- [ ] **Step 3: Integrate the coordinator**

Create `createDexieAdapter(db)` with:

```js
replace(entries, metadata) {
  return db.transaction('rw', db.entries, db.metadata, async () => {
    await db.entries.clear();
    await db.entries.bulkAdd(entries);
    await db.metadata.put({...metadata, key: 'dictionary'});
    if (await db.entries.count() !== metadata.entryCount) throw runtimeError('transaction');
  });
}
```

Make install/update/search/manual reload await a single coordinator. Add visible status nodes and retry feedback to both popup surfaces.

- [ ] **Step 4: Verify GREEN**

Run adapter/structure tests and direct syntax checks for background, popup, and website code.

### Task 4: Popup protocol and MessageChannel

**Files:**
- Create: `zd-extension/js/zd-popup-protocol.js`
- Modify: `zd-extension/js/showframe.js`
- Modify: `zd-extension/js/frame.js`
- Modify: `zd-extension/manifest.json`
- Modify: `zd-extension/frame.jade`
- Modify: `zd-extension/frame.html`
- Modify: `popupdict.jade`
- Modify: `popupdict.html`
- Modify: `test/popup-runtime.test.js`

- [ ] **Step 1: Write failing protocol tests**

Test closed message types, dialect/result limits, escaped Handlebars data, finite/clamped dimensions, one initializer, old-port closure, and ambient window-message inertness.

- [ ] **Step 2: Verify RED**

Run protocol-focused tests; expect missing module/MessageChannel behavior.

- [ ] **Step 3: Implement the pure protocol**

Expose `PROTOCOL_VERSION`, `MAX_RESULTS`, `FRAME_BOUNDS`, `validateParentMessage`, `validateFrameMessage`, and `clampDimensions` as browser globals/CommonJS exports.

- [ ] **Step 4: Refactor both endpoints**

`ResultFrame` creates a channel before iframe insertion, transfers `port2` on load, retains `port1`, and performs all later messaging on the port. `frame.js` accepts exactly one `zd:init` containing a port, removes the initializer, and handles populate/lock/Shift through the port.

- [ ] **Step 5: Verify GREEN**

Run protocol tests and structural assertions that no recurring `message` listener or wildcard operational `postMessage` remains outside the one-time transfer.

### Task 5: Lifecycle and latest-wins lookups

**Files:**
- Create: `zd-extension/js/zd-browser-runtime.js`
- Modify: `zd-extension/js/content.js`
- Modify: `zd-extension/js/popup.js`
- Modify: `js/popupdict.js`
- Modify: `js/zd-pron.js`
- Modify: `zd-extension/js/zd-pronguide.js`
- Modify: `test/popup-runtime.test.js`

- [ ] **Step 1: Write failing readiness/epoch tests**

Test loading versus already-ready initialization, double invocation, older lookup resolving last, miss/error retry, and scroll/resize/mouseout/disable invalidation.

- [ ] **Step 2: Verify RED**

Run lifecycle-focused tests; expect missing helper/epoch exports.

- [ ] **Step 3: Implement helpers**

Expose `runWhenReady(document, initialize)` with a closure guard and `createLatestTask()` returning `begin`, `invalidate`, and `isCurrent`.

- [ ] **Step 4: Integrate entry points and lookups**

Replace all first-party `window.onload =` assignments. Capture an epoch before each async lookup step; check it before highlight/populate/show; invalidate on hide events and clear suppression on misses/errors.

- [ ] **Step 5: Verify GREEN**

Run tests and `rg -n 'window\.onload\s*=' js zd-extension/js -g '!**/lib/**'`, expecting no matches.

### Task 6: Source/generated ownership and least privilege

**Files:**
- Modify: `zd-extension/frame.jade`
- Modify: `zd-extension/frame.html`
- Modify: `zd-extension/manifest.json`
- Modify: `test/popup-runtime.test.js`

- [ ] **Step 1: Write failing source/manifest tests**

Assert Jade/HTML load `zd-popup-protocol.js` and `frame.js`, Jade has no controller identifiers, manifest keeps only `storage`, and each declared permission has a fixed usage mapping.

- [ ] **Step 2: Verify RED**

Run structure tests; expect inline Jade and excess permission failures.

- [ ] **Step 3: Update source before generated output**

Replace the Jade inline controller with external scripts, make matching targeted HTML edits if Pug is unavailable, and remove `tabs`, `activeTab`, and unmatched host permissions.

- [ ] **Step 4: Verify GREEN**

Run structure tests and compare Pug output in a temporary directory if the CLI exists.

### Task 7: Full verification and OpenSpec closure

**Files:**
- Modify: `openspec/changes/harden-popup-dictionary-runtime/tasks.md`
- Modify: `openspec/changes/harden-popup-dictionary-runtime/design.md` only if implementation decisions differ

- [ ] **Step 1: Run focused and full automated verification**

Run `node --test test/popup-runtime.test.js`, `make verify`, `make check-openspec`, and OpenSpec strict validation.

- [ ] **Step 2: Run browser verification where available**

Serve the static site locally and use the in-app browser for first/current/stale/failed reload and rapid pointer cases. Load the unpacked extension only if the current browser profile permits it; otherwise record the exact operator-only deferral.

- [ ] **Step 3: Review diff and generated assets**

Run `git diff --check`, `git status --short`, independent metadata hash/count verification, and confirm generated userscripts remain byte-identical.

- [ ] **Step 4: Mark only evidence-backed OpenSpec tasks complete**

Check automated tasks immediately after their proof. Mark browser-only tasks complete only with observed evidence; otherwise add explicit `(deferred: ...)` markers consistent with the repository lifecycle rules.
