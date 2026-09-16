// Shared Vietnamese word primitives.
//
// Defined here once and consumed by the extension content script, the website popup demo, and
// the generated popup-dictionary userscript. Plain top-level declarations with no module
// system, matching zd-pron-*.js: loaded as a classic script they become globals, and inlined
// into the userscript IIFE they stay scoped to it.
//
// Edit this file, never a consumer's copy. test/scripts-structure.test.js fails if any
// consumer redefines one of these names.

// Deliberately not global (`/g`): these are used with .test() on single characters, and a
// global regex carries lastIndex between calls, which makes every other test fail.
// The U+0300-U+036F range covers decomposed input: when a page writes "vùng" as
// "v" + "u" + U+0300 + "ng", a combining mark that is not a word char ends the walk in
// getWordAndContext mid-syllable and the lookup sees "vu".
const ZD_WORD_CHAR_RE = /[-ÐA-Za-zÀÁÂÃÈÉÊÌÍÒÓÔÕÙÚĂĐĨŨƠƯàáâãèéêìíòóôõùúăđĩũơưẠẢẤẦẨẪẬẮẰẲẴẶẸẺẼỀẾỂỄỆỈỊỌỎỐỒỔỖỘỚỜỞỠỢỤỦỨỪỬỮỰỲỴÝỶỸạảấầẩẫậắằẳẵặẹẻẽềếểễệỉịọỏốồổỗộớờởỡợụúủứừửữựỳýỵỷỹ\u0300-\u036f]/u;

function zdIsWordChar(ch) {
  return !!ch && ZD_WORD_CHAR_RE.test(ch);
}

// How far out of the container the caret named the search may widen. Four
// levels is enough to climb from a click-target overlay to the card that
// holds both it and the text underneath, and short enough that a point over
// genuinely empty space finds nothing rather than some distant word.
const ZD_TEXT_SEARCH_MAX_LEVELS = 4;

// The text node whose own rect contains (x, y), or null -- what
// elementFromPoint answers for elements, answered here for text.
//
// Strictly containing, never merely nearest: a point in the gap between two
// words belongs to neither, and answering "the closest one" there made the
// popup show for a word the pointer was not on, then hide again on the next
// move, which reads as a flicker.
//
// Subtrees whose own box misses the point are skipped, so this costs a walk
// down one branch rather than over the whole container.
function zdTextNodeAtPoint(root, x, y) {
  if (!root || typeof document === 'undefined' || !document.createRange) {
    return null;
  }
  let found = null;

  function visit(node) {
    if (found) {
      return;
    }
    if (node.nodeType === 3) {
      if (!node.data || !node.data.trim()) {
        return;
      }
      const range = document.createRange();
      range.selectNodeContents(node);
      const rects = range.getClientRects();
      for (let i = 0; i < rects.length; i++) {
        const rect = rects[i];
        if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
          found = node;
          return;
        }
      }
      return;
    }
    if (node.nodeType === 1 && typeof node.getBoundingClientRect === 'function') {
      const box = node.getBoundingClientRect();
      if (box.width && box.height &&
          (x < box.left || x > box.right || y < box.top || y > box.bottom)) {
        return;
      }
    }
    // A caption or translation overlay widget (Eudict, Immersive Translate) renders its actual
    // text inside its own open shadow root to keep the host page's CSS out -- real, painted
    // content that childNodes never includes, so a plain tree walk finds nothing there at all.
    if (node.shadowRoot) {
      visit(node.shadowRoot);
      if (found) {
        return;
      }
    }
    const children = node.childNodes;
    if (!children) {
      return;
    }
    for (let i = 0; i < children.length && !found; i++) {
      visit(children[i]);
    }
  }

  visit(root);
  return found;
}

// The caret APIs below are meant to resolve to a text node, but over certain
// compact or CSS-quirky layouts -- a heading packed tight inside a link, an
// ellipsis-truncated breadcrumb, a word this very script wrapped in <ruby> --
// Chromium's hit-testing gives up and hands back an *element* boundary
// instead (a documented engine limitation, not something either side did
// wrong): "the caret would go here, among this container's children" rather
// than a precise text offset.
//
// The element it names is not always one the text even lives in. A search
// result card puts a link-shaped click target over the whole row, so both
// this API and elementFromPoint answer with that overlay while the word the
// pointer is on sits in a sibling subtree underneath -- searching the
// overlay finds the card's title, or nothing, never the line being hovered.
// So the search widens outward from the named element until it reaches an
// ancestor that holds the text actually under the pointer.
function zdRecoverTextNode(container, x, y) {
  let node = container;
  for (let level = 0; node && level <= ZD_TEXT_SEARCH_MAX_LEVELS; level++) {
    const found = zdTextNodeAtPoint(node, x, y);
    if (found) {
      return found;
    }
    node = node.parentElement;
  }
  return zdRecoverTextNodeFromWholePage(x, y);
}

// The climb above assumes the overlay and the real text share a close-enough ancestor -- true
// for a search result's click-target row, false for a video-caption translation widget (Eudict,
// Immersive Translate, Dualsub) that injects its own empty overlay element as an unrelated
// sibling subtree, positioned on top of the player rather than wrapping it. Climbing that
// overlay's own ancestors never reaches the caption text, because it was never inside them.
// document.body is a shared ancestor of everything on the page, so searching from there finds
// the real text regardless of which subtree the overlay lives in; zdTextNodeAtPoint's own
// bounding-box pruning (skip a subtree whose box excludes the point) keeps this a bounded walk
// of the handful of elements actually painted at that pixel, not the whole DOM.
function zdRecoverTextNodeFromWholePage(x, y) {
  if (typeof document === 'undefined' || !document.body) {
    return null;
  }
  return zdTextNodeAtPoint(document.body, x, y);
}

// Point resolution differs per engine and per caller. The extension passes client coordinates
// only; the website page also has page coordinates, and there are documents where the client
// pair resolves to nothing while the page pair resolves correctly. Trying the page pair second
// gives every consumer the fallback that previously existed on the website alone.
function zdCaretFromPoint(mouse) {
  const points = [[mouse.x, mouse.y]];
  if (Number.isFinite(mouse.pageX) && Number.isFinite(mouse.pageY) &&
      (mouse.pageX !== mouse.x || mouse.pageY !== mouse.y)) {
    points.push([mouse.pageX, mouse.pageY]);
  }

  for (const [x, y] of points) {
    if (document.caretPositionFromPoint) {            // Firefox
      const position = document.caretPositionFromPoint(x, y);
      if (position) {
        if (position.offsetNode && position.offsetNode.nodeType === 3) {
          return {node: position.offsetNode, offset: position.offset};
        }
        const near = zdRecoverTextNode(position.offsetNode, x, y);
        if (near) {
          return {node: near, offset: 0, atPoint: true};
        }
      }
    } else if (document.caretRangeFromPoint) {        // Chrome
      const range = document.caretRangeFromPoint(x, y);
      if (range) {
        if (range.startContainer && range.startContainer.nodeType === 3) {
          return {node: range.startContainer, offset: range.startOffset};
        }
        const near = zdRecoverTextNode(range.startContainer, x, y);
        if (near) {
          return {node: near, offset: 0, atPoint: true};
        }
      }
    } else {
      return null;
    }
  }
  return null;
}

// A Nom-annotated page (the book-translator reader, Zoopdog's own nom-ruby userscript) wraps
// each word in its own <ruby>, with the Chu Nom reading tucked into a sibling <rt>. That makes
// the sentence, in DOM terms, a chain of short text nodes rather than one long one, so a
// compound dictionary entry whose words straddle two <ruby> tags (e.g. "câu" and "nói" each in
// their own tag) can never be read by scanning a single node's `data`. The helpers below let
// both the context lookup and the highlighter continue past a node's end into whatever comes
// next in reading order, while treating <rt> subtrees as invisible -- a reading gloss is not
// part of the word stream.
const ZD_CONTEXT_MAX_CHARS = 400;
const ZD_CONTEXT_MAX_NODES = 60;

function zdNextNode(node, boundary) {
  if (node.firstChild) {
    let child = node.firstChild;
    while (child && child.nodeType === 1 && child.tagName === 'RT') {
      child = child.nextSibling;
    }
    if (child) {
      return child;
    }
  }
  let cur = node;
  while (cur && cur !== boundary) {
    let sib = cur.nextSibling;
    while (sib && sib.nodeType === 1 && sib.tagName === 'RT') {
      sib = sib.nextSibling;
    }
    if (sib) {
      return sib;
    }
    cur = cur.parentNode;
  }
  return null;
}

// The next Text node after `node` in document order, bounded by `boundary` (never ascended
// past) and blind to <rt> subtrees.
function zdNextTextNode(node, boundary) {
  let cur = zdNextNode(node, boundary);
  while (cur && cur.nodeType !== 3) {
    cur = zdNextNode(cur, boundary);
  }
  return cur;
}

// Computed `display` values that keep an element's content in the surrounding inline flow --
// climbing through these (and no further) is what lets the walk leave one <ruby> and arrive at
// the next one still inside the same line, without being willing to walk into a wrapper that
// could mean "different paragraph". `ruby` itself is in this list: it is an inline-level box,
// but is neither literally "inline" nor "inline-block", so a narrower check would stop the walk
// at the very first <ruby>, one level up from the click.
const ZD_INLINE_DISPLAY_VALUES = new Set([
  'inline', 'inline-block', 'inline-flex', 'inline-grid', 'inline-table', 'contents',
  'ruby', 'ruby-base', 'ruby-text', 'ruby-base-container', 'ruby-text-container'
]);

// How far a context walk may widen looking for a boundary ancestor -- deep enough to clear a
// <ruby> sitting inside a couple of wrapper spans, shallow enough that a point in genuinely
// unstructured markup falls back to `document.body` quickly.
const ZD_CONTAINER_SEARCH_MAX_LEVELS = 8;

// The nearest ancestor of `node` whose own box breaks the inline flow (typically the paragraph
// or line the word sits in), so a forward context walk stops at the end of that text instead of
// wandering into whatever comes after it just because the last visible character happened to be
// a word character or a space.
function zdContainerBoundary(node) {
  let el = node.nodeType === 1 ? node : node.parentElement;
  let level = 0;
  while (el && el.parentElement && level < ZD_CONTAINER_SEARCH_MAX_LEVELS) {
    const style = typeof getComputedStyle === 'function' ? getComputedStyle(el) : null;
    const display = style && style.display;
    if (!display || !ZD_INLINE_DISPLAY_VALUES.has(display)) {
      return el;
    }
    el = el.parentElement;
    level++;
  }
  return el || (typeof document !== 'undefined' && document.body);
}

// A connecting text node between two <ruby>/<span> word wrappers is often just whitespace, and
// on server-rendered markup that whitespace is whatever indentation the template happened to
// leave between tags -- a newline, a run of spaces -- not always the single literal " " a
// hand-written sentence would have. Treated strictly, that stops the walk on page-formatting
// whitespace as if it were real punctuation.
const ZD_INTER_WORD_SPACE_RE = /\s/;

// Continues the word/space run that ends exactly at the end of `fromNode`'s data into whatever
// text nodes follow in reading order, stopping at the first real non-word, non-space character
// (or the container boundary, or the safety caps above).
function zdGatherFollowingContext(fromNode) {
  const boundary = zdContainerBoundary(fromNode);
  let text = '';
  let node = zdNextTextNode(fromNode, boundary);
  let guardNodes = 0;

  while (node && text.length < ZD_CONTEXT_MAX_CHARS && guardNodes < ZD_CONTEXT_MAX_NODES) {
    guardNodes++;
    const data = node.data;
    let i = 0;
    while (i < data.length && (zdIsWordChar(data[i]) || ZD_INTER_WORD_SPACE_RE.test(data[i]))) {
      ++i;
    }
    if (i === 0) {
      break;
    }
    text += data.substring(0, i);
    if (i < data.length) {
      break;
    }
    node = zdNextTextNode(node, boundary);
  }

  return text;
}

// adapted from https://stackoverflow.com/a/30606508
function getWordAndContext(mouse) {
  const caret = zdCaretFromPoint(mouse);
  if (!caret) {
    return false;
  }

  const textNode = caret.node;
  const offset = caret.offset;
  if (!textNode || textNode.nodeType !== 3) {
    return false;
  }

  const data = textNode.data;
  if (data === undefined || offset >= data.length || data[offset] === ' ') {
    return false;
  }

  // Walk back to the start of the word.
  let i = offset;
  while (i > -1 && zdIsWordChar(data[i])) {
    --i;
  }
  const begin = i + 1;

  // Walk forward to the end of the word.
  i = offset;
  while (i < data.length && zdIsWordChar(data[i])) {
    ++i;
  }
  const end = i;

  // Walk forward to the end of the clause: letters and spaces, nothing else.
  i = offset;
  while (i < data.length && (zdIsWordChar(data[i]) || data[i] === ' ')) {
    ++i;
  }
  const contextEnd = i;

  // The run above stopped because it ran off the end of this node's own data, not because it
  // hit real punctuation -- keep going into whatever text (skipping <rt> readings) follows in
  // the page, so a compound entry split across sibling <ruby> tags is still visible as one
  // context string.
  let context = data.substring(begin, contextEnd);
  if (contextEnd === data.length) {
    context += zdGatherFollowingContext(textNode);
  }

  // Dictionary keys are precomposed, so decomposed page text has to be folded before any
  // consumer looks it up. `begin` stays an offset into the untouched node data, which is what
  // the highlighter measures against.
  return {
    word: data.substring(begin, end).trim().normalize('NFC'),
    context: context.trim().normalize('NFC'),
    node: textNode,
    begin: begin,
    // True when this node was found by testing which text the point falls
    // inside, rather than taken from the caret API. A caller that would
    // otherwise cross-check the result against elementFromPoint can skip
    // that: containment is what produced this node in the first place, and
    // the element at the point may well be an overlay the text is not in.
    atPoint: caret.atPoint === true
  };
}

function generateCandidates(context, howManyWords) {
  const split = String(context || '').split(/\s+/);
  const candidates = [];
  for (let i = 0; i < howManyWords && candidates.length < split.length; i++) {
    candidates.push(split.slice(0, i + 1).join(' ').replace(/[ĐÐ]/ug, 'đ'));
  }
  return candidates;
}

function mouseInRects(mouse, rects) {
  for (const rect of rects) {
    if (rect.left <= mouse.x && mouse.x <= rect.right &&
        rect.top <= mouse.y && mouse.y <= rect.bottom) {
      return true;
    }
  }
  return false;
}

// Present only under Node, so the primitives are unit-testable without a browser. A userscript
// or a classic <script> has no `module`, and `typeof` on an undeclared name is safe.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ZD_WORD_CHAR_RE,
    zdIsWordChar,
    zdCaretFromPoint,
    zdNextTextNode,
    zdContainerBoundary,
    zdGatherFollowingContext,
    getWordAndContext,
    generateCandidates,
    mouseInRects
  };
}
