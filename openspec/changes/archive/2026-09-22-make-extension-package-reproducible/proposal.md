## Why

The tracked `zd-extension.zip` still contains the 2017 Manifest V2 extension (version 2.0), source-only files, `.DS_Store`, and `__MACOSX`, while the checked-in extension is Manifest V3 version 2.1. There is no build or verification target tying the distributable archive to the current extension, so a release can silently ship obsolete code.

## What Changes

- Add a deterministic, repository-owned extension packager with an explicit runtime-file allowlist derived from the current manifest and required web-accessible assets.
- Rebuild `zd-extension.zip` from the current Manifest V3 tree while excluding sources, development data, metadata junk, and unreferenced files.
- Add compact `key=value` output plus an optional JSON report for automation callers.
- Add verification that inspects the archive without mutating the checkout and rejects stale manifests, missing referenced resources, unexpected entries, duplicate paths, or non-reproducible bytes.
- Expose documented Make targets for rebuilding and verifying the extension package and include package verification in the repository verification path.
- Add deterministic fixtures covering success and malformed/stale package failure modes.

## Capabilities

### New Capabilities

- `extension-package`: Defines deterministic archive contents, packaging CLI behavior, integrity checks, and release integration for the Chrome extension.

### Modified Capabilities

- None.

## Impact

The change affects `zd-extension.zip`, a new importable packaging library and thin CLI under `scripts/`, `Makefile`, `test/`, and build/release documentation. It does not alter the unpacked extension runtime API; it replaces the stale distributable with a reproducible artifact generated solely from current checked-in sources.
