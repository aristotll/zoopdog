# Runtime boundaries

The website, the two standalone userscripts and the local inspection CLI share dictionary data;
`zd-extension/` is the historical name of the shared source directory. Build and publication
commands are in [build.md](build.md), and the cross-repository reader contract is in
[local-mode.md](local-mode.md).

| Boundary | Input and output | Owner |
| --- | --- | --- |
| Dictionary identity | Source rows `{vn, en: [{def, pos}]}` become ordered grouped entries `{key, headwords, en}`; an optional sense `headword` associates a sense with a non-primary spelling. | `scripts/lib/dictionary-identity.js` |
| Popup dictionary | Each key maps to `[[headwords, senses]]`; each sense is `[def, pos]` or `[def, pos, headword]`. | `scripts/build-popupdict-userscript.js` |
| Rendering preference | Ordered rows contain `vi`, `nom[]`, and optional `caseSensitive`; exact-case rows and casefolded rows are distinct. | `scripts/user-nom-order.js` and reader `nom_order.py` |
| Browser dictionary | Metadata `{schemaVersion, revision, entryCount, payload?}` identifies grouped JSON. The coordinator returns `ready-current`, `ready-refreshed`, `ready-stale`, or `unavailable`, with an error and remedy for failures. | `zd-extension/js/zd-dictionary-runtime.js` |
| Popup frame | A sandboxed frame receives bounded, versioned messages over a MessageChannel; the page owns geometry and pin storage. | `zd-extension/js/zd-popup-protocol.js`, `showframe.js`, `frame.js` |
| Local HTTP | The manager adapter sends a method, path, query, optional JSON body and timeout; success resolves parsed JSON and errors retain status and payload. | `scripts/userscript/local-transport.js` |
| Local selection and modal geometry | Selection extraction and drag-range handling take a document and caret/selection adapters; modal geometry takes storage, domain and viewport callbacks. The runtime owns event wiring and modal state. | `scripts/userscript/local-selection.js`, `local-modal-geometry.js`, `popupdict-local.runtime.js` |
| Explored-link tools | Inline buttons after each Google result title (`decorate`) and a hover pill for an uncoloured link take an injected document and `eligible`/`refresh`/`blacklist` callbacks; they only draw and route clicks. The runtime owns the keys, the server calls and the blacklist modal. | `scripts/userscript/local-explored-tools.js`, `popupdict-local.runtime.js` |
| Local entry preview and modal guard | A renderer takes an injected document and renders server diff rows with text nodes; a guard prevents duplicate submissions while preserving pre-existing button state. Modal event handlers own preview and confirmation. | `scripts/userscript/local-entry-diff.js`, `local-modal-guard.js`, `popupdict-local.runtime.js` |
| Offline Nôm review | `read`, `write`, `has` and `add` operate on a supplied string store; entries are `{vi, context, ts}`. | `scripts/userscript/nom-review-store.js` |
| Annotation ownership | A cross-node match tracks its source segments and inserted nodes; changed or removed sources retire the affected match before rescanning. | `scripts/userscript/nom-ruby.runtime.js` |

The userscript builders inline the shared browser sources in declaration order into their existing
IIFEs. Local-only helpers and grants are not included in the public popup build. Tests exercise
these boundaries in isolation and through the generated scripts; a DOM harness cannot establish
userscript-manager, Trusted Types or browser layout compatibility by itself.

`make check-types` pilots strict TypeScript checking of the JSDoc contract on the offline
review store. It checks the existing JavaScript without transpiling or adding a runtime
dependency; `make verify` runs the same check.
