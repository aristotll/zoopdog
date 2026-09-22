# Sharding algorithm for `user_nom_entries/`

This directory replaces the old single `user_nom_entries.jsonc` file with 128 CSV shard files
(8 folders `00`-`07`, each holding 16 files `00.csv`-`15.csv`), so that adding or updating one
entry only touches the one small shard that entry hashes to, not an ever-growing single file.

This algorithm is implemented **twice, independently**: once in this repository (JavaScript,
`scripts/lib/shard-path.js`) and once in `book-translator` (Python, that repo's own shard-path
helper). Both implementations are tested against the fixture table below, so "the same algorithm"
is a checked fact, not an assumption. If you ever change this algorithm, you must update it in
both repositories and regenerate/re-verify this fixture table.

## Algorithm

```
normalized = normalizeTerm(vi)              # NFC, vi-VN casefold, whitespace-collapsed
digest     = sha256(normalized as UTF-8).hexdigest()
shard      = int(digest[:4], 16) % 128       # 0-127
folder     = str(shard // 16).zfill(2)       # "00".."07"
file       = str(shard % 16).zfill(2)        # "00".."15"
path       = f"{folder}/{file}.csv"
```

`normalizeTerm` here means *this repo's* `scripts/lib/text.js` `normalizeTerm` exactly: NFC,
`toLocaleLowerCase('vi-VN')`, whitespace-collapsed -- nothing more.

**book-translator must NOT hash its own `_normalize_term`'s output.** `book-translator`'s
`scripts/reader/nom_sources.py` has a *richer* term key, `_normalize_term`, that additionally
canonicalizes old-vs-new Vietnamese spelling (`_canonicalize_vietnamese_word` -- e.g. folding
"lý"/"lí"), which this repo's `normalizeTerm` does not do. Hashing `_normalize_term`'s output for
shard assignment was a real bug during this store's introduction: "quản lý" hashes to a different
shard than "quản lí" under `_normalize_term`, but JS's plain `normalizeTerm` treats "quản lý" as
one unchanged string -- so the two repositories' writers filed the same term into two different
shards, silently. `book-translator` fixed this with a separate `_shard_key` helper that mirrors
this repo's `normalizeTerm` bit-for-bit and is used *only* for shard assignment; `_normalize_term`
stays the richer key for everything else (matching/merging already-loaded entries). The fixture
table below is what caught this — keep both repos' tests running against it.

## CSV row format

Each shard file is `vi,nom,explain` (header row, then zero or more data rows), one row per term,
sorted by normalized `vi`. `nom` and `explain` are each joined with `|` when the entry has more
than one value. Standard RFC 4180 quoting applies (a value containing a comma or `"` gets wrapped
in double quotes by any conformant CSV writer/reader) -- this already happens today, e.g.
`"manager, manage, administer"`.

A literal `|` inside a `nom` or `explain` value is invalid input: no value in the dataset has ever
contained one, and a writer that received one MUST fail loudly rather than silently join two
distinct values into one ambiguous cell.

## Fixture

Every implementation of `shardPathFor(vi)` MUST agree with this table. Regenerate by running
`node -e` against `scripts/lib/shard-path.js` (or the Python equivalent) with these exact terms.

| vi | shard path |
| --- | --- |
| tiếng Anh | 06/06.csv |
| quản lý | 03/01.csv |
| ăn xong | 04/01.csv |
| kiểm tra xem | 05/06.csv |
| mưa dông | 02/03.csv |
| đêm nay | 05/01.csv |
| Thanh Hóa | 03/05.csv |
| học sinh | 04/00.csv |
| cảm ơn | 07/02.csv |
| xin chào | 02/14.csv |
| Việt Nam | 07/09.csv |
| con người | 04/08.csv |
| thời gian | 01/13.csv |
| công việc | 01/09.csv |
| gia đình | 02/04.csv |
| bạn bè | 05/11.csv |
| tình yêu | 01/08.csv |
| cuộc sống | 00/01.csv |
| chú Nôm | 00/13.csv |
| máy tính | 02/15.csv |
| internet | 00/15.csv |
| điện thoại di động | 02/04.csv |
