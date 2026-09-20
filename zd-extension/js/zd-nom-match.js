// Shared Chu Nom text-matching engine.
//
// Walks a word-level index built from a term -> Chu Nom map and finds the best match at a given
// position in running Vietnamese text. Defined here once and consumed by the nom-ruby
// userscript runtime (scripts/userscript/nom-ruby.runtime.js, inlined ahead of it by
// scripts/build-nom-userscript.js) and by Node tooling -- scripts/nom-inspect.js and its
// tests -- that needs to reproduce exactly what the userscript would annotate, without a
// browser. Plain top-level declarations with no module system, matching zd-words.js: loaded
// as a classic script it becomes a global, and inlined into the userscript IIFE it stays
// scoped to it.
//
// Edit this file, never a consumer's copy.

var ZD_NOM_WORD_CHAR_PATTERN = /[-0-9A-Za-zÀÁÂÃÈÉÊÌÍÒÓÔÕÙÚĂĐĨŨƠƯàáâãèéêìíòóôõùúăđĩũơưẠẢẤẦẨẪẬẮẰẲẴẶẸẺẼỀẾỂỄỆỈỊỌỎỐỒỔỖỘỚỜỞỠỢỤỦỨỪỬỮỰỲỴÝỶỸạảấầẩẫậắằẳẵặẹẻẽềếểễệỉịọỏốồổỗộớờởỡợụủứừửữựýỳỵỷỹ\u0300-\u036f]/u;
var ZD_NOM_WHITESPACE_PATTERN = /\s/u;
var ZD_NOM_NON_ASCII_PATTERN = /[^\x00-\x7F]/;
var ZD_NOM_VIETNAMESE_SIGNAL_PATTERN = /[ÀÁÂÃÈÉÊÌÍÒÓÔÕÙÚĂĐĨŨƠƯàáâãèéêìíòóôõùúăđĩũơưẠẢẤẦẨẪẬẮẰẲẴẶẸẺẼỀẾỂỄỆỈỊỌỎỐỒỔỖỘỚỜỞỠỢỤỦỨỪỬỮỰỲỴÝỶỸạảấầẩẫậắằẳẵặẹẻẽềếểễệỉịọỏốồổỗộớờởỡợụủứừửữựýỳỵỷỹ\u0300-\u036f]/u;

// Short/common English words to skip even when they would otherwise pass the length check in
// zdNomShouldAnnotateMatch -- see the comment there.
var ZD_NOM_ASCII_BLOCKLIST = {
  a: true, am: true, an: true, as: true, at: true, be: true, by: true, can: true, do: true,
  go: true, he: true, in: true, is: true, it: true, me: true, no: true, on: true, or: true,
  so: true, to: true, us: true, we: true
};

// The two character classes are tested once per character of every scanned text, so the regexes
// above stay the single definition and are only consulted to fill lookup tables (every
// Vietnamese letter, the combining marks, and every \s code unit below the table size) and for
// the rare code unit beyond them.
var ZD_NOM_CLASS_TABLE_SIZE = 0x2000;
var ZD_NOM_WORD_TABLE = new Uint8Array(ZD_NOM_CLASS_TABLE_SIZE);
var ZD_NOM_WHITESPACE_TABLE = new Uint8Array(ZD_NOM_CLASS_TABLE_SIZE);

(function fillClassTables() {
  for (var code = 0; code < ZD_NOM_CLASS_TABLE_SIZE; code++) {
    var ch = String.fromCharCode(code);
    ZD_NOM_WORD_TABLE[code] = ZD_NOM_WORD_CHAR_PATTERN.test(ch) ? 1 : 0;
    ZD_NOM_WHITESPACE_TABLE[code] = ZD_NOM_WHITESPACE_PATTERN.test(ch) ? 1 : 0;
  }
})();

// `code` is a UTF-16 code unit (NaN, from charCodeAt past either end, is in neither class).
function zdNomIsWordCode(code) {
  if (code < ZD_NOM_CLASS_TABLE_SIZE) {
    return ZD_NOM_WORD_TABLE[code] === 1;
  }
  return code === code && ZD_NOM_WORD_CHAR_PATTERN.test(String.fromCharCode(code));
}

function zdNomIsWhitespaceCode(code) {
  if (code < ZD_NOM_CLASS_TABLE_SIZE) {
    return ZD_NOM_WHITESPACE_TABLE[code] === 1;
  }
  return code === code && ZD_NOM_WHITESPACE_PATTERN.test(String.fromCharCode(code));
}

function zdNomIsWordChar(ch) {
  return !!ch && zdNomIsWordCode(ch.charCodeAt(0));
}

function zdNomIsWhitespace(ch) {
  return !!ch && zdNomIsWhitespaceCode(ch.charCodeAt(0));
}

var ZD_NOM_HAS_OWN = Object.prototype.hasOwnProperty;
var ZD_NOM_LOWER_UNSAFE_PATTERN = /[\u03a3\ud800-\udfff]/;
var ZD_NOM_WHITESPACE_RUN_PATTERN = /\s/g;

// Lowercases `str` one character at a time, the way the term index was originally keyed. A
// whole-string toLowerCase() agrees with that for everything except the Greek capital sigma
// (whose lowercase depends on its position in the word) and astral letters (a per-character
// walk sees only their halves), so those alone take the slow path.
function zdNomLower(str) {
  if (!ZD_NOM_LOWER_UNSAFE_PATTERN.test(str)) {
    return str.toLowerCase();
  }
  var out = '';
  for (var i = 0; i < str.length; i++) {
    out += str.charAt(i).toLowerCase();
  }
  return out;
}

// A word-level index over a term -> Chu Nom map. Matching only ever compares whole words joined
// by single spaces, so it needs two questions answered: "is this word sequence a term?" (`terms`)
// and "could a longer term start with it?" (`prefixes`, every proper word-prefix of a multi-word
// term). A sequence that is neither can never grow into a match, which is exactly where the
// character trie this replaced ran out of children -- without a heap object per character.
//
// `annotateAsciiTerms === false` drops every ASCII-only term up front, so an ASCII word can never
// match at all when the caller wants Chu Nom (non-ASCII) terms exclusively; otherwise the caller's
// map is used as it is. Lookups go through hasOwnProperty so a word such as "constructor" is not
// mistaken for a term.
function zdNomBuildIndex(map, annotateAsciiTerms) {
  var terms = map;
  if (annotateAsciiTerms === false) {
    terms = {};
    Object.keys(map).forEach(function(term) {
      if (ZD_NOM_NON_ASCII_PATTERN.test(term)) {
        terms[term] = map[term];
      }
    });
  }

  var prefixes = null;

  return {
    // The Chu Nom value of `key`, or undefined when `key` is not a term.
    get: function(key) {
      return ZD_NOM_HAS_OWN.call(terms, key) ? terms[key] : undefined;
    },
    has: function(key) {
      return ZD_NOM_HAS_OWN.call(terms, key);
    },
    // Built on first use: a page with nothing to match never pays for it.
    hasPrefix: function(key) {
      if (!prefixes) {
        prefixes = new Set();
        Object.keys(terms).forEach(function(term) {
          var at = term.indexOf(' ');
          while (at >= 0) {
            prefixes.add(term.substring(0, at));
            at = term.indexOf(' ', at + 1);
          }
        });
      }
      return prefixes.has(key);
    }
  };
}

function zdNomHasVietnameseContext(text, start, end) {
  var contextStart = Math.max(0, start - 80);
  var contextEnd = Math.min(text.length, end + 80);
  return ZD_NOM_VIETNAMESE_SIGNAL_PATTERN.test(text.substring(contextStart, contextEnd));
}

// The word spans of the maximal run starting exactly at `start` (which must itself be a word
// start) that are joined only by spaces -- a comma, line break, or any other non-space gap ends
// the run. Mirrors reader.nom's `_split_runs` in the book-translator project's Python engine,
// and is what the term index is walked against: the two engines segment the same class of text
// the same way, even though one is fed pre-tokenized words and the other raw text.
function zdNomRunWords(text, start) {
  var words = [];
  var i = start;
  var len = text.length;
  while (i < len && zdNomIsWordCode(text.charCodeAt(i))) {
    var wordStart = i;
    while (i < len && zdNomIsWordCode(text.charCodeAt(i))) {
      i++;
    }
    words.push({start: wordStart, end: i});
    // The gap must be plain U+0020 spaces only: any other whitespace ends the run.
    var onlySpaces = true;
    while (i < len && zdNomIsWhitespaceCode(text.charCodeAt(i))) {
      if (text.charCodeAt(i) !== 32) {
        onlySpaces = false;
      }
      i++;
    }
    if (i >= len || !onlySpaces || !zdNomIsWordCode(text.charCodeAt(i))) {
      break;
    }
  }
  return words;
}

// Every dictionary match starting at `words[index]`, shortest first -- unlike the old
// single-longest matchAt walk, this keeps every intermediate hit so zdNomBestSegmentation can
// weigh a shorter match against a longer one starting at the very same word instead of a
// longest-only walk silently picking whichever happens to be longest. See the "duyên"/"có duyên" regression
// this exists to fix: two genuine dictionary phrases can overlap on a shared word, and only
// comparing the whole run's total cost, not just what is longest at one position, tells which
// one should give way.
function zdNomWordMatchesAt(termIndex, text, words, index, annotateAsciiTerms) {
  var matches = [];
  var key = '';
  for (var offset = index; offset < words.length; offset++) {
    var word = zdNomLower(text.substring(words[offset].start, words[offset].end));
    key = offset === index ? word : key + ' ' + word;
    var isTerm = termIndex.has(key);
    if (!isTerm && !termIndex.hasPrefix(key)) {
      break;
    }
    var value = isTerm && termIndex.get(key);
    if (value && zdNomShouldAnnotateMatch(text, words[index].start, words[offset].end, annotateAsciiTerms)) {
      matches.push({length: offset - index + 1, value: value});
    }
  }
  return matches;
}

// The lowest-total-ambiguity way to cover `words` with dictionary matches, as an ordered list of
// {index, length, value}. Same cost model as reader.nom's `_best_segmentation` in the
// book-translator project: a multi-word phrase match costs 0 (a deliberately curated entry,
// trusted outright); a single-word match costs `candidateCount - 1` (the raw, unranked
// candidate list a lone word carries -- worth absorbing into a neighbouring phrase instead of
// exposing its first, arbitrary-source-order candidate); a word with no entry at all costs
// nothing and is simply skipped. Ties are broken toward the longest match at the earliest
// position, reproducing the old greedy-matchAt result whenever no real overlap exists.
function zdNomBestSegmentation(termIndex, text, words, annotateAsciiTerms) {
  var choice = zdNomSegmentationChoices(termIndex, text, words, annotateAsciiTerms);
  var n = words.length;
  var segments = [];
  var idx = 0;
  while (idx < n) {
    var picked = choice[idx];
    if (!picked) {
      idx++;
      continue;
    }
    segments.push({index: idx, length: picked.length, value: picked.value});
    idx += picked.length;
  }
  return segments;
}

// Number of ' / '-separated candidates in a Chu Nom value, without allocating the split array.
function zdNomCandidateCount(value) {
  var count = 1;
  var at = value.indexOf(' / ');
  while (at >= 0) {
    count++;
    at = value.indexOf(' / ', at + 3);
  }
  return count;
}

// The DP behind zdNomBestSegmentation: `choice[i]` is the match (`{length, value}`) the best
// segmentation of words[i..] starts with, or null when it skips words[i]. Because a subproblem
// depends only on the words after it, `choice` answers "what matches starting here?" for every
// word of the run at once -- zdCreateNomMatcher computes it once per run and reads it for each
// start position instead of re-running the DP from every word.
function zdNomSegmentationChoices(termIndex, text, words, annotateAsciiTerms) {
  var n = words.length;
  var dp = new Array(n + 1);
  var choice = new Array(n);
  dp[n] = 0;
  for (var i = n - 1; i >= 0; i--) {
    var matches = zdNomWordMatchesAt(termIndex, text, words, i, annotateAsciiTerms);
    if (!matches.length) {
      dp[i] = dp[i + 1];
      choice[i] = null;
      continue;
    }
    // Generated shortest first, so walking backwards is longest first and the strict `<` below
    // keeps the longest match on a cost tie.
    var bestCost = null;
    var best = null;
    for (var m = matches.length - 1; m >= 0; m--) {
      var match = matches[m];
      var wordCost = match.length > 1 ? 0 : zdNomCandidateCount(match.value) - 1;
      var total = wordCost + dp[i + match.length];
      if (bestCost === null || total < bestCost) {
        bestCost = total;
        best = match;
      }
    }
    dp[i] = bestCost;
    choice[i] = best;
  }
  return choice;
}

// Chu Nom (non-ASCII) matches always annotate. An ASCII-only match annotates only when
// `annotateAsciiTerms` says so: `true` always, `false` never, and `'safe'` (the default)
// annotates longer words (3+ letters, skipping a small blocklist of common short English
// words) or a short word sitting next to visible Vietnamese diacritics.
function zdNomShouldAnnotateMatch(text, start, end, annotateAsciiTerms) {
  var matchedText = text.substring(start, end);

  if (ZD_NOM_NON_ASCII_PATTERN.test(matchedText) || annotateAsciiTerms === true) {
    return true;
  }

  if (annotateAsciiTerms === false) {
    return false;
  }

  var normalized = matchedText.toLowerCase().replace(/\s+/g, ' ');
  var letterCount = normalized.replace(/\s/g, '').length;

  if (letterCount >= 3 && !ZD_NOM_ASCII_BLOCKLIST[normalized]) {
    return true;
  }

  return zdNomHasVietnameseContext(text, start, end);
}

// Builds a matcher bound to one term -> Chu Nom map. `options.annotateAsciiTerms` mirrors the
// userscript's SETTINGS.annotateAsciiTerms and defaults to 'safe' (see
// zdNomShouldAnnotateMatch above).
//
// `caseSensitiveMap` (optional) is exact spelling -> its own fully-hoisted candidate string,
// built by scripts/user-nom-order.js's `buildCaseSensitiveNomMap` from `user_nom_order.jsonc`
// rows marked `"caseSensitive": true` (e.g. the surname "Đỗ", read differently from the
// ordinary word "đỗ" that `nomMap` and the term index above -- both case-insensitive by construction
// -- cannot tell apart on their own). Checked here, once a match is already found, by the
// *exact* substring actually matched: this never changes which span matches or how long it is,
// only which candidate string that span reports, so it costs nothing on every occurrence that
// isn't an exact hit and never touches zdNomBestSegmentation's cost model. Mirrors
// `reader.nom.NomAnnotator.annotate`'s identical per-occurrence check in the book-translator
// project's Python engine.
function zdCreateNomMatcher(nomMap, options, caseSensitiveMap) {
  var annotateAsciiTerms = options && 'annotateAsciiTerms' in options
    ? options.annotateAsciiTerms
    : 'safe';
  var termIndex = zdNomBuildIndex(nomMap, annotateAsciiTerms);

  // The last word run analysed, with its DP choices. findNomMatch is called repeatedly on the
  // same text -- once per match, each resuming just past the previous one -- and a run's
  // segmentation does not depend on where in the run a scan starts (DP subproblems depend only
  // on the words after them, and every input to zdNomShouldAnnotateMatch is read from the full
  // text), so one analysis answers every start inside the run. Recomputing it from each word
  // start, as this used to, made a run of n words cost O(n^2).
  var cachedText = null;
  var cachedRun = null;

  function analyseRun(text, start) {
    var words = zdNomRunWords(text, start);
    if (!words.length) {
      return null;
    }
    return {
      first: start,
      last: words[words.length - 1].end,
      words: words,
      choice: zdNomSegmentationChoices(termIndex, text, words, annotateAsciiTerms),
      cursor: 0
    };
  }

  // The DP choice for the word starting at `start`, as {run, index}, or null when no run starts
  // there. `start` normally is a word start; anything else (a caller may pass any offset) gets a
  // private, uncached analysis so the answer is the same as a fresh run from that offset.
  function locate(text, start) {
    if (cachedText !== text) {
      cachedText = text;
      cachedRun = null;
    }

    var run = cachedRun;
    if (run && start >= run.first && start < run.last) {
      var words = run.words;
      var index = run.cursor;
      if (index >= words.length || words[index].start > start) {
        index = 0;
      }
      while (index < words.length && words[index].start < start) {
        index++;
      }
      if (index < words.length && words[index].start === start) {
        run.cursor = index;
        return {run: run, index: index};
      }
      var isolated = analyseRun(text, start);
      return isolated && {run: isolated, index: 0};
    }

    run = analyseRun(text, start);
    if (!run) {
      return null;
    }
    cachedRun = run;
    return {run: run, index: 0};
  }

  // The match whose first word is the one starting at `start`: the head of the best
  // segmentation of the run from there (see zdNomBestSegmentation for why this can differ from
  // simply walking for the single longest match starting here -- two real dictionary phrases can
  // overlap on a shared word). Null when the best segmentation skips that word.
  function matchAt(text, start) {
    var located = locate(text, start);
    if (!located) {
      return null;
    }
    var first = located.run.choice[located.index];
    if (!first) {
      return null;
    }
    var word = located.run.words[located.index + first.length - 1];
    var length = word.end - start;
    var nom = first.value;
    if (caseSensitiveMap) {
      var exact = caseSensitiveMap[text.substring(start, start + length)];
      if (exact) {
        nom = exact;
      }
    }
    return {index: start, length: length, nom: nom};
  }

  function findNomMatch(text, offset) {
    var len = text.length;
    for (var i = offset; i < len; i++) {
      if (!zdNomIsWordCode(text.charCodeAt(i)) || zdNomIsWordCode(text.charCodeAt(i - 1))) {
        continue;
      }

      var match = matchAt(text, i);
      if (match) {
        return match;
      }
    }

    return null;
  }

  // Whether `text` ends partway through a dictionary entry: some run of its trailing words is a
  // prefix of an entry that has more words after it. A caller whose text is split over several
  // DOM nodes asks this before paying to read the following nodes -- nearly every text node ends
  // in a word that no entry continues, and those never need the lookahead.
  function canContinuePast(text) {
    // The start offsets of the last 16 words, found from the end so a long text costs no more
    // than its tail.
    var starts = [];
    for (var i = text.length - 1; i >= 0 && starts.length < 16; i--) {
      if (zdNomIsWordCode(text.charCodeAt(i)) && !zdNomIsWordCode(text.charCodeAt(i - 1))) {
        starts.push(i);
      }
    }
    if (!starts.length) {
      return false;
    }

    // Each candidate run is the tail of the text from one of those starts, lowercased with every
    // whitespace character read as a single space. It continues into a longer entry exactly when
    // it, less one trailing space, is a proper word-prefix of some entry.
    for (var s = 0; s < starts.length; s++) {
      var run = zdNomLower(text.substring(starts[s]).replace(ZD_NOM_WHITESPACE_RUN_PATTERN, ' '));
      if (run.charCodeAt(run.length - 1) === 32) {
        run = run.substring(0, run.length - 1);
      }
      if (termIndex.hasPrefix(run)) {
        return true;
      }
    }
    return false;
  }

  return {index: termIndex, matchAt: matchAt, findNomMatch: findNomMatch, canContinuePast: canContinuePast};
}

// Present only under Node, so the engine is unit-testable and CLI-callable without a browser.
// A userscript or a classic <script> has no `module`, and `typeof` on an undeclared name is
// safe.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ZD_NOM_WORD_CHAR_PATTERN: ZD_NOM_WORD_CHAR_PATTERN,
    ZD_NOM_WHITESPACE_PATTERN: ZD_NOM_WHITESPACE_PATTERN,
    ZD_NOM_NON_ASCII_PATTERN: ZD_NOM_NON_ASCII_PATTERN,
    ZD_NOM_VIETNAMESE_SIGNAL_PATTERN: ZD_NOM_VIETNAMESE_SIGNAL_PATTERN,
    ZD_NOM_ASCII_BLOCKLIST: ZD_NOM_ASCII_BLOCKLIST,
    zdNomIsWordChar: zdNomIsWordChar,
    zdNomIsWhitespace: zdNomIsWhitespace,
    zdNomBuildIndex: zdNomBuildIndex,
    zdNomLower: zdNomLower,
    zdNomHasVietnameseContext: zdNomHasVietnameseContext,
    zdNomShouldAnnotateMatch: zdNomShouldAnnotateMatch,
    zdNomRunWords: zdNomRunWords,
    zdNomWordMatchesAt: zdNomWordMatchesAt,
    zdNomBestSegmentation: zdNomBestSegmentation,
    zdNomSegmentationChoices: zdNomSegmentationChoices,
    zdNomIsWordCode: zdNomIsWordCode,
    zdNomIsWhitespaceCode: zdNomIsWhitespaceCode,
    zdCreateNomMatcher: zdCreateNomMatcher
  };
}
