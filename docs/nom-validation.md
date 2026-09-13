# Validating Chu Nom results locally

Before this tool existed, checking whether a word would get a Chu Nom ruby annotation, or
what the popup dictionary would show for it, meant `grep`-ing dictionary sources and guessing
at the matcher's behaviour by hand. That approach missed real bugs: a single precomposed
codepoint (`ý`) was silently missing from the nom-ruby userscript's word-character class for
an unknown length of time, which meant that specific word could never start a match -- the
sentence containing it looked fine on every other word, and only manual `grep` across three
different dictionary sources (`vnedict2.json`, `mdx_nom.json`, the hand-maintained shards)
eventually found the actual class definition to blame.

`scripts/nom-inspect.js` and its underlying engine module close that gap: they run the exact
same code path the generated userscripts run, against the exact same dictionary sources, so a
local answer can never drift from what installing a rebuilt userscript in a browser would show.

## What it reuses, not reimplements

- `zd-extension/js/zd-nom-match.js` -- the Chu Nom trie/matching engine. It is the single
  source of truth: `scripts/build-nom-userscript.js` inlines this file's source ahead of
  `scripts/userscript/nom-ruby.runtime.js` when it builds the userscript (the same pattern
  `zd-extension/js/zd-words.js` already uses for the popup userscript -- see
  [`docs/build.md`](build.md)), and `scripts/nom-inspect.js` (or a test) can `require()` the
  same file directly under Node. There is exactly one implementation of "does this text match
  this dictionary", never a second copy that could quietly diverge.
- `buildFullNomMap()` (exported from `scripts/build-nom-userscript.js`) -- the same
  base-dictionary + MDX + hand-maintained-entries + display-order merge pipeline `main()` runs
  before writing `zoopdog-nom-ruby.user.js`.
- `buildFullDictionary()` (exported from `scripts/build-popupdict-userscript.js`) -- the same
  merge pipeline behind `zoopdog-popupdict.user.js`.

## CLI

```sh
node scripts/nom-inspect.js annotate "những ý tưởng điên rồ"
node scripts/nom-inspect.js popup "ý"
```

Or through the Makefile:

```sh
make nom-annotate TEXT="những ý tưởng điên rồ"
make nom-popup TERM="ý"
```

`annotate` prints every span the nom-ruby userscript would wrap in a `<ruby>` element, left to
right, each with the candidate that would render (the first one) and the rest that would only
show up in the ruby's `title` tooltip -- this is also where to check *candidate order*
(`user_nom_order.jsonc` overrides, hand-maintained-entry preference, and so on all apply before
this prints, exactly as they do for a real build):

```
$ make nom-annotate TEXT="những ý tưởng điên rồ"
Text: những ý tưởng điên rồ
  [0..5) "những" -> 仍 (other candidates: 忍)
  [6..13) "ý tưởng" -> 意想
  [14..21) "điên rồ" -> 癲𤸭
```

`popup` prints what the popup dictionary would show for one headword: its normalized lookup
key, the stored headword spelling, and every definition in display order (Chu Nom renderings
are always grouped first -- see `isCjkDefinition` in `build-popupdict-userscript.js`):

```
$ make nom-popup TERM="ý"
Key: ý
Headword: ý
Definitions (in display order):
  1. 意|薏|🇮🇹
  2. opinion, mind, position, thought, idea
  3. Italy
```

An unmatched word or term prints a clear "no match" / "no entry" line instead of silence, so a
missing result is never confused with a slow terminal or a hung command.

## Programmatic use

`scripts/nom-inspect.js` also exports `annotate(text, options)` and `popupLookup(term)` for use
from another script or a test:

```js
const {annotate, popupLookup} = require('./scripts/nom-inspect');

annotate('những ý tưởng điên rồ');
// => {text: '...', spans: [{index, length, text, nom, candidates}, ...]}

popupLookup('ý');
// => {key: 'ý', vn: 'ý', definitions: [{def, pos}, ...]} or null
```

`test/zd-nom-match.test.js` unit-tests the matching engine itself (trie walking, ASCII-term
policy, and a regression test for the missing-word-character-class bug above).
`test/nom-inspect.test.js` exercises the CLI and its formatting against the real repository
dictionaries, so both files change together whenever the merge pipelines they call change.
