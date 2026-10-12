## 1. Layer refactor

- [x] 1.1 Move `readNomOrder` into `chunom-standard-layer.js`, taking the payload; remove chunom/paths imports from `user-nom-order.js`
- [x] 1.2 Update the three builders to read the payload once and pass it to merge and order
- [x] 1.3 Make `mergeChunomIntoEntries` stats-free

## 2. Importer and release

- [x] 2.1 Add timeout, redirects and a 3000-row minimum to `import-chunom-standard.js`
- [x] 2.2 Warn in `release-userscripts.js` when the chunom file is missing

## 3. Tests and docs

- [x] 3.1 Switch `test/chunom-standard.test.js` to a temp-root fixture
- [x] 3.2 Update `docs/chunom-standard.md`; run `make verify`
- [x] 3.3 Document and test that new terms keep chunom's glosses as written (other scripts accepted)
