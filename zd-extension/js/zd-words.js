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
  return null;
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

  // Dictionary keys are precomposed, so decomposed page text has to be folded before any
  // consumer looks it up. `begin` stays an offset into the untouched node data, which is what
  // the highlighter measures against.
  return {
    word: data.substring(begin, end).trim().normalize('NFC'),
    context: data.substring(begin, contextEnd).trim().normalize('NFC'),
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
    getWordAndContext,
    generateCandidates,
    mouseInRects
  };
}
