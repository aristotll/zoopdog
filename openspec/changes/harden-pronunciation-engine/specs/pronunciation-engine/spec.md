## ADDED Requirements

### Requirement: Pronunciation core is pure and shared
The system SHALL provide one dependency-free pronunciation core that is importable under CommonJS and loadable by first-party browser surfaces. Importing or calling it MUST NOT mutate built-in prototypes, create implicit globals, read the DOM, or write files, and every website, extension, and generated-userscript consumer SHALL derive pronunciation behavior from that source.

#### Scenario: Core is imported in isolation
- **WHEN** a test imports the pronunciation core and invokes its exported transformations
- **THEN** no built-in prototype, global property, DOM, or repository file is changed

#### Scenario: Consumers are inspected
- **WHEN** structural verification scans pronunciation and homophone consumers
- **THEN** it finds one core implementation and only thin rendering or event adapters outside it

### Requirement: Every input has a stable result contract
Pronunciation-guide calls SHALL return a documented result containing `hanoi`, `quangnam`, and `saigon` entries for every accepted input. Empty, whitespace-only, punctuation-only, unsupported, and numeric input MUST yield either a complete explicit result or a stable typed diagnostic; they MUST NOT return missing `.zd` fields, enumerate string/prototype keys as dialects, or throw an undocumented `TypeError`.

#### Scenario: Input is empty or whitespace
- **WHEN** the core receives an empty string or any whitespace-only string
- **THEN** it returns the documented empty result for all three dialects and homophone generation returns an empty collection

#### Scenario: Input is zero
- **WHEN** the core receives `0` or the string `"0"`
- **THEN** it handles zero by the documented numeric rule without a missing dialect field or adapter crash

#### Scenario: Input is unsupported
- **WHEN** the core receives a token outside the documented word and number grammar
- **THEN** it returns the stable unsupported-input diagnostic and all UI adapters remain usable

### Requirement: Vietnamese number spelling is positional and deterministic
The core SHALL spell every supported integer token by numeric position rather than global text substitution. Zero, tens, internal zero hundreds, and dialect-sensitive forms SHALL have explicit fixtures, and identical input/dialect pairs SHALL produce identical NFC-normalized output.

#### Scenario: One hundred ten is pronounced
- **WHEN** the number speller receives `110`
- **THEN** it produces `một trăm mười` for the applicable standard form rather than `một trăm mươi`

#### Scenario: One thousand ten is pronounced
- **WHEN** the number speller receives `1010`
- **THEN** its tens position uses the documented `mười` form and its internal-zero wording matches the dialect fixture

### Requirement: Verified phonetic branches are exercised
Each documented dialect, tone family, onset/rime branch, and minor-vowel transformation SHALL have deterministic fixtures. Conditions SHALL compare values using their actual runtime types so a branch cannot remain unreachable through a string-versus-number mismatch.

#### Scenario: Minor vowel branch runs
- **WHEN** a fixture reaches the short `ɤ`/`ə` transformation documented by the pronunciation data
- **THEN** the produced IPA matches that documented minor-vowel rule

#### Scenario: Valid legacy corpus is characterized
- **WHEN** the refactored core runs the approved representative-word corpus
- **THEN** every output is byte-equivalent to the characterized baseline except named reviewed corrections

### Requirement: Homophone lexicon is generated and efficiently indexed
The real-word lexicon SHALL have a readable, provenance-documented source and a deterministic generated browser artifact. Homophone membership SHALL use a prebuilt lookup index, returned candidates SHALL be normalized and stable-ordered, and generation SHALL preserve accepted-word membership across all consumers.

#### Scenario: Lexicon is rebuilt unchanged
- **WHEN** the lexicon builder runs twice against unchanged source
- **THEN** the generated artifact is byte-identical and reports the same word count and SHA-256

#### Scenario: Homophones are generated repeatedly
- **WHEN** a multiword homophone request performs many membership checks
- **THEN** it reuses one indexed lexicon rather than linearly scanning the raw array for each candidate

### Requirement: Pronunciation verification covers generated consumers
`make verify` SHALL run the core behavioral suite, edge/failure fixtures, source-ownership checks, and generated popup-userscript contract tests without network access, Chrome, or writes to tracked files.

#### Scenario: Verification runs from a clean checkout
- **WHEN** a maintainer runs `make verify`
- **THEN** pronunciation tests execute in isolated memory or temporary paths and leave `git status --short` unchanged

