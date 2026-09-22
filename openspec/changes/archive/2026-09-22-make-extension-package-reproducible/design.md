## Context

`zd-extension.zip` is tracked but has no owner in `Makefile` or build documentation. Its archived manifest is Manifest V2 version 2.0 from 2017, while `zd-extension/manifest.json` is Manifest V3 version 2.1. The archive also includes development sources and OS metadata. Since generated artifacts are intentionally committed, reproducibility and drift verification are required rather than deleting the ZIP.

The repository has no npm dependency and uses dependency-free Node.js maintenance scripts. Packaging must work from any current working directory and must not depend on a signed-in browser or network.

## Goals / Non-Goals

**Goals:**

- Generate byte-identical ZIP bytes from unchanged runtime inputs.
- Make package membership explicit, reviewable, and validated against the current manifest/runtime references.
- Detect stale or malformed tracked packages in `make verify` without rewriting them.
- Provide compact automation output and clear non-zero failure semantics.

**Non-Goals:**

- Publishing to the Chrome Web Store or signing a release.
- Deleting the tracked ZIP or changing extension runtime behavior.
- Packaging website-only assets, database source files, Jade/Stylus sources, or tests.
- Adding npm, a bundler, or an online packaging service.

## Decisions

1. **Use a checked-in package inventory plus reference validation.** A small declarative inventory lists runtime roots and intentional dynamic resources. The packager expands directories deterministically and validates manifest, HTML, CSS, and known runtime resource references. Pure reference discovery alone was rejected because dynamic paths cannot all be inferred safely; an unconstrained directory ZIP was rejected because it leaks source/dev files.

2. **Implement deterministic ZIP output in an importable Node library.** Entries are path-sorted, use normalized `/` paths, fixed timestamps and permissions, stable compression settings, and no platform extras. A thin CLI handles arguments/output. Calling the host `zip` binary was rejected because versions and metadata vary and the repository documents no dependency on it.

3. **Verify without mutating.** `verify-extension-package` builds expected bytes in a temporary path or memory, parses the tracked archive, validates membership/duplicates/references, and compares hashes. Tests use temporary fixture trees; normal verification never rebuilds repository files.

4. **Expose human and machine output.** Default success output is compact `key=value` lines for archive path, manifest version, entry count, byte count, and SHA-256. `--json` emits one versioned object. Usage, configuration, integrity, and I/O failures have stable distinct non-zero exit codes.

5. **Integrate after runtime generators.** The rebuild target first verifies required committed runtime dictionary/userscript outputs, then packages the current extension. This keeps generated inputs authoritative and prevents a ZIP containing stale runtime data.

## Risks / Trade-offs

- **[A dynamic resource is omitted]** → Keep explicit dynamic entries, validate all statically discoverable references, and add an unpacked-extension smoke checklist.
- **[Custom ZIP code is security-sensitive]** → Keep it minimal, round-trip with an independent system reader in tests when available, reject traversal/duplicate paths, and test CRC/size validation.
- **[Compression differences break reproducibility across Node versions]** → Pin the format/settings and test known fixture bytes; if deflate is not stable enough, use deterministic stored entries at the cost of archive size.
- **[Archive size grows]** → Record size in verification and compare against a documented bound without weakening correctness checks.

## Migration Plan

1. Inventory the exact current extension runtime and add fixture-based archive tests.
2. Implement package planning, deterministic writing, parsing, and verification as pure/importable functions.
3. Add the thin CLI and Make rebuild/verify targets.
4. Regenerate `zd-extension.zip`; inspect manifest/version/membership and load the unpacked packaged tree manually.
5. Add package verification to `make verify` and document release steps. Rollback restores the prior ZIP and removes the verification target as one scoped change; no user data is migrated.

## Open Questions

- Before implementation, choose stored versus deflated entries based on a cross-supported-Node reproducibility fixture and the resulting archive-size measurement.
