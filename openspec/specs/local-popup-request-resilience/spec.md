# local-popup-request-resilience

## Purpose

Canonical specification for the `local-popup-request-resilience` capability, promoted from change `harden-local-popup-requests`.

## Requirements

### Requirement: Local requests have a client-owned deadline
The local popup SHALL settle every reader-server request within the configured client deadline even when `GM_xmlhttpRequest` invokes none of its completion, error, or timeout callbacks.

#### Scenario: Userscript manager drops every callback
- **WHEN** a local request is sent and the userscript manager invokes no callback
- **THEN** the request Promise rejects with a timeout failure after the client-owned deadline

#### Scenario: Request succeeds before the deadline
- **WHEN** `GM_xmlhttpRequest` returns a successful JSON response before the deadline
- **THEN** the request Promise resolves with that decoded payload and cancels its watchdog

#### Scenario: Callback arrives after settlement
- **WHEN** any load, error, or timeout callback arrives after the request has already settled
- **THEN** the late callback MUST be ignored and MUST NOT mutate UI or Promise state

#### Scenario: Request creation throws
- **WHEN** `GM_xmlhttpRequest` throws synchronously while starting a request
- **THEN** the request Promise rejects through the same bounded settlement path

### Requirement: Candidate state belongs to one term
The local popup SHALL remove generated candidate state for the previous Vietnamese term before requesting candidates for a newly opened or edited term.

#### Scenario: Modal opens for a different term
- **WHEN** the Nôm modal is reused for a new Vietnamese term
- **THEN** the prior datalist options, generated Nôm value, and autofill marker are cleared before asynchronous requests begin

#### Scenario: Vietnamese term is edited
- **WHEN** the user edits the Vietnamese term in an open Nôm modal
- **THEN** the prior term's generated candidate state is cleared immediately, without waiting for the debounce or server response

#### Scenario: Older response completes last
- **WHEN** a request for an earlier term completes after a request has begun for a newer term
- **THEN** the earlier response MUST NOT populate the newer term's fields or datalist

### Requirement: Empty results and transport failures are distinct
The local popup SHALL present a successful lookup with zero candidates as an empty result and SHALL present a failed or timed-out lookup as a recoverable local-connection error.

#### Scenario: Dictionary has no candidates
- **WHEN** the server successfully returns an empty candidate array
- **THEN** the candidate field remains empty without displaying a transport-error message

#### Scenario: Local request fails
- **WHEN** candidate or Notes retrieval rejects or reaches the client deadline
- **THEN** the modal clears generated output and displays concise guidance to reload the page and try again

### Requirement: Controls recover after terminal outcomes
The local popup SHALL restore controls disabled for an in-flight request after every success or failure outcome produced by the client request layer.

#### Scenario: Notes refresh succeeds
- **WHEN** a Notes refresh returns a candidate
- **THEN** the Notes field is updated, success status is shown, and the refresh control is enabled

#### Scenario: Notes refresh times out
- **WHEN** a Notes refresh reaches the client-owned deadline without a userscript-manager callback
- **THEN** failure status is shown and the refresh control is enabled for use after page recovery

### Requirement: Hosted userscript remains isolated from local mode
The build SHALL include local request resilience only in the local popup userscript variant.

#### Scenario: Userscripts are rebuilt
- **WHEN** the popup userscript builder runs
- **THEN** the local variant contains the hardened local runtime while the GitHub-hosted variant has no `GM_xmlhttpRequest` grant or local-server runtime
