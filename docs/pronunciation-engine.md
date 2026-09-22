# Pronunciation engine

The Vietnamese pronunciation, number-spelling, and homophone logic shared by the website
pages, the sandboxed popup frame, and (if a future userscript needs it) the generated
popup userscript.

## Module ownership

| File | Owns |
| --- | --- |
| `zd-extension/js/zd-pron-data.js` | Static linguistic tables: `dialects`, `vowelTable`, `toneTable`, `toneCodes`, `tones`, `rimesToIPA`, `initialsToIPA`, `numbers`, `TENS_WORD`, `zoopdogSymbols`, `wordUnitsRegex`. Plain data, no functions. Exports via CommonJS under Node, plain top-level `const`s in a browser. |
| `zd-extension/db_src/realwords-source.txt` | The readable, one-word-per-line, NFC-normalized, provenance-documented source for the accepted real-word lexicon used by homophone filtering. |
| `scripts/build-realwords-lexicon.js` | Deterministic generator: reads `realwords-source.txt`, normalizes/dedupes/sorts, and writes `zd-extension/js/realwords.js` with a word count and SHA-256 diagnostic in its header comment. Run it with `node scripts/build-realwords-lexicon.js` after editing the source list. |
| `zd-extension/js/realwords.js` | GENERATED. The compact `allPossibleRealWords` array artifact, plus a CommonJS export guard. Never edit by hand. |
| `zd-extension/js/zd-pron-core.js` | The pure core: `createPronunciationCore(pronData, allPossibleRealWords)` returns `numbersToWords`, `dissect`, `addTone`, `construct`, `wordPronunciation`, `pronunciationGuide`, `getHomophones`, `getShortLongPairs`, `getMultiWordHomophones`, and helpers. No DOM access, no `String.prototype` mutation, no implicit globals. In a browser it builds the page-wide `ZDPronCore` namespace immediately from the ambient globals declared by `zd-pron-data.js` (and, on pages that need homophones, `realwords.js`); under Node it is `require`d and called explicitly with data supplied by the caller. |
| `zd-extension/js/zd-pron-functions.js` | Thin adapter: re-exposes `ZDPronCore.pronunciationGuide`, `getHomophones`, `getShortLongPairs`, `getMultiWordHomophones`, `numbersToWords` as the bare global names every consumer page already calls. Contains no logic of its own. |
| `js/zd-pron.js`, `zd-extension/js/zd-pronguide.js`, `zd-extension/js/frame.js` | DOM adapters: read `.value`/`.textContent`, call the core functions above, and write the `.ipa`/`.zd` results (or homophone lists) into the page. |

Script load order matters: `zd-pron-data.js` (and `realwords.js`, on pages using homophones)
must load *before* `zd-pron-core.js`, which must load before `zd-pron-functions.js`. See
`pronunciation.jade`, `pronguide.jade`, `homophones.jade`, and `zd-extension/frame.jade` for
the exact `<script>` ordering (and their generated `.html`).

## Result contract

`pronunciationGuide(str)` is total: it never throws for a string input, and it always returns
an object with exactly the three dialect keys (`hanoi`, `quangnam`, `saigon`), each holding
`{ipa: string, zd: string}` (never `undefined`), plus:

- `status`: `"empty"` for empty or whitespace-only input, `"ok"` otherwise.
- `input`: the normalized (Unicode-normalized, lowercased) input string.

Empty/whitespace-only input returns `{ipa: "", zd: ""}` for every dialect rather than the
pre-refactor behavior of echoing a stray placeholder space. Unsupported tokens (punctuation,
symbols) are passed through verbatim in both `.ipa` and `.zd` -- this is intentional passthrough,
not an error, so a sentence like "Xin chào!" still renders its punctuation.

`getHomophones`/`getMultiWordHomophones`/`getShortLongPairs` are total in the same sense: they
always return all three dialect keys, with an array (or, for `getMultiWordHomophones`, a number
above its `limit` or `"&nbsp;"` placeholder) per dialect, never `undefined`.

Adapters must read results through this contract (dialect keys always present, string fields
always strings) rather than inferring validity from whether a field exists.

## Supported numeric grammar

`numbersToWords(number, dialect)` accepts:

- A non-negative integer with at most 10 digits (as a `Number` or a digit string).
- Optionally followed by `.` and one or two more digits, read as individual decimal numerals
  ("chấm" + each digit's word).

Anything else -- a sign, more than one `.`, a non-digit integer part, more than 10 integer
digits, exponents -- is explicitly unsupported and returned unchanged (the original string).
This is deliberate: per the change's open question, no spoken form for signed or otherwise
malformed numeric tokens has been confirmed, so they are left alone rather than guessed at.

Positional tens/hundreds rules (as of this change): the tens-place word is "mười" only for an
exact multiple of ten in that position (10, 110, 1010, the "mười" in "mười lăm", ...) and
"mươi" for a tens digit 2-9 ("hai mươi", "ba mươi", ...). This is decided directly from the
digit values during generation, not from a blanket string replacement afterward.

## Intentional corrections (before / after)

Captured as regression fixtures in `test/zd-pron-core.test.js`. Everything else observed in
that suite's characterization tests is preserved exactly as the pre-refactor
`zd-pron-functions.js` produced it.

| Input | Before | After | Why |
| --- | --- | --- | --- |
| `"0"` (any dialect) | `""` and malformed downstream results (`.5` spelled `"chấm lăm"`, no leading "không") | `"không"` (and `"0.5"` → `"không chấm lăm"`) | `loopThroughNumbers`'s `while (number > 0)` never ran for zero, producing an empty token list that fed back into `pronunciationGuide("")`'s space-placeholder fallback. |
| `"110"` | `"một trăm mươi"` | `"một trăm mười"` | A blanket `" mười"` → `" mươi"` replacement rewrote every occurrence, including the "exact ten" case that must stay "mười". |
| `"1010"` | `"một nghìn không trăm mươi"` | `"một nghìn không trăm mười"` | Same defect as `"110"`. |
| Empty / whitespace-only input | `{ipa: " ", zd: " "}` per dialect (a literal leading space, from the `[" "]` fallback token) | `{ipa: "", zd: ""}` per dialect, `status: "empty"` | Total-result contract: no placeholder token is synthesized. |
| Minor ɤ (e.g. `"ý"`, `"y"`, `"i"` in Quangnam/Saigon) | Always rendered as `"ə˞"` | Rendered as `"ə"` when there is no preceding onset consonant | `wordPronunciation` compared `i === 0` (a string to the number `0`), which can never be true; the branch was unreachable. Fixed to compare against `""`. |

Not changed, though also arguably imperfect: the blanket `" năm"` → `" lăm"` replacement also
fires on the hundreds-multiplier "năm" in forms like `"1500"` → `"một nghìn lăm trăm"`. No
fixture or cited evidence pins down the intended correct form here, so per this change's
non-goals it is left as characterized, pre-existing behavior.

## Rebuilding the lexicon

Edit `zd-extension/db_src/realwords-source.txt` (one NFC word per line; `#`-prefixed and
blank lines are ignored), then run:

```sh
node scripts/build-realwords-lexicon.js
```

This regenerates `zd-extension/js/realwords.js` deterministically -- running it twice with an
unchanged source produces byte-identical output, which `test/zd-pron-core.test.js` checks.
