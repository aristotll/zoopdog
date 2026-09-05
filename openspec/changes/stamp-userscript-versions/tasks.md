## 1. Update location

- [x] 1.1 Declare the raw base URL and a per-path URL helper beside the repository paths.
- [x] 1.2 Add `@updateURL` and `@downloadURL` placeholders to both runtime headers and fill them
  from the path helper in both builders.

## 2. Version stamping

- [x] 2.1 Add version read/replace, dotted numeric comparison, datestamp, and next-version
  helpers to the shared userscript library.
- [x] 2.2 Write the generated userscript through the stamping helper, carrying the previous
  version forward when the remaining bytes are unchanged.
- [x] 2.3 Report the resulting version and whether it moved in the builder output.

## 3. Verification and documentation

- [x] 3.1 Unit-test comparison, stamping, carry-forward, and same-day counter behaviour.
- [x] 3.2 Assert the generated userscripts carry a real version and their update location, and
  allow the version stamp as a difference in the runtime-edit probe.
- [x] 3.3 Rebuild both userscripts, confirm a second rebuild is byte-identical, and run
  `make verify`.
- [x] 3.4 Document the stamp format, the push-to-update flow, and the manual update check.
- [ ] 3.5 (operator-only) Install each rebuilt userscript from its raw `master` URL and confirm
  Tampermonkey reports an available update after the next push.
