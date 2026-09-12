'use strict';

// Shared DOM fixture builders for tests that exercise word/context/highlight logic against a
// Nom-annotated page's shape: every word wrapped in its own <ruby>, with an optional <rt>
// carrying the Chu Nom reading. That per-word wrapping (used by the book-translator reader and
// Zoopdog's own nom-ruby userscript) is what exposed the "một câu" / "câu nói" bug -- a compound
// dictionary entry whose words sit in sibling <ruby> tags rather than one flowing text node.
// Defined once here so test/zd-words.test.js and test/highlighter.test.js build the same shape
// instead of two DOM fixtures quietly drifting apart.

function textNode(data) {
  return {nodeType: 3, data};
}

function elementNode(tagName, extra) {
  return Object.assign({nodeType: 1, tagName}, extra);
}

// Wires parentNode/parentElement/firstChild/nextSibling the way a real DOM would, so the
// document-order walk in zd-words.js (and the Highlighter that reuses it) can traverse the
// fixture just like it would a real page.
function linkChildren(parent, children) {
  parent.firstChild = children[0] || null;
  children.forEach((child, index) => {
    child.parentNode = parent;
    child.parentElement = parent;
    child.nextSibling = children[index + 1] || null;
  });
  return parent;
}

// <ruby>word<rt>reading</rt></ruby> -- the reading is optional, since a word with no known Chu
// Nom renders as a bare <ruby> with no <rt> at all.
function rubyWord(word, reading) {
  const wordText = textNode(word);
  const children = [wordText];
  if (reading) {
    children.push(linkChildren(elementNode('RT'), [textNode(reading)]));
  }
  return {ruby: linkChildren(elementNode('RUBY'), children), wordText};
}

// What a real browser's getComputedStyle reports for this fixture shape: 'ruby' for the word
// wrapper and its reading (an inline-level box, but not literally "inline"), 'block' for the
// paragraph holding them.
function rubyPageStyle(el) {
  return el.tagName === 'RUBY' || el.tagName === 'RT' ? 'ruby' : 'block';
}

module.exports = {textNode, elementNode, linkChildren, rubyWord, rubyPageStyle};
