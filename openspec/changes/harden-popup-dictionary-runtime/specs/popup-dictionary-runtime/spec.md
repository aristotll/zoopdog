## ADDED Requirements

### Requirement: Shipped dictionary has a deterministic identity
The build that produces `zd-extension/js/vnedict.json` SHALL also produce a committed sidecar containing a schema version, SHA-256 revision of the exact runtime JSON bytes, and entry count. Identical dictionary input SHALL produce byte-identical dictionary and metadata outputs, and the website and extension SHALL use that identity to decide whether installed data is current.

#### Scenario: Unchanged data keeps the same revision
- **WHEN** the runtime dictionary builder runs twice against unchanged source data
- **THEN** both generated files are byte-identical and the sidecar revision equals the SHA-256 of `vnedict.json`

#### Scenario: Dictionary content changes
- **WHEN** any entry in the generated runtime dictionary changes
- **THEN** the generated revision changes and the sidecar entry count matches the generated array length

#### Scenario: Sidecar publication fails
- **WHEN** the builder cannot publish either the runtime dictionary or its metadata sidecar
- **THEN** it leaves the previously committed matching pair intact and never exposes a new payload with old or missing metadata

### Requirement: Browser clients refresh by revision, not row presence
The extension and website SHALL compare the shipped dictionary identity with the metadata of their IndexedDB entries before declaring the dictionary current. A non-empty database with missing, different, or internally inconsistent revision metadata SHALL be treated as stale and refreshed before current data is reported.

#### Scenario: Returning client already has the shipped revision
- **WHEN** stored revision/schema/count metadata matches the sidecar and the live row count
- **THEN** the client serves lookups without rebuilding the entries table

#### Scenario: Existing database predates revision metadata
- **WHEN** a returning client has dictionary rows but no accepted revision metadata
- **THEN** the client performs a one-time refresh instead of treating a non-zero count as current

#### Scenario: Extension update ships a new dictionary
- **WHEN** the packaged sidecar revision differs from the revision stored by an existing extension installation
- **THEN** the extension refreshes IndexedDB before reporting the new revision ready

### Requirement: Dictionary replacement is transactional
Both browser clients SHALL fetch, parse, and validate candidate metadata and dictionary data before mutation, then replace entries and accepted metadata in one IndexedDB transaction. A failed fetch, parse, validation, clear, add, count check, or metadata write MUST leave the previously committed entries and revision usable.

#### Scenario: Download or parse fails
- **WHEN** a refresh cannot fetch or parse a valid candidate dictionary
- **THEN** no IndexedDB mutation begins and the previous entries and metadata remain unchanged

#### Scenario: Write fails after clear is requested
- **WHEN** any write in the replacement transaction fails after the transaction has cleared its working entries table
- **THEN** the transaction aborts and the previously committed entries and metadata are restored by IndexedDB

#### Scenario: Manual reload is forced
- **WHEN** the user requests `reload-db` while the shipped revision equals the stored revision
- **THEN** the client still validates and transactionally replaces the database, returning success only after count and metadata checks pass

### Requirement: Dictionary readiness is coordinated and observable
Install, update, manual reload, website startup, and search SHALL use one refresh coordinator per browser context. The coordinator SHALL coalesce concurrent refreshes and return exactly one of `ready-current`, `ready-refreshed`, `ready-stale`, or `unavailable`, including revision/count when available and a stable error code plus remedy on failure.

#### Scenario: Searches arrive during first refresh
- **WHEN** multiple searches and a startup hook request readiness while one refresh is in flight
- **THEN** they await the same refresh operation and no duplicate clear/populate transaction starts

#### Scenario: Forced reload arrives during ordinary readiness
- **WHEN** a forced reload is requested while a non-forced readiness check is in flight
- **THEN** the forced caller does not resolve as `ready-current` without a replacement and exactly one forced refresh runs after or supersedes the ordinary check

#### Scenario: Refresh fails with validated prior data
- **WHEN** a new revision cannot be installed but the previous revision and row count remain internally valid
- **THEN** lookups remain available from the previous data and callers receive `ready-stale` with a retry remedy

#### Scenario: First run has no usable data
- **WHEN** refresh fails and no previously validated database exists
- **THEN** searches return `unavailable` and the extension popup or website shows a failure message instead of remaining indefinitely in a loading state

### Requirement: Popup frame uses a private validated channel
After iframe load, the parent controller SHALL create a versioned `MessageChannel`, transfer one port to the sandbox exactly once, and use that port for all subsequent popup traffic. The sandbox SHALL accept no second initializer and both endpoints SHALL ignore messages with an unknown type, wrong protocol version, invalid dictionary result shape, unknown dialect, or invalid dimensions.

#### Scenario: Legitimate session populates and resizes
- **WHEN** the owned frame receives a valid initialization port and valid `populate` data
- **THEN** it renders escaped dictionary results and returns a bounded `resize` message on the same port

#### Scenario: Host page sends ambient window messages
- **WHEN** arbitrary page code posts `populate`, `resize`, `lock`, or malformed data through `window.postMessage`
- **THEN** neither popup DOM, lock state, nor iframe geometry changes

#### Scenario: Old session speaks after frame reload
- **WHEN** a frame is reloaded or replaced and a message arrives on its prior port
- **THEN** the message is ignored and only the newly initialized channel can mutate popup state

#### Scenario: Dimensions are hostile
- **WHEN** a resize payload contains negative, non-finite, missing, string, or over-limit dimensions
- **THEN** it is rejected or clamped to documented safe bounds before any iframe style changes

### Requirement: Frame lock control is bidirectional
Lock, unlock, and toggle-lock events SHALL travel through the private popup channel and keep the parent controller, highlighter, and sandbox pin indicator in one state. Pressing Shift while focus is inside the frame SHALL notify the parent rather than posting an unhandled message to the frame itself.

#### Scenario: Shift is pressed inside the popup frame
- **WHEN** the popup frame is visible and receives a Shift keydown
- **THEN** it sends `toggle-lock` to the parent on the private channel and both frame and parent show the resulting lock state

#### Scenario: Frame is removed while locked
- **WHEN** a locked frame is invalidated or removed
- **THEN** its channel is closed and no later message from it can toggle the replacement frame or highlighter

### Requirement: Browser initialization is additive and idempotent
First-party website and extension runtime sources SHALL NOT assign `window.onload` or another global event-handler property. Each entry point SHALL initialize exactly once by checking document readiness and, when needed, registering an additive one-shot readiness listener.

#### Scenario: Script runs while the document is loading
- **WHEN** an entry point loads before its required DOM exists
- **THEN** it initializes once on the documented readiness event without replacing any handler registered by the host page or another script

#### Scenario: Script runs after readiness
- **WHEN** an entry point loads after the readiness event has already fired
- **THEN** it initializes immediately and does not wait for an event that will never repeat

#### Scenario: Initializer is invoked twice
- **WHEN** startup paths call the same initializer more than once
- **THEN** only one set of DOM nodes, listeners, and database startup work is created

### Requirement: Only the newest lookup may update the popup
The extension and website lookup controllers SHALL assign a monotonically changing request epoch to asynchronous lookups and SHALL update highlights or popup content only when a response belongs to the current epoch. Misses, failures, pointer invalidation, disable, scroll, resize, and hide SHALL invalidate pending work and release word-suppression state.

#### Scenario: Older response arrives last
- **WHEN** lookup A starts, lookup B starts for a newer pointer position, and A resolves after B
- **THEN** A performs no highlight, populate, show, or suppression-state mutation

#### Scenario: Lookup returns no result
- **WHEN** a word lookup completes with no result or an error
- **THEN** the word is not suppressed indefinitely and a later intentional lookup of that word can run

#### Scenario: Popup is invalidated during lookup
- **WHEN** the page scrolls, resizes, disables Zoopdog, or the pointer leaves before a lookup resolves
- **THEN** the response cannot reopen or repopulate the hidden popup

### Requirement: Frame runtime has one authoritative source
`zd-extension/js/frame.js` SHALL be the only implementation of the sandbox frame controller. `zd-extension/frame.jade` and generated `frame.html` SHALL load that file, and neither SHALL embed a second copy of its message, render, resize, or lock logic.

#### Scenario: Jade source is inspected
- **WHEN** structural verification scans `frame.jade`
- **THEN** it finds the external `js/frame.js` reference and no inline frame-controller implementation

#### Scenario: Extension page is regenerated
- **WHEN** `frame.jade` is compiled with the documented Pug command
- **THEN** the resulting `frame.html` still loads `js/frame.js` and runtime behavior does not revert to a stale inline copy

### Requirement: Extension manifest follows least privilege
The extension manifest SHALL declare only named and host permissions that have an enumerated first-party API or resource need. Using `chrome.tabs` methods without reading sensitive tab fields SHALL NOT by itself retain the `tabs` permission, and unused temporary host or host-origin grants SHALL be removed.

#### Scenario: Current API usage is audited
- **WHEN** verification maps manifest permissions to first-party extension source usage
- **THEN** `storage` remains justified while unused `tabs`, `activeTab`, and unmatched host permissions are absent

#### Scenario: New permission is introduced
- **WHEN** a future change adds a named or host permission
- **THEN** structural verification requires a documented usage mapping and fails if none exists

### Requirement: Popup runtime contracts are verified
Dependency-free automated tests SHALL exercise refresh decisions and rollback, readiness coalescing, message initialization/validation, non-clobbering startup, latest-lookup-wins behavior, source/generated ownership, and manifest permissions. Real-browser verification SHALL cover both the static website and unpacked extension before the change is marked complete.

#### Scenario: Automated verification runs
- **WHEN** a maintainer runs `make verify`
- **THEN** all popup runtime contract tests run without network access, the full dictionary, Chrome, or writes to repository data files

#### Scenario: Hostile message test runs in Chrome
- **WHEN** the unpacked extension is exercised on a page that sends malformed ambient popup messages
- **THEN** normal lookup still works and the hostile messages cannot change popup content, lock state, or dimensions

#### Scenario: Refresh rollback is exercised in both surfaces
- **WHEN** manual browser verification simulates an unavailable or malformed replacement after a valid database exists
- **THEN** both website and extension continue serving the prior dictionary and show a retryable stale/error state
