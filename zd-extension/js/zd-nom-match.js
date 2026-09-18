// Shared Chu Nom text-matching engine.
//
// Walks a trie built from a term -> Chu Nom map and finds the longest match at a given
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

function zdNomIsWordChar(ch) {
  return !!ch && ZD_NOM_WORD_CHAR_PATTERN.test(ch);
}

function zdNomIsWhitespace(ch) {
  return !!ch && ZD_NOM_WHITESPACE_PATTERN.test(ch);
}

// `annotateAsciiTerms === false` drops every ASCII-only term at build time, so an ASCII word
// can never match at all when the caller wants Chu Nom (non-ASCII) terms exclusively.
function zdNomBuildTrie(map, annotateAsciiTerms) {
  var root = {};

  Object.keys(map).forEach(function(term) {
    if (annotateAsciiTerms === false && !ZD_NOM_NON_ASCII_PATTERN.test(term)) {
      return;
    }

    var node = root;
    for (var i = 0; i < term.length; i++) {
      var ch = term.charAt(i);
      node.children = node.children || {};
      node.children[ch] = node.children[ch] || {};
      node = node.children[ch];
    }
    node.value = map[term];
  });

  return root;
}

function zdNomHasVietnameseContext(text, start, end) {
  var contextStart = Math.max(0, start - 80);
  var contextEnd = Math.min(text.length, end + 80);
  return ZD_NOM_VIETNAMESE_SIGNAL_PATTERN.test(text.substring(contextStart, contextEnd));
}

// The word spans of the maximal run starting exactly at `start` (which must itself be a word
// start) that are joined only by spaces -- a comma, line break, or any other non-space gap ends
// the run. Mirrors reader.nom's `_split_runs` in the book-translator project's Python engine,
// and is the word-level counterpart to the character-level trie transitions matchAt already
// relies on: the two engines segment the same class of text the same way, even though one walks
// characters and the other walks pre-tokenized words.
function zdNomRunWords(text, start) {
  var words = [];
  var i = start;
  var len = text.length;
  while (i < len && zdNomIsWordChar(text.charAt(i))) {
    var wordStart = i;
    while (i < len && zdNomIsWordChar(text.charAt(i))) {
      i++;
    }
    words.push({start: wordStart, end: i});
    var gapStart = i;
    while (i < len && zdNomIsWhitespace(text.charAt(i))) {
      i++;
    }
    if (i >= len || !zdNomIsWordChar(text.charAt(i)) || text.substring(gapStart, i).replace(/ /g, '').length) {
      break;
    }
  }
  return words;
}

// Every dictionary match starting at `words[index]`, shortest first -- unlike the old
// single-longest matchAt walk, this keeps every intermediate hit so zdNomBestSegmentation can
// weigh a shorter match against a longer one starting at the very same word instead of the trie
// walk silently picking whichever happens to be longest. See the "duyên"/"có duyên" regression
// this exists to fix: two genuine dictionary phrases can overlap on a shared word, and only
// comparing the whole run's total cost, not just what is longest at one position, tells which
// one should give way.
function zdNomWordMatchesAt(trie, text, words, index, annotateAsciiTerms) {
  var node = trie;
  var matches = [];
  for (var offset = index; offset < words.length; offset++) {
    if (offset > index) {
      if (!node.children || !node.children[' ']) {
        break;
      }
      node = node.children[' '];
    }
    var word = words[offset];
    var ok = true;
    for (var i = word.start; i < word.end; i++) {
      var ch = text.charAt(i).toLowerCase();
      if (!node.children || !node.children[ch]) {
        ok = false;
        break;
      }
      node = node.children[ch];
    }
    if (!ok) {
      break;
    }
    if (node.value && zdNomShouldAnnotateMatch(text, words[index].start, word.end, annotateAsciiTerms)) {
      matches.push({length: offset - index + 1, value: node.value});
    }
  }
  return matches;
}

// The lowest-total-ambiguity way to cover `words` with trie matches, as an ordered list of
// {index, length, value}. Same cost model as reader.nom's `_best_segmentation` in the
// book-translator project: a multi-word phrase match costs 0 (a deliberately curated entry,
// trusted outright); a single-word match costs `candidateCount - 1` (the raw, unranked
// candidate list a lone word carries -- worth absorbing into a neighbouring phrase instead of
// exposing its first, arbitrary-source-order candidate); a word with no entry at all costs
// nothing and is simply skipped. Ties are broken toward the longest match at the earliest
// position, reproducing the old greedy-matchAt result whenever no real overlap exists.
function zdNomBestSegmentation(trie, text, words, annotateAsciiTerms) {
  var n = words.length;
  var dp = new Array(n + 1);
  var choice = new Array(n);
  dp[n] = 0;
  for (var i = n - 1; i >= 0; i--) {
    var matches = zdNomWordMatchesAt(trie, text, words, i, annotateAsciiTerms);
    if (!matches.length) {
      dp[i] = dp[i + 1];
      choice[i] = null;
      continue;
    }
    matches.sort(function(a, b) { return b.length - a.length; });
    var bestCost = null;
    var best = null;
    for (var m = 0; m < matches.length; m++) {
      var candidateCount = matches[m].value.split(' / ').length;
      var wordCost = matches[m].length > 1 ? 0 : Math.max(0, candidateCount - 1);
      var total = wordCost + dp[i + matches[m].length];
      if (bestCost === null || total < bestCost) {
        bestCost = total;
        best = matches[m];
      }
    }
    dp[i] = bestCost;
    choice[i] = best;
  }

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
// ordinary word "đỗ" that `nomMap` and the trie above -- both case-insensitive by construction
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
  var trie = zdNomBuildTrie(nomMap, annotateAsciiTerms);

  // Finds the word run starting exactly at `start` and segments it via zdNomBestSegmentation,
  // returning that segmentation's first step as the match -- see zdNomBestSegmentation for why
  // this can differ from simply walking the trie for the single longest match starting here
  // (two real dictionary phrases can overlap on a shared word). Because DP subproblems have no
  // dependency on what came before a given word, recomputing the run fresh from each new
  // `start` findNomMatch calls with (after splicing the previous match out) always agrees with
  // what a single whole-run computation would have chosen for that suffix.
  function matchAt(text, start) {
    var words = zdNomRunWords(text, start);
    if (!words.length) {
      return null;
    }
    var segments = zdNomBestSegmentation(trie, text, words, annotateAsciiTerms);
    if (!segments.length || segments[0].index !== 0) {
      return null;
    }
    var first = segments[0];
    var word = words[first.length - 1];
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
    for (var i = offset; i < text.length; i++) {
      if (!zdNomIsWordChar(text.charAt(i)) || zdNomIsWordChar(text.charAt(i - 1))) {
        continue;
      }

      var match = matchAt(text, i);
      if (match) {
        return match;
      }
    }

    return null;
  }

  return {trie: trie, matchAt: matchAt, findNomMatch: findNomMatch};
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
    zdNomBuildTrie: zdNomBuildTrie,
    zdNomHasVietnameseContext: zdNomHasVietnameseContext,
    zdNomShouldAnnotateMatch: zdNomShouldAnnotateMatch,
    zdNomRunWords: zdNomRunWords,
    zdNomWordMatchesAt: zdNomWordMatchesAt,
    zdNomBestSegmentation: zdNomBestSegmentation,
    zdCreateNomMatcher: zdCreateNomMatcher
  };
}
