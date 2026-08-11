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
const ZD_WORD_CHAR_RE = /[-ÐA-Za-zÀÁÂÃÈÉÊÌÍÒÓÔÕÙÚĂĐĨŨƠƯàáâãèéêìíòóôõùúăđĩũơưẠẢẤẦẨẪẬẮẰẲẴẶẸẺẼỀẾỂỄỆỈỊỌỎỐỒỔỖỘỚỜỞỠỢỤỦỨỪỬỮỰỲỴÝỶỸạảấầẩẫậắằẳẵặẹẻẽềếểễệỉịọỏốồổỗộớờởỡợụúủứừửữựỳýỵỷỹ]/u;

function zdIsWordChar(ch) {
  return !!ch && ZD_WORD_CHAR_RE.test(ch);
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
        return {node: position.offsetNode, offset: position.offset};
      }
    } else if (document.caretRangeFromPoint) {        // Chrome
      const range = document.caretRangeFromPoint(x, y);
      if (range) {
        return {node: range.startContainer, offset: range.startOffset};
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

  return {
    word: data.substring(begin, end).trim(),
    context: data.substring(begin, contextEnd).trim(),
    node: textNode,
    begin: begin
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
