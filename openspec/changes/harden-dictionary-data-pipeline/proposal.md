## Why

The dictionary data pipeline currently loses and corrupts data silently, and the file the extension and website actually ship has quietly decoupled from the toolchain that is supposed to produce it. `zd-extension/db_src/make_dict.py` — the sole Python script in an otherwise all-Node.js `scripts/` toolchain — splits each source line with `line.split(":")` instead of `split(":", 1)`, so any entry with more than one colon drops every sense after the second colon (confirmed: `sói : (1) wolf: (2) bald; (3) chloranth` becomes just `"wolf"`; at least 16 lines in `vnedict.txt` are affected). Separately, `docs/dictionary-data.md` claims the file actually loaded at runtime (`zd-extension/js/vnedict.json` — read by the extension's `background.js` via `chrome.runtime.getURL`, and also fetched directly by the website's `js/popupdict.js:187`) is a manual copy from the regenerated `db_src/vnedict.json`. Comparing actual content shows this is no longer true: `js/vnedict.json` (61,531 entries, Nôm/Hán definitions merged in) is far closer to the actively-maintained `db_src/vnedict2.json` (76,178 entries, same Nôm merges) than to `db_src/vnedict.json` (53,988 entries, no Nôm merges — plain `make_dict.py` output). `js/vnedict.json` is best explained as a stale, minified snapshot of an earlier `vnedict2.json`, not a copy of `make_dict.py`'s output, so the documented "copy step" describes a link that doesn't actually exist. On the userscript side, `scripts/merge-mdx-nom-into-vnedict2.js` writes the primary 6.8MB `vnedict2.json` with a plain `fs.writeFileSync`, unlike the atomic-write discipline already established in `scripts/add-chu-nom/fsutil.js`, and it silently drops malformed MDX candidates with no counter, unlike the equivalent handling in `scripts/extract-mdx-nom-data.js`. None of this is caught by `make verify`, because `make_dict.py` sits outside the Node.js-only toolchain the verification target covers.

## What Changes

- Port `zd-extension/db_src/make_dict.py` to a new Node.js script under `scripts/` (e.g. `scripts/build-extension-dictionary.js`), fixing the colon-split bug as part of the rewrite so every sense in a multi-colon definition is preserved. `vnedict.txt` itself has been untouched since the repository's initial commit, so this is a correctness and toolchain-consistency fix, not a change to what ships today.
- Add a separate new script (e.g. `scripts/build-extension-vnedict-json.js`) that reads `zd-extension/db_src/vnedict2.json` — the dictionary that is actually kept current by the merge and add-chu-nom workflows — and writes a compact-JSON `zd-extension/js/vnedict.json` in the shape `background.js` and `popupdict.js` already expect. This makes the extension, the website's popup dictionary page, and the userscripts all derive from the single already-maintained `vnedict2.json`, closing the real drift instead of wiring up a copy step from `make_dict.py`'s output that would regress the Nôm/Hán definitions users already have.
- Add atomic-write behavior to the `zd-extension/db_src/vnedict2.json` write in `scripts/merge-mdx-nom-into-vnedict2.js`, reusing the existing `atomicWrite` helper from `scripts/add-chu-nom/fsutil.js` rather than reimplementing it — promoting it into `scripts/lib/` so both call sites import the single shared definition.
- Add a counter/log line for malformed MDX candidates that are currently silently dropped in `scripts/merge-mdx-nom-into-vnedict2.js`, following the `skippedNonVietnamese` pattern already used in `scripts/extract-mdx-nom-data.js`.
- Add `rebuild-extension-dict` and `rebuild-extension-vnedict-json` Makefile targets (or a single combined target) for the new scripts, enumerated into `verify-scripts` the same way other `scripts/` files already are.
- Update `docs/build.md` and `docs/dictionary-data.md` to describe the corrected, automated flow (`vnedict2.json` → `js/vnedict.json`) and remove the obsolete manual-copy instructions.
- Add `node:test` coverage for both new scripts' transform/output-shape logic and for the merge script's atomic-write and drop-counting behavior, using in-memory fixtures with no real dictionary I/O.
- Regenerate and commit `zd-extension/db_src/vnedict.json` (bug-fixed) and `zd-extension/js/vnedict.json` (now sourced from `vnedict2.json`) once the new scripts exist, per the repo's convention that generated assets are committed alongside their source.
- Remove `zd-extension/db_src/make_dict.py` once the Node.js script is verified to produce equivalent (bug-fixed) output. **BREAKING** for anyone still invoking `python3 make_dict.py` directly, per `docs/dictionary-data.md`'s current instructions.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `dictionary-script-toolchain`: extends the toolchain's existing requirements (single definition for shared primitives, side-effect-free imports, verification coverage) to cover the newly-ported extension-dictionary script, and adds new requirements for atomic writes to dictionary output files and visibility into dropped/malformed input data during merges.

## Impact

- Affected code: new `scripts/build-extension-dictionary.js` and `scripts/build-extension-vnedict-json.js`; `scripts/merge-mdx-nom-into-vnedict2.js`; `scripts/add-chu-nom/fsutil.js` (its `atomicWrite` export moves to `scripts/lib/`) and its existing callers in `scripts/add-chu-nom/`; `scripts/lib/paths.js` (new path constants for `vnedict.txt`, `db_src/vnedict.json`, `js/vnedict.json`); `Makefile`; `docs/build.md`; `docs/dictionary-data.md`; new `test/*.test.js` coverage.
- Affected data: `zd-extension/db_src/vnedict.json` (bug-fixed regeneration), `zd-extension/js/vnedict.json` (now sourced from `vnedict2.json`), and `zd-extension/db_src/vnedict2.json` (atomic writes) are regenerated and committed.
- Affected consumers (unchanged behavior, corrected data source): `zd-extension/js/background.js` and `js/popupdict.js`, both of which fetch `js/vnedict.json` at runtime.
- Removed: `zd-extension/db_src/make_dict.py` and its Python runtime dependency.
- No runtime website or Chrome-extension API changes; no new package dependency (Node.js remains the single scripting/build runtime, consistent with `openspec/changes/delegate-add-chu-nom-to-nodejs`).
- Out of scope, deferred to separate future proposals: website bugs (`meta.jade` manifest link, `popupdict.js` bugs), extension reliability/security items (`window.onload` clobber, `postMessage` origin validation, manifest permission cleanup), and repo hygiene (`zd-extension.zip`, `evdict.txt`, `.codemoss` tracking).
