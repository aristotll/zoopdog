## ADDED Requirements

### Requirement: Generated userscripts update themselves
Each generated userscript SHALL declare `@updateURL` and `@downloadURL` pointing at its own
published raw location, derived from the shared repository path declarations rather than
hard-coded in the runtime header. The builders SHALL stamp `@version` so that it compares
strictly greater than the previously committed version whenever any other byte of the generated
file changes, and SHALL leave it unchanged when the remaining bytes are identical.

#### Scenario: Dictionary data changes
- **WHEN** a builder runs after a dictionary, runtime, or builder change
- **THEN** the generated userscript carries a version greater than the committed one, so an
  installed copy is offered the update

#### Scenario: Rebuild against unchanged inputs
- **WHEN** a builder runs twice against unchanged inputs
- **THEN** the second run writes the same version and the same bytes, and `git status --short`
  reports no change

#### Scenario: Two changes on one day
- **WHEN** the previous version is not older than the current build date
- **THEN** the stamp gains or increments a trailing counter, so it is still strictly greater

#### Scenario: Update location is declared once
- **WHEN** a test reads either generated userscript
- **THEN** its `@updateURL` and `@downloadURL` equal the raw URL derived from the shared path
  declaration for that file

## MODIFIED Requirements

### Requirement: Userscript runtime lives in real source files
The browser runtime JavaScript and CSS embedded in the userscript builders SHALL be stored as ordinary source files, and the builders SHALL assemble them into the generated userscripts rather than carry them inside template literals. Assembled runtime files SHALL pass syntax checking as themselves, and SHALL NOT require escaping backslashes or template-literal syntax to be stored.

#### Scenario: Runtime is syntax-checked as code
- **WHEN** the verification target runs
- **THEN** each extracted runtime source file is syntax-checked directly, so an error inside the runtime fails verification instead of being hidden inside a valid string literal

#### Scenario: Regular expressions need no double escaping
- **WHEN** the runtime declares a pattern containing `\s`, `\n`, or a Unicode escape
- **THEN** the source file contains the pattern exactly as the browser will see it, with no doubled backslashes

#### Scenario: Builder files carry only assembly logic
- **WHEN** a maintainer opens `scripts/build-nom-userscript.js` or `scripts/build-popupdict-userscript.js`
- **THEN** the file contains data transformation and assembly logic only, and the browser runtime and CSS are not inlined in it

#### Scenario: Runtime edit reaches the generated output
- **WHEN** a maintainer edits an extracted runtime source file and reruns the builder
- **THEN** the change appears in the corresponding generated userscript, with no difference other than the raised `@version` stamp
