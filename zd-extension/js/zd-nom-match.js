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
function zdCreateNomMatcher(nomMap, options) {
  var annotateAsciiTerms = options && 'annotateAsciiTerms' in options
    ? options.annotateAsciiTerms
    : 'safe';
  var trie = zdNomBuildTrie(nomMap, annotateAsciiTerms);

  // Walks the trie from `start`, tracking the longest prefix of `text` that both exists in
  // the map and passes zdNomShouldAnnotateMatch -- a later, longer match wins over an earlier,
  // shorter one only because the walk keeps going and keeps overwriting `best`.
  function matchAt(text, start) {
    var node = trie;
    var i = start;
    var best = null;

    while (i < text.length) {
      var ch = text.charAt(i);

      if (zdNomIsWhitespace(ch)) {
        if (!node.children || !node.children[' ']) {
          break;
        }
        while (i < text.length && zdNomIsWhitespace(text.charAt(i))) {
          i++;
        }
        node = node.children[' '];
      } else {
        ch = ch.toLowerCase();
        if (!node.children || !node.children[ch]) {
          break;
        }
        node = node.children[ch];
        i++;
      }

      if (node.value && !zdNomIsWordChar(text.charAt(i)) &&
          zdNomShouldAnnotateMatch(text, start, i, annotateAsciiTerms)) {
        best = {index: start, length: i - start, nom: node.value};
      }
    }

    return best;
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
    zdCreateNomMatcher: zdCreateNomMatcher
  };
}
