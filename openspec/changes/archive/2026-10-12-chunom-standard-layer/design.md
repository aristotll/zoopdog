## Context

Builders call `mergeChunomIntoEntries(entries, readChunomStandard(path))` and `readNomOrder(orderPath, userEntries)`, which re-reads the file from a path derived beside the order file.

## Goals / Non-Goals

**Goals:** one parse and one path per build; no module coupling from the user-order reader to chunom; safer importer and release.
**Non-Goals:** changing precedence or the payload format; writing chunom data into `vnedict2.json` or user files.

## Decisions

- `readNomOrder(userSourcePath, userEntries, chunomPayload)` lives in `chunom-standard-layer.js` and takes the already-read payload. Builders read it once and pass it to both steps. Alternative (memoize by mtime) rejected: hidden state.
- `user-nom-order.js` drops its `paths` and chunom imports; `readUserNomOrder` is unchanged.
- `mergeChunomIntoEntries` returns nothing; counters were never read.
- Importer: 30s timeout, follow up to 5 redirects, require at least 3000 rows.
- Release: if `chunomStandard` is missing, print a warning (the userscripts may carry chunom words); the data asset is still optional.
- Tests write a small payload into a temp root.

## Risks / Trade-offs

- Callers of `readNomOrder` must import from the new module → grep shows only the three builders.
- Row threshold of 3000 fails if chunom shrinks its list → the error message names the count.
