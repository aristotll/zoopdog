## ADDED Requirements

### Requirement: Deterministic shard assignment
Every hand-authored Nôm entry SHALL be assigned to exactly one of 128 shard files, addressed as
`zd-extension/db_src/user_nom_entries/<folder>/<file>.csv` where `folder` is the two-digit decimal
`shard // 16` (`00`–`07`) and `file` is the two-digit decimal `shard % 16` (`00`–`15`), and `shard`
is `int(sha256(normalizeTerm(vi)).hexdigest()[:4], 16) % 128`. This algorithm SHALL be implemented
identically by every reader and writer of the store, in both this repository and `book-translator`.

#### Scenario: Same term, same shard, regardless of implementation
- **WHEN** the same `vi` term's shard path is computed by this repository's JavaScript
  implementation and by `book-translator`'s Python implementation
- **THEN** both produce the identical `<folder>/<file>.csv` path

#### Scenario: Shard assignment is stable across runs
- **WHEN** a shard path is computed for the same `vi` term twice, with no change to the term or the
  algorithm
- **THEN** both computations return the same path

#### Scenario: Fixture regression
- **WHEN** the documented sharding fixture (`zd-extension/db_src/user_nom_entries/SHARDING.md`) is
  checked against either implementation
- **THEN** every fixture term's computed shard path matches its documented expected path

### Requirement: All 128 shards always exist
The store SHALL consist of exactly 128 shard files at all times, including shards with no entries
(header row only), addressed by the fixed `folder × file` ranges in the sharding algorithm — never
discovered via a directory listing.

#### Scenario: Empty shard is still a valid file
- **WHEN** a shard has received no entries
- **THEN** its file exists on disk with a header row and no data rows

#### Scenario: A missing shard is a hard error
- **WHEN** any of the 128 expected shard files is absent from
  `zd-extension/db_src/user_nom_entries/`
- **THEN** the store SHALL fail loudly (raise/throw) naming the missing shard path, rather than
  silently treating it as empty

### Requirement: CSV row format with multi-valued fields
Each shard file SHALL be a CSV file with a header row `vi,nom,explain` followed by zero or more
data rows, one per term, sorted by normalized `vi`. The `nom` and `explain` columns SHALL each hold
their (possibly multiple) values joined with `|`, quoted per RFC 4180 when the joined value
contains a comma or double quote.

#### Scenario: Single-valued entry round-trips
- **WHEN** an entry with one `nom` value and one `explain` value is written and re-read
- **THEN** the re-read entry's `nom` and `explain` arrays each contain exactly that one value

#### Scenario: Multi-valued entry round-trips
- **WHEN** an entry with multiple `nom` values and multiple `explain` values is written and re-read
- **THEN** the re-read entry's `nom` and `explain` arrays contain the same values in the same order

#### Scenario: A comma inside an explain value is preserved
- **WHEN** an `explain` value containing a literal comma (e.g. `"manager, manage, administer"`) is
  written and re-read
- **THEN** the re-read value is byte-identical to the original, and no extra value is introduced by
  the comma

#### Scenario: A literal `|` in a value is rejected, not silently merged
- **WHEN** a `nom` or `explain` value to be written itself contains a `|` character
- **THEN** the write SHALL fail loudly instead of writing a shard whose joined cell is ambiguous

### Requirement: In-place idempotent upsert
Adding or updating an entry SHALL read and rewrite only the one shard file the entry's `vi` term
hashes to. Writing the same entry twice SHALL leave the store in the same final state as writing it
once (no duplicate rows for the same normalized term), and updating an existing term SHALL replace
or extend its row in place rather than appending a shadow row.

#### Scenario: Repeated identical write is a no-op on disk
- **WHEN** the same `{vi, nom, explain}` entry is upserted twice in a row
- **THEN** the shard file's bytes after the second write are identical to its bytes after the first

#### Scenario: Updating a term never creates a second row for it
- **WHEN** an entry for a `vi` term already present in a shard is upserted with new `nom`/`explain`
  values
- **THEN** the shard still contains exactly one row for that normalized term afterward

#### Scenario: Unrelated shards are untouched
- **WHEN** an entry is upserted
- **THEN** no shard file other than the one that entry's term hashes to is modified (mtime
  unchanged)

### Requirement: Read API is format-agnostic to existing callers
Reading the full set of user-authored entries SHALL return the same `{vi, nom, explain}`-shaped
collection this store's callers already consume, regardless of the on-disk shard layout
underneath.

#### Scenario: Existing callers need no changes
- **WHEN** a caller that previously read the single-file JSONC format reads the sharded store
  through the same read function
- **THEN** it receives the same shape of result (an array/list of entries with `vi`, `nom`,
  `explain`) it received before, only sourced from 128 files instead of one
