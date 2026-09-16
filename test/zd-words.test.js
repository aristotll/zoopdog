const test = require('node:test');
const assert = require('node:assert/strict');

const words = require('../zd-extension/js/zd-words');
const {textNode, elementNode, linkChildren, rubyWord, rubyPageStyle} = require('./support/ruby-dom');

// The three literals that existed before consolidation, one per consumer. They are kept here
// verbatim so the test proves the shared class matches what shipped, not what the shared file
// happens to say today.
const HISTORICAL_CLASSES = {
  extension: '-ÐA-Za-zÀÁÂÃÈÉÊÌÍÒÓÔÕÙÚĂĐĨŨƠàáâãèéêìíòóôõùúăđĩũơƯĂẠẢẤẦẨẪẬẮẰẲẴẶẸẺẼỀẾỂưăạảấầẩẫậắằẳẵặẹẻẽếềểỄỆỈỊỌỎỐỒỔỖỘỚỜỞỠỢỤỦỨỪễệỉịọỏốồổỗộớờởỡợụúủứừỬỮỰỲỴÝỶỸửữựỳýỵỷỹ',
  website: '-ÐA-Za-zÀÁÂÃÈÉÊÌÍÒÓÔÕÙÚĂĐĨŨƠàáâãèéêìíòóôõùúăđĩũơƯĂẠẢẤẦẨẪẬẮẰẲẴẶẸẺẼỀẾỂưăạảấầẩẫậắằẳẵặẹẻẽếềểỄỆỈỊỌỎỐỒỔỖỘỚỜỞỠỢỤỦỨỪễệỉịọỏốồổỗộớờởỡợụúủứừỬỮỰỲỴÝỶỸửữựỳýỵỷỹ',
  userscript: '-ÐA-Za-zÀÁÂÃÈÉÊÌÍÒÓÔÕÙÚĂĐĨŨƠƯàáâãèéêìíòóôõùúăđĩũơưẠẢẤẦẨẪẬẮẰẲẴẶẸẺẼỀẾỂỄỆỈỊỌỎỐỒỔỖỘỚỜỞỠỢỤỦỨỪỬỮỰỲỴÝỶỸạảấầẩẫậắằẳẵặẹẻẽềếểễệỉịọỏốồổỗộớờởỡợụúủứừửữựỳýỵỷỹ'
};

// Added deliberately after decomposed page text was found to end the word walk mid-syllable.
// Any other difference from the historical classes is a bug, so the guard below names this one
// range rather than relaxing into "additions are fine".
const COMBINING_MARKS = Array.from(
  {length: 0x36f - 0x300 + 1},
  (unused, index) => String.fromCodePoint(0x300 + index)
);

function expandClass(body) {
  const points = new Set(['-']);
  // The shared class spells its combining range as \uXXXX escapes, which reach .source verbatim.
  const text = body
    .replace(/\\u([0-9a-fA-F]{4})/g, (unused, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/^-/, '');
  for (let i = 0; i < text.length; i++) {
    if (text[i + 1] === '-' && text[i + 2]) {
      for (let code = text.codePointAt(i); code <= text.codePointAt(i + 2); code++) {
        points.add(String.fromCodePoint(code));
      }
      i += 2;
      continue;
    }
    points.add(text[i]);
  }
  return points;
}

function withDocument(stub, run) {
  const previous = global.document;
  global.document = stub;
  try {
    return run();
  } finally {
    if (previous === undefined) {
      delete global.document;
    } else {
      global.document = previous;
    }
  }
}

// Stubs the bare global `getComputedStyle` the way a browser provides it (not
// `document.getComputedStyle`), so zdContainerBoundary can be driven without a real DOM.
// `styleFor(element)` returns just the `display` value the element should report.
function withComputedStyle(styleFor, run) {
  const previous = global.getComputedStyle;
  global.getComputedStyle = (el) => ({display: styleFor(el)});
  try {
    return run();
  } finally {
    if (previous === undefined) {
      delete global.getComputedStyle;
    } else {
      global.getComputedStyle = previous;
    }
  }
}

test('the shared character class matches every pre-consolidation definition exactly', () => {
  const shared = expandClass(words.ZD_WORD_CHAR_RE.source.replace(/^\[|\]$/g, ''));

  for (const [consumer, body] of Object.entries(HISTORICAL_CLASSES)) {
    const historical = expandClass(body);
    const added = [...shared].filter((ch) => !historical.has(ch));
    const removed = [...historical].filter((ch) => !shared.has(ch));

    assert.deepEqual(added.sort(), [...COMBINING_MARKS].sort(),
      `only the combining-mark range was added relative to the ${consumer} class`);
    assert.deepEqual(removed, [], `no code point was removed relative to the ${consumer} class`);
  }

  assert.equal(shared.size, 188 + COMBINING_MARKS.length,
    'the class covers the original 188 code points plus the combining range');
});

test('the character predicate is stateless across repeated calls', () => {
  // A /g regex carries lastIndex between .test() calls, so the same character alternates
  // true/false. That is why the shared class must not be global.
  assert.equal(words.ZD_WORD_CHAR_RE.global, false);
  for (let i = 0; i < 5; i++) {
    assert.equal(words.zdIsWordChar('ơ'), true, `call ${i} still matches`);
  }
  assert.equal(words.zdIsWordChar(' '), false);
  assert.equal(words.zdIsWordChar(''), false);
  assert.equal(words.zdIsWordChar(undefined), false);
});

test('a caret lookup that yields nothing reports no word instead of raising', () => {
  const result = withDocument({
    caretRangeFromPoint: () => null
  }, () => words.getWordAndContext({x: 10, y: 10}));

  assert.equal(result, false);
});

test('the Firefox caret path tolerates a null position', () => {
  const result = withDocument({
    caretPositionFromPoint: () => null
  }, () => words.getWordAndContext({x: 10, y: 10}));

  assert.equal(result, false);
});

test('a document with neither caret API reports no word', () => {
  const result = withDocument({}, () => words.getWordAndContext({x: 10, y: 10}));

  assert.equal(result, false);
});

test('page coordinates resolve the word when client coordinates yield no range', () => {
  const node = textNode('xin chào bạn');
  const asked = [];
  const result = withDocument({
    caretRangeFromPoint: (x, y) => {
      asked.push([x, y]);
      if (x === 10 && y === 20) {
        return null;
      }
      return {startContainer: node, startOffset: 4};
    }
  }, () => words.getWordAndContext({x: 10, y: 20, pageX: 10, pageY: 320}));

  assert.deepEqual(asked, [[10, 20], [10, 320]], 'the client pair is tried first, then the page pair');
  assert.equal(result.word, 'chào');
  assert.equal(result.context, 'chào bạn');
  assert.equal(result.node, node);
  assert.equal(result.begin, 4);
});

test('client coordinates alone still resolve a word for callers with no page coordinates', () => {
  const node = textNode('quản lý dự án');
  const result = withDocument({
    caretRangeFromPoint: () => ({startContainer: node, startOffset: 0})
  }, () => words.getWordAndContext({x: 5, y: 5}));

  assert.equal(result.word, 'quản');
  assert.equal(result.context, 'quản lý dự án');
});

test('a combining mark counts as part of a word', () => {
  assert.equal(words.zdIsWordChar('\u0300'), true, 'combining grave');
  assert.equal(words.zdIsWordChar('\u0323'), true, 'combining dot below');
  assert.equal(words.zdIsWordChar('\u031b'), true, 'combining horn');
});

test('decomposed page text resolves to the whole precomposed word', () => {
  // Built through NFD rather than written out, because an editor or a tool that touches this
  // file would silently recompose pasted literals and the test would stop testing anything.
  // Some pages and browser extensions hand the DOM exactly this form. Before the combining
  // range joined the character class the forward walk stopped at the mark after "cha".
  const decomposed = 'xin ch\u00e0o b\u1ea1n'.normalize('NFD');
  const node = textNode(decomposed);
  const result = withDocument({
    caretRangeFromPoint: () => ({startContainer: node, startOffset: 4})
  }, () => words.getWordAndContext({x: 1, y: 1}));

  assert.notEqual(decomposed, 'xin ch\u00e0o b\u1ea1n', 'the fixture really is decomposed');
  assert.equal(result.word, 'ch\u00e0o', 'the word comes back precomposed, as the dictionary keys it');
  assert.equal(result.context, 'ch\u00e0o b\u1ea1n');
  assert.equal(result.begin, 4, 'begin stays an offset into the untouched node data');
  assert.equal(node.data, decomposed, 'the node itself is left alone');
});

test('candidate generation folds decomposed context into precomposed candidates', () => {
  const node = textNode('\u0111\u01b0\u1eddng ph\u1ed1 H\u00e0 N\u1ed9i'.normalize('NFD'));
  const result = withDocument({
    caretRangeFromPoint: () => ({startContainer: node, startOffset: 0})
  }, () => words.getWordAndContext({x: 1, y: 1}));

  assert.deepEqual(words.generateCandidates(result.context, 3), [
    '\u0111\u01b0\u1eddng',
    '\u0111\u01b0\u1eddng ph\u1ed1',
    '\u0111\u01b0\u1eddng ph\u1ed1 H\u00e0'
  ]);
});

test('a non-text caret target reports no word', () => {
  const result = withDocument({
    caretRangeFromPoint: () => ({startContainer: {nodeType: 1}, startOffset: 0})
  }, () => words.getWordAndContext({x: 1, y: 1}));

  assert.equal(result, false);
});

// A fake `document.createRange` whose ranges report the rect(s) `rectsByNode` was given for
// whatever node `selectNodeContents` was called with -- enough of the real Range contract for
// zdClosestTextNode to measure distance against, without a real DOM.
function withRects(rectsByNode, doc) {
  return Object.assign({}, doc, {
    createRange: () => {
      let target = null;
      return {
        selectNodeContents(node) { target = node; },
        getClientRects: () => rectsByNode.get(target) || []
      };
    }
  });
}

// Reproduces a real Google search-results page: a compact <h3> sitelink packs its Chữ Nôm word
// straight inside a <ruby>, followed by a plain " 2" text node and a trailing empty <span> (an
// arrow icon rendered from CSS, no text of its own) -- and Chromium's caretRangeFromPoint there
// hands back the <h3> itself (nodeType 1) with startOffset sitting past *every* child, not a
// text node. Naively walking backward from that boundary by DOM adjacency lands on " 2" (the
// nearest sibling with any text) instead of "Trang" (what the pointer is actually over) --
// exactly why the recovery has to rank every candidate by real pixel distance, not tree order.
test('a non-text caret target recovers the word closest to the pointer, not just the nearest sibling', () => {
  const word = textNode('Trang');
  const ruby = {nodeType: 1, childNodes: [word]};
  const spacer = textNode(' 2');
  const icon = {nodeType: 1, childNodes: []};
  const h3 = {nodeType: 1, childNodes: [ruby, spacer, icon]};

  const rectsByNode = new Map([
    [word, [{left: 171, right: 217, top: 305, bottom: 326}]],
    [spacer, [{left: 217, right: 230, top: 305, bottom: 326}]]
  ]);

  const result = withDocument(
    withRects(rectsByNode, {caretRangeFromPoint: () => ({startContainer: h3, startOffset: 3})}),
    () => words.getWordAndContext({x: 194, y: 315})
  );

  assert.equal(result.word, 'Trang');
  assert.equal(result.node, word);
});

// The search-result card case: a link-shaped click target is laid over the whole row, so the
// caret API names that overlay -- but the line being hovered lives in a sibling subtree under
// the card, not in the overlay at all. Searching only the named element finds the card's title
// or nothing, which is why those description lines never showed a popup; the search has to
// widen outwards until it reaches an ancestor holding the text under the pointer.
test('a caret naming an overlay finds the text under the pointer outside it', () => {
  const title = textNode('Trang');
  const overlay = {nodeType: 1, childNodes: [title]};
  const word = textNode('người');
  const line = {nodeType: 1, childNodes: [word]};
  const card = {nodeType: 1, childNodes: [overlay, line]};
  overlay.parentElement = card;

  const rectsByNode = new Map([
    [title, [{left: 171, right: 217, top: 300, bottom: 320}]],
    [word, [{left: 202, right: 239, top: 390, bottom: 406}]]
  ]);

  const result = withDocument(
    withRects(rectsByNode, {caretRangeFromPoint: () => ({startContainer: overlay, startOffset: 0})}),
    () => words.getWordAndContext({x: 221, y: 398})
  );

  assert.equal(result.word, 'người');
  assert.equal(result.node, word);
  assert.equal(result.atPoint, true, 'found by containment, so callers can skip the elementFromPoint check');
});

// A video-caption translation widget (Eudict, Immersive Translate, Dualsub) injects its own
// empty overlay element as a *sibling subtree* of the player's caption container -- not a
// nearby wrapper the way a search card's click-target overlay is. Climbing the overlay's own
// ancestors, capped at ZD_TEXT_SEARCH_MAX_LEVELS, never reaches the shared ancestor (5 levels
// up here) that also holds the caption text, so the ancestor climb alone reports nothing;
// only falling back to a whole-document search (a shared ancestor of everything) finds it.
test('an overlay too far from the real text to reach by climbing is still found via the page', () => {
  const word = textNode('người');
  const captionBranch = {nodeType: 1, childNodes: [word]};
  // Four ancestors between the overlay and the player -- exactly ZD_TEXT_SEARCH_MAX_LEVELS --
  // so the climb (overlay, p1, p2, p3, p4: five tested nodes) never reaches `player` or `body`.
  const overlay = {nodeType: 1, childNodes: []};
  const p1 = {nodeType: 1, childNodes: [overlay]};
  const p2 = {nodeType: 1, childNodes: [p1]};
  const p3 = {nodeType: 1, childNodes: [p2]};
  const p4 = {nodeType: 1, childNodes: [p3]};
  const player = {nodeType: 1, childNodes: [p4]};
  const body = {nodeType: 1, childNodes: [player, captionBranch]};

  overlay.parentElement = p1;
  p1.parentElement = p2;
  p2.parentElement = p3;
  p3.parentElement = p4;
  p4.parentElement = player;
  player.parentElement = body;

  const rectsByNode = new Map([[word, [{left: 202, right: 239, top: 390, bottom: 406}]]]);

  const result = withDocument(
    withRects(rectsByNode, {
      body,
      caretRangeFromPoint: () => ({startContainer: overlay, startOffset: 0})
    }),
    () => words.getWordAndContext({x: 221, y: 398})
  );

  assert.equal(result.word, 'người');
  assert.equal(result.node, word);
});

// The flicker guard: answering with the nearest word for a point that is on no word at all made
// the popup appear for something the pointer was not over, then vanish on the next move.
test('a point inside no word at all reports no word, however close one is', () => {
  const word = textNode('Trang');
  const ruby = {nodeType: 1, childNodes: [word]};
  const card = {nodeType: 1, childNodes: [ruby]};

  const rectsByNode = new Map([[word, [{left: 171, right: 217, top: 300, bottom: 320}]]]);

  const result = withDocument(
    withRects(rectsByNode, {caretRangeFromPoint: () => ({startContainer: card, startOffset: 0})}),
    () => words.getWordAndContext({x: 219, y: 310})   // two px past the word's right edge
  );

  assert.equal(result, false);
});

test('a container with no text anywhere in it still reports no word', () => {
  const emptyWrapper = {nodeType: 1, childNodes: []};
  const container = {nodeType: 1, childNodes: [emptyWrapper]};
  const result = withDocument(
    withRects(new Map(), {caretRangeFromPoint: () => ({startContainer: container, startOffset: 0})}),
    () => words.getWordAndContext({x: 1, y: 1})
  );

  assert.equal(result, false);
});

test('a document with no createRange support cannot recover from a non-text caret target', () => {
  // The plain "a non-text caret target reports no word" test above already covers this --
  // named separately here because it is the thing that makes the *recovery* itself opt-in
  // rather than a hard requirement: an older engine or a test document missing createRange
  // degrades to the pre-recovery behaviour instead of throwing.
  const word = textNode('Trang');
  const ruby = {nodeType: 1, childNodes: [word]};
  const h3 = {nodeType: 1, childNodes: [ruby]};
  const result = withDocument({
    caretRangeFromPoint: () => ({startContainer: h3, startOffset: 1})
  }, () => words.getWordAndContext({x: 194, y: 315}));

  assert.equal(result, false);
});

test('a caret on whitespace or past the end reports no word', () => {
  const node = textNode('xin chào');
  const at = (offset) => withDocument({
    caretRangeFromPoint: () => ({startContainer: node, startOffset: offset})
  }, () => words.getWordAndContext({x: 1, y: 1}));

  assert.equal(at(3), false, 'the space between words yields nothing');
  assert.equal(at(node.data.length), false, 'an offset past the last character yields nothing');
});

test('candidate generation caps at the requested word count and folds Đ', () => {
  assert.deepEqual(words.generateCandidates('Đường phố Hà Nội', 3), [
    'đường',
    'đường phố',
    'đường phố Hà'
  ]);
  assert.deepEqual(words.generateCandidates('Ði chợ', 5), ['đi', 'đi chợ'],
    'the request never yields more candidates than the context has words');
  assert.deepEqual(words.generateCandidates('', 3), ['']);
});

test('rectangle hit testing covers edges and misses', () => {
  const rects = [{left: 0, right: 10, top: 0, bottom: 10}];

  assert.equal(words.mouseInRects({x: 5, y: 5}, rects), true);
  assert.equal(words.mouseInRects({x: 0, y: 0}, rects), true, 'the top-left edge counts as inside');
  assert.equal(words.mouseInRects({x: 10, y: 10}, rects), true, 'the bottom-right edge counts as inside');
  assert.equal(words.mouseInRects({x: 11, y: 5}, rects), false);
  assert.equal(words.mouseInRects({x: 5, y: 5}, []), false);
});

// Regression coverage for the bug reported against the book-translator reader: "một câu" and
// "câu nói" are both dictionary entries, but the reader wraps every word in its own <ruby>, so
// "một câu" and "câu nói" live in three separate text nodes ("một", "câu", "nói") rather than
// one flowing sentence. Before zdGatherFollowingContext existed, the context walk stopped dead
// at the end of whichever <ruby> was clicked, so hovering "câu" could never see "nói" and the
// popup could only ever resolve to a single word.
test('a <ruby> ancestor counts as inline despite its unusual computed display', () => {
  const word = textNode('câu');
  const ruby = linkChildren(elementNode('RUBY'), [word]);
  const paragraph = linkChildren(elementNode('P'), [ruby]);

  const boundary = withComputedStyle(rubyPageStyle, () => words.zdContainerBoundary(word));

  assert.equal(boundary, paragraph,
    'a check for literal "inline"/"inline-block" would stop at the <ruby> itself, since a ' +
    'browser reports its computed display as "ruby", not "inline"');
});

test('context follows a compound dictionary entry split across sibling <ruby> word tags', () => {
  const mot = rubyWord('một');
  const cau = rubyWord('câu', '句');
  const noi = rubyWord('nói', '吶');
  linkChildren(elementNode('P'), [mot.ruby, textNode(' '), cau.ruby, textNode(' '), noi.ruby]);

  const result = withComputedStyle(rubyPageStyle, () => withDocument(
    {caretRangeFromPoint: () => ({startContainer: mot.wordText, startOffset: 0})},
    () => words.getWordAndContext({x: 1, y: 1})
  ));

  assert.equal(result.word, 'một');
  assert.equal(result.context, 'một câu nói',
    'the reading glosses in <rt> ("句", "吶") are not part of the context');
});

test('clicking a later <ruby> in the same chain resolves the compound starting there', () => {
  const mot = rubyWord('một');
  const cau = rubyWord('câu', '句');
  const noi = rubyWord('nói', '吶');
  linkChildren(elementNode('P'), [mot.ruby, textNode(' '), cau.ruby, textNode(' '), noi.ruby]);

  const result = withComputedStyle(rubyPageStyle, () => withDocument(
    {caretRangeFromPoint: () => ({startContainer: cau.wordText, startOffset: 0})},
    () => words.getWordAndContext({x: 1, y: 1})
  ));

  assert.equal(result.word, 'câu');
  assert.equal(result.context, 'câu nói',
    'context only looks forward from the click, so "một" is not pulled back in');
});

test('a real punctuation character still stops the cross-node walk', () => {
  const mot = rubyWord('một');
  const cau = rubyWord('câu');
  linkChildren(elementNode('P'), [mot.ruby, textNode(' '), cau.ruby, textNode('.')]);

  const result = withComputedStyle(rubyPageStyle, () => withDocument(
    {caretRangeFromPoint: () => ({startContainer: mot.wordText, startOffset: 0})},
    () => words.getWordAndContext({x: 1, y: 1})
  ));

  assert.equal(result.context, 'một câu', 'the "." after "câu" ends the clause, same as in one node');
});

test('page-formatting whitespace between word tags does not stop the walk', () => {
  // Server-rendered markup often leaves a newline (or a run of spaces) between tags for
  // readability rather than the single literal " " a hand-written sentence would have.
  const mot = rubyWord('một');
  const cau = rubyWord('câu');
  linkChildren(elementNode('P'), [mot.ruby, textNode('\n  '), cau.ruby]);

  const result = withComputedStyle(rubyPageStyle, () => withDocument(
    {caretRangeFromPoint: () => ({startContainer: mot.wordText, startOffset: 0})},
    () => words.getWordAndContext({x: 1, y: 1})
  ));

  // The raw whitespace passes through unnormalized here -- normalizeLookup and
  // generateCandidates both collapse runs of whitespace downstream -- so the walk not stopping
  // is what this asserts, not the exact separator.
  assert.deepEqual(result.context.trim().split(/\s+/), ['một', 'câu'],
    'the newline-and-indent gap between tags does not end the clause the way real punctuation would');
});

test('the cross-node walk does not cross into a different paragraph', () => {
  const mot = rubyWord('một');
  const cau = rubyWord('câu');
  const paragraph = linkChildren(elementNode('P'), [mot.ruby, textNode(' '), cau.ruby]);

  const nextParagraph = linkChildren(elementNode('P'), [rubyWord('Sau').ruby]);
  linkChildren(elementNode('DIV'), [paragraph, nextParagraph]);

  const result = withComputedStyle(rubyPageStyle, () => withDocument(
    {caretRangeFromPoint: () => ({startContainer: mot.wordText, startOffset: 0})},
    () => words.getWordAndContext({x: 1, y: 1})
  ));

  assert.equal(result.context, 'một câu',
    'the walk stops at the end of the paragraph instead of reading into the next one');
});
