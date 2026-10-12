# chunom-standard-layer

## Purpose

Canonical specification for the `chunom-standard-layer` capability, promoted from change `chunom-standard-layer`.

## Requirements

### Requirement: Precedence of the chunom layer
The builders SHALL apply chunom.org's standard characters below the dictionaries and below the user's entries and order rows, and SHALL NOT write them into `vnedict2.json` or any user file.

#### Scenario: User order wins
- **WHEN** the user has an order row or entry for a reading chunom also lists
- **THEN** the built candidate order follows the user's row

#### Scenario: Dictionary forms kept first
- **WHEN** the dictionary already has Nom forms for a chunom term
- **THEN** chunom adds only the missing forms, after the existing ones

### Requirement: Glosses of new terms kept as written
For a term the dictionary lacks, the build SHALL create an entry whose `en` lists the Nom forms first and then chunom's English glosses unchanged, including any non-Latin text a gloss contains.

#### Scenario: Gloss citing a Nom spelling
- **WHEN** a new term's gloss contains Nom characters
- **THEN** the gloss is kept verbatim and may be read as a candidate by the Nom matcher

### Requirement: Single read per build
A build SHALL read and parse `chunom_standard.json` once and use that payload for both the dictionary merge and the display order.

#### Scenario: Absent file
- **WHEN** the file does not exist
- **THEN** the build output equals a build without the layer

### Requirement: Safe import
The importer SHALL time out stalled requests, follow redirects, and refuse a list with fewer than 3000 rows.

#### Scenario: Truncated list
- **WHEN** the fetched text has 1500 rows
- **THEN** the importer fails and writes nothing

### Requirement: Release warning
The release script SHALL warn when `chunom_standard.json` is absent.

#### Scenario: Missing data file
- **WHEN** a release is prepared without the file
- **THEN** a warning is printed and the release proceeds without that asset
