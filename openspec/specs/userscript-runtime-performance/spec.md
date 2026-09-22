# userscript-runtime-performance

## Purpose

Canonical specification for the `userscript-runtime-performance` capability, promoted from change `speed-up-userscripts`.

## Requirements

### Requirement: Embedded data loads as parsed JSON strings
The generated userscripts SHALL embed the popup dictionary and the nom-ruby term and case-sensitive maps as `JSON.parse` of a single JavaScript string literal, not as object literals, and `scripts/lib/userscript.js`'s `extractAssignedJson` SHALL still recover those maps from the generated files.

#### Scenario: Generated maps round-trip
- **WHEN** a userscript is built and `extractAssignedJson` reads `NOM_MAP` and `ZOO_DICTIONARY` from it
- **THEN** the returned objects deep-equal the maps the builder embedded

#### Scenario: Object-literal fixtures still parse
- **WHEN** `extractAssignedJson` reads a file whose assignment is a plain object literal
- **THEN** it returns the same object as before this change

### Requirement: Matching output is unchanged
For any text and any dictionary, the nom matcher SHALL return the same sequence of matches (`index`, `length`, `nom`) and the same `canContinuePast` answers as the character-trie implementation it replaces, including terms named like `Object.prototype` members, decomposed input, and double-whitespace gaps.

#### Scenario: Differential equivalence
- **WHEN** the reference trie matcher and the current matcher run over generated and real-dictionary text
- **THEN** every `findNomMatch` stream and every `canContinuePast` result is identical

#### Scenario: Prototype-named term
- **WHEN** the dictionary lacks a term `constructor` and the text contains that word
- **THEN** no match is reported for it

### Requirement: A word run is segmented once per text
`findNomMatch` SHALL compute the word run and best segmentation for a run of a given text at most once, however many times it is called on that text, so scanning a run of `n` words costs `O(n)` segmentations rather than `O(n²)`.

#### Scenario: Long unmatched run
- **WHEN** a run of 2,000 space-joined words with no dictionary hit is scanned start to end
- **THEN** `zdNomRunWords` runs once for the run, not once per word

### Requirement: Annotation produces the same DOM
The nom-ruby runtime SHALL produce the same DOM structure — original text node retaining the head text, followed by `ruby.zoopdog-nom-ruby` elements and text nodes — whether a text node's matches are applied one at a time or batched, and SHALL skip text nodes containing no word character without changing how pages observe NFC normalisation.

#### Scenario: Batched insertion
- **WHEN** a text node contains three matches
- **THEN** the resulting child list equals the sequence the per-match `splitText` implementation produced, and the original node still holds the head text

#### Scenario: Streaming page rewrites a node
- **WHEN** a page rewrites the text of a node the script already annotated
- **THEN** the previously inserted nodes are removed and the new text is annotated once

### Requirement: The script does not rescan its own work
The nom-ruby runtime SHALL NOT queue a subtree for rescanning because of mutations caused by its own annotation writes, and SHALL NOT queue a node whose ancestor is already queued.

#### Scenario: Own mutations ignored
- **WHEN** a pass annotates a text node
- **THEN** no further pass is scheduled for that node's parent because of the ruby insertion
