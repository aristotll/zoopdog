'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const words = require('../zd-extension/js/zd-words');
const {textNode, elementNode, linkChildren, rubyWord, rubyPageStyle} = require('./support/ruby-dom');

// highlighter.js expects zdIsWordChar / zdContainerBoundary / zdNextTextNode and `Range` as
// ambient globals -- exactly what a browser content script sees once the manifest has loaded
// zd-words.js first (see zd-extension/manifest.json). Wiring the real functions in here, rather
// than re-implementing fakes for them, is what keeps this test honest about what the shipped
// class actually calls.
global.zdIsWordChar = words.zdIsWordChar;
global.zdContainerBoundary = words.zdContainerBoundary;
global.zdNextTextNode = words.zdNextTextNode;
global.window = {innerWidth: 800, innerHeight: 600};

// A fake Range that records the (node, offset) pair `Highlighter.on` asked for and reports back
// whatever client rect the test registered for that node -- enough of the real Range contract
// to drive the highlighting walk without a real DOM.
let rectsByNode;
class FakeRange {
  setStart(node, offset) {
    this.node = node;
    this.startOffset = offset;
  }
  setEnd(node, offset) {
    this.endOffset = offset;
  }
  getClientRects() {
    return rectsByNode.get(this.node) || [];
  }
}
global.Range = FakeRange;

function fakeCanvasContext() {
  return {
    rects: [],
    rect(...args) {
      this.rects.push(args);
    },
    beginPath() {},
    setTransform() {},
    clearRect() {},
    fill() {}
  };
}

function fakeDocument() {
  const context = fakeCanvasContext();
  const canvas = {style: {}, getContext: () => context};
  return {
    createElement: () => canvas,
    body: {appendChild() {}}
  };
}

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

function newHighlighter() {
  global.document = fakeDocument();
  const {Highlighter} = require('../zd-extension/js/highlighter');
  return new Highlighter();
}

// Regression coverage for the same book-translator-reader bug test/zd-words.test.js covers at
// the context-lookup layer: "một câu" and "câu nói" are both dictionary entries, but the reader
// wraps every word in its own <ruby>, so a two-word match ("câu nói") can start in one <ruby>
// and end in the next one. Before Highlighter.on could walk across text nodes, `i` never moved
// past the end of the *first* node's data, so a match longer than one <ruby> either drew no
// highlight past that node or (depending on `howManyWords`) drew nothing recognizable at all.
test('a match spanning two <ruby> tags gets a rect from each node', () => {
  const cau = rubyWord('câu', '句');
  const noi = rubyWord('nói', '吶');
  linkChildren(elementNode('P'), [cau.ruby, textNode(' '), noi.ruby]);

  rectsByNode = new Map([
    [cau.wordText, [{left: 0, top: 0, width: 30, height: 20}]],
    [noi.wordText, [{left: 34, top: 0, width: 28, height: 20}]]
  ]);

  const highlighter = withComputedStyle(rubyPageStyle, () => newHighlighter());
  withComputedStyle(rubyPageStyle, () => {
    highlighter.on(cau.wordText, 0, 2);
  });

  assert.deepEqual(highlighter.highlights, [
    {left: 0, top: 0, width: 30, height: 20},
    {left: 34, top: 0, width: 28, height: 20}
  ], 'one rect comes from the <ruby> the match started in, the other from the next <ruby>');
});

test('a single-word match still highlights only its own node, unchanged from before', () => {
  const cau = rubyWord('câu');
  linkChildren(elementNode('P'), [cau.ruby]);

  rectsByNode = new Map([[cau.wordText, [{left: 5, top: 5, width: 20, height: 10}]]]);

  const highlighter = withComputedStyle(rubyPageStyle, () => newHighlighter());
  withComputedStyle(rubyPageStyle, () => {
    highlighter.on(cau.wordText, 0, 1);
  });

  assert.deepEqual(highlighter.highlights, [{left: 5, top: 5, width: 20, height: 10}]);
});

test('a match that stops mid-node never crosses into the next <ruby>', () => {
  // "câu." -- the word ends in real punctuation inside the same node, so even though a sibling
  // <ruby> follows, howManyWords 2 has nothing left to find there.
  const cau = rubyWord('câu.');
  const noi = rubyWord('nói');
  linkChildren(elementNode('P'), [cau.ruby, textNode(' '), noi.ruby]);

  rectsByNode = new Map([[cau.wordText, [{left: 0, top: 0, width: 30, height: 20}]]]);

  const highlighter = withComputedStyle(rubyPageStyle, () => newHighlighter());
  withComputedStyle(rubyPageStyle, () => {
    highlighter.on(cau.wordText, 0, 2);
  });

  assert.deepEqual(highlighter.highlights, [{left: 0, top: 0, width: 30, height: 20}]);
});

// Video-caption overlays (Eudict) put an empty text node after each word and separate words with
// &nbsp;, not an ASCII space. Either one used to end the walk right after the first word, so the
// popup found "chế độ" while the highlight covered only "chế".
test('a match still spans two words split by an empty text node and a no-break space', () => {
  const che = rubyWord('chế', '制');
  const doWord = rubyWord('độ', '度');
  linkChildren(elementNode('DIV'), [
    che.ruby, textNode(''), textNode(' '), doWord.ruby
  ]);

  rectsByNode = new Map([
    [che.wordText, [{left: 0, top: 0, width: 30, height: 20}]],
    [doWord.wordText, [{left: 40, top: 0, width: 28, height: 20}]]
  ]);

  const highlighter = withComputedStyle(rubyPageStyle, () => newHighlighter());
  withComputedStyle(rubyPageStyle, () => {
    highlighter.on(che.wordText, 0, 2);
  });

  assert.deepEqual(highlighter.highlights, [
    {left: 0, top: 0, width: 30, height: 20},
    {left: 40, top: 0, width: 28, height: 20}
  ]);
});
