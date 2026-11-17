  // A fragment of nom-ruby.runtime.js, moved out of it verbatim (no renames, no body changes).
  // scripts/build-nom-userscript.js inlines it where it used to sit, inside the one IIFE of
  // nom-ruby.runtime.js, so it shares that scope; nothing is exported.
  // Holds: the DOM annotation writers -- readAhead, overlay recording, annotateTextNode, createRuby,
  // wrapMatches, wrapPiece, wordSpans and annotateAcrossNodes.
  // Relies on shared-IIFE names declared elsewhere:
  // SETTINGS, doc, newNodes, injections, mode, overlay, siteFix, getNomMatcher and ensureFontFace
  // (nom-ruby.runtime.js), isExcludedElement (nom-ruby-scan.js), and the zd* word primitives
  // (zd-words.js, zd-nom-match.js).

  var AHEAD_MAX_CHARS = 400;
  var AHEAD_MAX_NODES = 60;

  // True when `node` sits inside markup this script never annotates (an existing <ruby>, code,
  // an input, ...), up to and including `boundary`.
  function isInsideExcluded(node, boundary) {
    for (var el = node.parentNode; el; el = el.parentNode) {
      if (el.nodeType === Node.ELEMENT_NODE && isExcludedElement(el)) {
        return true;
      }
      if (el === boundary) {
        return false;
      }
    }
    return false;
  }

  // A caption widget (Eudict) renders every word in its own wrapper, so a dictionary entry of
  // several words never sits inside one text node and matching a node by itself can only ever
  // see one word of it. This returns the node's text followed by the word/space run that
  // continues in the text nodes after it -- the same reading order zd-words.js gives the popup
  // dictionary -- together with which node each stretch of that text came from. Only the first
  // node is ever annotated *from*; the rest is context, and the words of a match found in it
  // are wrapped where they are (see annotateAcrossNodes).
  function readAhead(textNode, own) {
    var text = own.replace(/\u00a0/g, ' ');
    var ahead = {text: text, segments: [{node: textNode, start: 0, end: own.length}]};

    if (!(getNomMatcher().canContinuePast(text) || getNomMatcher().needsEnglishContext(text)) || !textNode.parentNode) {
      return ahead;
    }

    var boundary = zdContainerBoundary(textNode);
    var node = zdNextTextNode(textNode, boundary);
    var guard = 0;

    while (node && text.length < AHEAD_MAX_CHARS && guard < AHEAD_MAX_NODES) {
      guard++;
      var data = node.nodeValue;
      if (isInsideExcluded(node, boundary) || data !== data.normalize('NFC')) {
        break;
      }

      var i = 0;
      while (i < data.length && (zdNomIsWordChar(data.charAt(i)) || /\s/.test(data.charAt(i)))) {
        i++;
      }
      if (i === 0) {
        break;
      }

      // "ch" + "ỉ" in two nodes is one word split by markup, not two words: reading on would
      // treat the first half as a whole word, so stop before it if it began after the node.
      if (zdNomIsWordChar(text.charAt(text.length - 1)) && zdNomIsWordChar(data.charAt(0))) {
        var cut = text.length;
        while (cut > 0 && zdNomIsWordChar(text.charAt(cut - 1))) {
          cut--;
        }
        if (cut >= own.length) {
          text = text.substring(0, cut);
          ahead.segments = ahead.segments.filter(function(segment) {
            return segment.start < cut;
          });
          ahead.segments.forEach(function(segment) {
            segment.end = Math.min(segment.end, cut);
          });
        } else {
          return {text: text.substring(0, own.length), segments: [ahead.segments[0]]};
        }
        break;
      }

      ahead.segments.push({node: node, start: text.length, end: text.length + i});
      text += data.substring(0, i).replace(/\u00a0/g, ' ');
      if (i < data.length) {
        break;
      }
      node = zdNextTextNode(node, boundary);
    }

    ahead.text = text;
    return ahead;
  }

  // True when the text sits under an element that declares a language other than Vietnamese
  // (the book reader tags every translated line, e.g. lang="en"). The document root is ignored:
  // sites set <html lang="en"> on pages that are written in Vietnamese. Such text is not
  // Vietnamese, so its ASCII-only dictionary hits (the, him, them) are not annotated; Chu Nom
  // terms spelt with Vietnamese diacritics still are.
  function isDeclaredNonVietnamese(textNode) {
    var el = textNode.parentElement;
    var tagged = el && el.closest ? el.closest('[lang]') : null;
    if (!tagged || tagged === doc.documentElement) {
      return false;
    }
    var lang = (tagged.getAttribute('lang') || '').toLowerCase();
    return !!lang && lang !== 'vi' && lang.indexOf('vi-') !== 0;
  }

  // Overlay mode: the same matching as annotateTextNode, but nothing is inserted into the page. Each match
  // becomes a record; a reading with one character per word gets one character over each word.
  function overlayAnnotate(textNode) {
    var normalized = textNode.nodeValue.normalize('NFC');
    if (normalized !== textNode.nodeValue) textNode.nodeValue = normalized;
    var known = overlay.known(textNode);
    if (known && known.text === normalized) return;
    var records = [];
    if (ZD_NOM_WORD_CHAR_PATTERN.test(normalized)) {
      var ahead = readAhead(textNode, normalized);
      var nonVietnamese = isDeclaredNonVietnamese(textNode);
      var offset = 0;
      var match;
      while ((match = getNomMatcher().findNomMatch(ahead.text, offset)) && match.index < normalized.length) {
        offset = match.index + match.length;
        if (nonVietnamese && !ZD_NOM_NON_ASCII_PATTERN.test(ahead.text.substr(match.index, match.length))) continue;
        if (match.index + match.length > normalized.length) break; // spans into the next node: not drawn
        records.push(overlayRecord(normalized, match));
      }
    }
    if (records.length) ensureFontFace();
    overlay.set(textNode, normalized, records);
  }

  function overlayRecord(text, match) {
    var chars = [...rubyText(match.nom)];
    var spans = wordSpans(text, match.index, match.index + match.length);
    var pieces = chars.length === spans.length && chars.length > 1
      ? spans.map(function(span, index) { return {text: chars[index], from: span.start, to: span.end}; })
      : [{text: chars.join('')}];
    return {
      start: match.index,
      end: match.index + match.length,
      layers: [{under: false, scale: 0.65, color: '#B6638F', family: "'Zoopdog Nom Na Tong', sans-serif",
        weight: '600', pieces: pieces}]
    };
  }

  function annotateTextNode(textNode) {
    if (mode === 'overlay') {
      overlayAnnotate(textNode);
      return;
    }
    // A source segment already belongs to an active annotation. Its separate trailing node
    // is queued on insertion; rescanning the segment would replace its ownership record.
    if (injections.has(textNode)) return;
    // Some pages and extensions rewrite text nodes into decomposed Unicode, where "vùng" is
    // "v" + "u" + U+0300 + "ng" and stops the precomposed-keyed trie one combining mark deep.
    // Normalising in place keeps splitText offsets valid against the string being matched.
    var normalized = textNode.nodeValue.normalize('NFC');

    if (normalized !== textNode.nodeValue) {
      textNode.nodeValue = normalized;
    }

    // Whitespace, punctuation and non-Latin scripts (a CJK page is all of them) hold no word
    // character, so nothing can match and there is nothing to read ahead. The NFC rewrite above
    // still happens first, so a page sees the same normalisation as before.
    if (!ZD_NOM_WORD_CHAR_PATTERN.test(normalized)) {
      return;
    }

    // Matching walks the original, un-split text so a short ASCII-only word (e.g. "xe")
    // keeps the Vietnamese diacritics around it in view for shouldAnnotateMatch, even after
    // an earlier match in the same sentence has been spliced out into its own ruby node.
    var ownText = textNode.nodeValue;
    var ahead = readAhead(textNode, ownText);
    var matches = [];
    var crossing = null;
    var offset = 0;
    var match;
    var nonVietnamese = isDeclaredNonVietnamese(textNode);

    // A match is this node's to annotate only if it starts inside it; one that starts in the
    // text read ahead belongs to the node it starts in.
    while ((match = getNomMatcher().findNomMatch(ahead.text, offset)) && match.index < ownText.length) {
      if (nonVietnamese && !ZD_NOM_NON_ASCII_PATTERN.test(ahead.text.substr(match.index, match.length))) {
        offset = match.index + match.length;
        continue;
      }

      if (match.index + match.length > ownText.length) {
        crossing = match;
        break;
      }

      matches.push(match);
      offset = match.index + match.length;
    }

    if (!matches.length && !crossing) {
      return;
    }

    var inserted = [];
    var ownership = {nodes: inserted, segments: [{node: textNode, original: ownText}]};
    var node = textNode;
    if (matches.length) {
      node = wrapMatches(textNode, ownText, matches, inserted);
    }
    if (crossing) {
      annotateAcrossNodes(crossing, ahead, node, offset, inserted, ownership);
    }

    if (crossing) {
      ownership.segments.forEach(function(segment) {
        segment.text = segment.node.nodeValue;
        injections.set(segment.node, ownership);
      });
    } else injections.set(textNode, {nodes: inserted, text: textNode.nodeValue});
  }

  function rubyText(nom) {
    return SETTINGS.showAllVariants ? nom : nom.split(' / ')[0];
  }

  function createRuby(matchedText, reading, nom) {
    ensureFontFace();
    var ruby = doc.createElement('ruby');
    ruby.className = 'zoopdog-nom-ruby';
    ruby.title = 'Chu Nom: ' + nom;
    ruby.appendChild(doc.createTextNode(matchedText));

    var rt = doc.createElement('rt');
    rt.className = 'zoopdog-nom-rt';
    rt.textContent = reading;
    ruby.appendChild(rt);
    return ruby;
  }

  // Applies every match found inside `textNode` (all of which start and end within `ownText`)
  // in one insertion. The node keeps the text before the first match -- exactly what splitText
  // leaves behind, which the page's own reference to the node and the `injections` bookkeeping
  // rely on -- and one fragment carries, in order, each ruby and the text after it. Pushes the
  // inserted nodes onto `inserted` and returns the node holding the text after the last match.
  function wrapMatches(textNode, ownText, matches, inserted) {
    var fragment = doc.createDocumentFragment();
    var last = null;

    for (var i = 0; i < matches.length; i++) {
      var current = matches[i];
      var end = current.index + current.length;
      var nextStart = i + 1 < matches.length ? matches[i + 1].index : ownText.length;
      // One character per word: each word gets its own <ruby>, so every character sits over its own
      // word instead of being spread evenly over a phrase whose words differ in width.
      var chars = [...rubyText(current.nom)];
      var spans = wordSpans(ownText, current.index, end);
      if (siteFix.perWord && chars.length === spans.length && chars.length > 1) {
        var cursor = current.index;
        for (var k = 0; k < spans.length; k++) {
          var gap = ownText.substring(cursor, spans[k].start);
          if (gap) {
            var gapNode = doc.createTextNode(gap);
            fragment.appendChild(gapNode);
            inserted.push(gapNode);
          }
          var wordRuby = createRuby(ownText.substring(spans[k].start, spans[k].end), chars[k], current.nom);
          fragment.appendChild(wordRuby);
          inserted.push(wordRuby);
          cursor = spans[k].end;
        }
        if (cursor < end) {
          var tailNode = doc.createTextNode(ownText.substring(cursor, end));
          fragment.appendChild(tailNode);
          inserted.push(tailNode);
        }
      } else {
        var ruby = createRuby(ownText.substring(current.index, end), rubyText(current.nom), current.nom);
        fragment.appendChild(ruby);
        inserted.push(ruby);
      }
      last = doc.createTextNode(ownText.substring(end, nextStart));
      fragment.appendChild(last);
      inserted.push(last);
    }

    textNode.nodeValue = ownText.substring(0, matches[0].index);
    textNode.parentNode.insertBefore(fragment, textNode.nextSibling);
    return last;
  }

  // Splits `node` around [start, end), moves that text into a <ruby> carrying `reading`, and
  // returns the node holding whatever followed it.
  function wrapPiece(node, start, end, reading, nom) {
    var after = node.splitText(start);
    var matchedText = after.nodeValue.substring(0, end - start);
    after.nodeValue = after.nodeValue.substring(end - start);

    after.parentNode.insertBefore(createRuby(matchedText, reading, nom), after);
    return after;
  }

  // The word spans (start/end offsets into `text`) inside [from, to).
  function wordSpans(text, from, to) {
    var spans = [];
    var i = from;
    while (i < to) {
      if (!zdNomIsWordChar(text.charAt(i))) {
        i++;
        continue;
      }
      var start = i;
      while (i < to && zdNomIsWordChar(text.charAt(i))) {
        i++;
      }
      spans.push({start: start, end: i});
    }
    return spans;
  }

  // A match whose words sit in different text nodes cannot share one <ruby> -- a <ruby> holds
  // one node's text -- so each word is wrapped in place and given one character of the entry's
  // reading. That needs the reading to have as many characters as the entry has words, as
  // "chỉ trích" -> 指責 does; a reading of any other shape goes on the first word whole.
  // `node`/`offset` are this node's not-yet-consumed tail and where that tail starts.
  function annotateAcrossNodes(match, ahead, node, offset, inserted, ownership) {
    var spans = wordSpans(ahead.text, match.index, match.index + match.length);
    var reading = match.nom.split(' / ')[0];
    var chars = [...reading];
    var perWord = chars.length === spans.length;
    var pieces = [];

    for (var k = 0; k < spans.length; k++) {
      var span = spans[k];
      var segment = ahead.segments.filter(function(candidate) {
        return span.start >= candidate.start && span.end <= candidate.end;
      })[0];
      if (!segment) {
        return;
      }
      pieces.push({
        segment: segment,
        start: span.start - segment.start,
        end: span.end - segment.start,
        reading: perWord ? chars[k] : (k === 0 ? reading : null)
      });
    }

    // Each segment's remaining tail and where that tail starts in the segment's own text: the
    // first segment is this node, already partly consumed by matches before this one.
    var tails = new Map();
    tails.set(ahead.segments[0], {node: node, base: offset});

    pieces.forEach(function(piece) {
      var isOwn = piece.segment === ahead.segments[0];
      var tail = tails.get(piece.segment) || {node: piece.segment.node, base: 0};

      if (!isOwn && !ownership.segments.some(function(segment) { return segment.node === piece.segment.node; })) {
        ownership.segments.push({node: piece.segment.node, original: piece.segment.node.nodeValue});
      }

      if (piece.reading === null) {
        // No ruby is drawn for this word, but its segment is still part of the match. Split
        // off the suffix so it can be scanned independently without re-annotating the word.
        var suffix = tail.node.splitText(piece.end - tail.base);
        tails.set(piece.segment, {node: suffix, base: piece.end});
        var unwrapped = ownership.segments.filter(function(segment) { return segment.node === piece.segment.node; })[0];
        unwrapped.tail = suffix;
        unwrapped.tailBase = piece.end;
        inserted.push(suffix);
        return;
      }

      var after = wrapPiece(tail.node, piece.start - tail.base, piece.end - tail.base,
        piece.reading, match.nom);
      tails.set(piece.segment, {node: after, base: piece.end});
      var owned = ownership.segments.filter(function(segment) { return segment.node === piece.segment.node; })[0];
      owned.tail = after;
      owned.tailBase = piece.end;
      inserted.push(after.previousSibling, after);
    });

    // The text left after the last wrapped word of a following node is a new node no scan has
    // seen. It used to reach the next pass through the mutation records this script's own writes
    // produced; those are now discarded (see rescanTextNodes), so it is queued explicitly.
    tails.forEach(function(tail, segment) {
      if (segment !== ahead.segments[0] && tail.node !== segment.node) {
        newNodes.add(tail.node);
      }
    });
  }
