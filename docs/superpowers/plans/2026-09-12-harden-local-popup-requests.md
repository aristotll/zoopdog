# Harden Local Popup Requests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the local popup userscript recover predictably when userscript-manager request callbacks are lost, without leaking state between Vietnamese terms.

**Architecture:** Add a small settle-once request wrapper with a client watchdog in the local runtime. Keep request failures distinct from legitimate empty candidate responses until they reach the modal UI, where generated state is cleared and actionable recovery text is shown. Test the fragment in Node with a VM and minimal DOM/request doubles.

**Tech Stack:** Plain JavaScript, Node built-in `node:test` and `vm`, Makefile userscript builder.

---

### Task 1: Establish the runtime regression harness

**Files:**
- Create: `test/popup-local-runtime.test.js`
- Test: `test/popup-local-runtime.test.js`

- [ ] **Step 1: Write focused failing tests** for dropped callbacks, normal success, startup exceptions, late callbacks, stale generated-state clearing, race protection, empty candidates, transport recovery, and Notes button restoration.
- [ ] **Step 2: Run `node --test test/popup-local-runtime.test.js`** and confirm failures describe absent resilience behavior, not an invalid harness.

### Task 2: Bound and normalize local transport outcomes

**Files:**
- Modify: `scripts/userscript/popupdict-local.runtime.js`
- Test: `test/popup-local-runtime.test.js`

- [ ] **Step 1: Add the failing transport tests** for watchdog expiry and settle-once late-callback suppression.
- [ ] **Step 2: Implement the minimal request timeout constant and settle-once watchdog wrapper.**
- [ ] **Step 3: Preserve rejected candidate and Notes transport requests through their helpers.**
- [ ] **Step 4: Run the focused transport tests** and confirm they pass.

### Task 3: Isolate modal term state and recover controls

**Files:**
- Modify: `scripts/userscript/popupdict-local.runtime.js`
- Test: `test/popup-local-runtime.test.js`

- [ ] **Step 1: Add failing tests** for clearing candidates, generated Nôm, and the autofill marker at open/edit boundaries and for failure UI/control recovery.
- [ ] **Step 2: Implement one generated-state clearing helper and invoke it synchronously before debounce/network work.**
- [ ] **Step 3: Handle candidate and Notes request rejection at the modal boundary with reload guidance and unconditional button restoration.**
- [ ] **Step 4: Run the focused runtime tests** and confirm they pass without warnings.

### Task 4: Document, rebuild, and verify

**Files:**
- Modify: `docs/local-mode.md`
- Modify: `zoopdog-popupdict-local.user.js` (generated, ignored)
- Modify: `openspec/changes/harden-local-popup-requests/tasks.md`

- [ ] **Step 1: Document** the client deadline, immediate stale-state clearing, recovery guidance, and intentional lack of automatic retries.
- [ ] **Step 2: Run** `node --check scripts/userscript/popupdict-local.runtime.js` and `node scripts/build-popupdict-userscript.js`; inspect that only the local output includes local runtime/grants.
- [ ] **Step 3: Run** `make verify` and resolve change-attributable failures.
- [ ] **Step 4: Perform the requested live V2EX/CDP verification if the page and a fresh userscript context are available; otherwise report it as an environmental blocker.**
- [ ] **Step 5: Review** `git status --short` and scoped diffs, leaving changes uncommitted for review.
