## ADDED Requirements

### Requirement: Single definition of the Vietnamese word primitives
The Vietnamese word character class and the cursor-to-word primitives — extracting the word and surrounding context under a pointer position, generating multi-word lookup candidates from that context, and testing a pointer position against a set of rectangles — SHALL be defined exactly once in the repository. The extension content script, the website page script, and the generated userscript runtime SHALL consume that single definition rather than declaring their own.

#### Scenario: The character class exists once
- **WHEN** the repository's browser-facing sources are searched for the Vietnamese word character class literal
- **THEN** it is found in exactly one file, and no copy remains in the extension content script, the website page script, or the userscript runtime source

#### Scenario: Each primitive exists once
- **WHEN** the repository's browser-facing sources are searched for each cursor-to-word primitive
- **THEN** each is defined in exactly one file and referenced, not redefined, by every consumer

#### Scenario: A redefinition fails the build
- **WHEN** a copy of the character class or of any primitive is added to a consumer
- **THEN** the structural test suite fails and names the duplicated definition

### Requirement: Word matching behavior is unchanged by consolidation
The consolidated character class SHALL match exactly the set of code points that the pre-consolidation definitions matched. Consolidation SHALL NOT change which text is recognized as a Vietnamese word in the extension, on the website, or in either generated userscript.

#### Scenario: The consolidated class is equivalent to its predecessors
- **WHEN** the consolidated character class is compared against the character sets of the three pre-change definitions
- **THEN** the sets are equal, with no code point added or removed

#### Scenario: Lookup results are stable
- **WHEN** a Vietnamese term that resolved before consolidation is looked up after it
- **THEN** the same word boundaries are detected and the same lookup candidates are generated

### Requirement: Divergent cursor fixes are unified
The shared cursor-to-word primitive SHALL incorporate every defensive fix that previously existed in only one copy: it SHALL tolerate a caret-range lookup that returns no range, and it SHALL fall back to page-relative pointer coordinates when client-relative coordinates yield no range. Every consumer SHALL receive both behaviors.

#### Scenario: Caret lookup returns nothing
- **WHEN** the pointer is over a position for which the caret-range lookup yields no range in any consumer
- **THEN** the primitive reports no word instead of raising an error

#### Scenario: Client coordinates yield no range
- **WHEN** client-relative pointer coordinates yield no caret range but page-relative coordinates do
- **THEN** the primitive resolves the word using the page-relative coordinates, in the extension and the userscript as well as on the website

### Requirement: Shared definition loads without a module system
The shared definition SHALL be plain browser-compatible JavaScript that exposes its primitives without a bundler, transpiler, or module loader, while remaining importable under Node.js for testing. Consumers SHALL load it before the code that uses it: the extension through its manifest's content-script ordering, the website through its page source, and the generated userscripts through the existing runtime-source substitution mechanism.

#### Scenario: Extension load order is guaranteed
- **WHEN** the extension manifest's content-script list is inspected
- **THEN** the shared definition precedes the content script that consumes it, and a test fails if that ordering is broken

#### Scenario: Userscript inlines the shared source
- **WHEN** a generated userscript is rebuilt
- **THEN** the shared definition is substituted from its source file through the existing placeholder mechanism, the placeholder is replaced exactly once, and the build fails if it is missing

#### Scenario: The definition is unit-testable
- **WHEN** the test suite imports the shared definition under Node.js
- **THEN** the primitives are available for direct testing without a browser, a bundler, or a DOM implementation being required to load the file

#### Scenario: No new dependency is introduced
- **WHEN** the repository is inspected after the change
- **THEN** it still has no `package.json`, no bundler, and no transpiler, and the shared definition is loaded by ordinary script inclusion
