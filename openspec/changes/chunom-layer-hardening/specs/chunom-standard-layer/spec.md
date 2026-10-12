## MODIFIED Requirements

### Requirement: Precedence of the chunom layer
The builders SHALL apply chunom.org's standard characters below the dictionaries and below the user's entries and order rows, and SHALL NOT write them into `vnedict2.json` or any user file. A chunom order row SHALL be left out only for a normalized term the user has an entry for or a casefolded (non-`caseSensitive`) order row for; a `caseSensitive` order row speaks only for its exact spelling and SHALL NOT suppress chunom's row for the casefolded term.

#### Scenario: User order wins
- **WHEN** the user has an order row or entry for a reading chunom also lists
- **THEN** the built candidate order follows the user's row

#### Scenario: Dictionary forms kept first
- **WHEN** the dictionary already has Nom forms for a chunom term
- **THEN** chunom adds only the missing forms, after the existing ones

#### Scenario: Case-sensitive surname row leaves the common word to chunom
- **WHEN** `user_nom_order.jsonc` has `{"vi": "Triệu", "nom": ["趙"], "caseSensitive": true}` and chunom's standard character for `triệu` is `兆`
- **THEN** the casefolded `triệu` candidate list starts with `兆` and the exact spelling `Triệu` still renders `趙` in the nom-ruby case-sensitive map

### Requirement: Single read per build
A build SHALL obtain the chunom layer through one loader call that reads and parses `chunom_standard.json` once and supplies both the dictionary fold and the display-order rows. The loader SHALL report the user's own order rows and chunom's order rows separately, so the rows a builder returns or logs as the user's order contain no chunom rows.

#### Scenario: Absent file
- **WHEN** the file does not exist
- **THEN** the build output equals a build without the layer

#### Scenario: Separate accounting
- **WHEN** a builder logs or returns its display-order rows
- **THEN** the user's row count equals the rows of `user_nom_order.jsonc` and chunom's rows are reported under their own count

## ADDED Requirements

### Requirement: Payload validation
Reading `chunom_standard.json` SHALL validate its shape: `entries` MUST be an object whose values are arrays of strings, and `standard` and `meanings`, when present, MUST have the same shape. A malformed file SHALL fail the build with an error naming the file path and the first offending key.

#### Scenario: Missing entries map
- **WHEN** `chunom_standard.json` parses as JSON but has no `entries` object
- **THEN** the build fails with an error that contains the file path and `entries`

#### Scenario: Non-array Nom forms
- **WHEN** `entries["một"]` is the string `"𠬠"` instead of an array
- **THEN** the build fails with an error naming `một`

### Requirement: Empty terms are skipped
The chunom merge SHALL skip a term whose normalized key is empty or whose Nom forms are all empty after cleaning; it SHALL NOT create a dictionary entry for it.

#### Scenario: Blank Nom forms
- **WHEN** a payload term has only blank Nom forms and an English gloss
- **THEN** no dictionary entry is created for that term

### Requirement: One shared Nom-form merge
Folding a term -> Nom-forms map into dictionary entries SHALL have exactly one implementation, shared by the mdx merge script and the chunom layer, together with one shared normalized-key index of dictionary entries.

#### Scenario: Same rules for mdx and chunom
- **WHEN** the same term -> forms map is merged through the mdx script and through the chunom layer into identical entries
- **THEN** the resulting `en` lists are identical

### Requirement: Local watcher sees chunom data
The local-userscript watcher SHALL include `chunom_standard.json` (its content, or its absence) in the input hash that triggers a rebuild.

#### Scenario: Re-import triggers rebuild
- **WHEN** `chunom_standard.json` is created, changed, or deleted while the watcher runs
- **THEN** the next check computes a different input hash and rebuilds the local userscripts

### Requirement: Makefile entry point for the importer
The importer SHALL be runnable as `make import-chunom-standard`, fetching from chunom.org by default and reading a saved copy when `FILE` is set.

#### Scenario: Saved copy
- **WHEN** `make import-chunom-standard FILE=list.txt` runs
- **THEN** it invokes the importer with `--file list.txt`
