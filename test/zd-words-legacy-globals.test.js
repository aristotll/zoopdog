'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {zdCaretFromPoint} = require('../zd-extension/js/zd-words');

// 115.com's own scripts delete the ES2015 statics of `Number` (only `isNaN` survives), and
// the userscript runs in that page's realm. A `Number.isFinite` call in the mousemove path then
// threw on every event, so the popup never showed. The path must not depend on those statics.
test('zdCaretFromPoint works on a page whose Number has lost its ES2015 statics', () => {
  const saved = {
    isFinite: Number.isFinite,
    isInteger: Number.isInteger,
    isSafeInteger: Number.isSafeInteger
  };
  const textNode = {nodeType: 3, data: 'xin chào'};
  const hadDocument = 'document' in globalThis;
  const savedDocument = globalThis.document;
  globalThis.document = {
    caretRangeFromPoint: () => ({startContainer: textNode, startOffset: 1})
  };
  delete Number.isFinite;
  delete Number.isInteger;
  delete Number.isSafeInteger;
  try {
    const caret = zdCaretFromPoint({x: 10, y: 10, pageX: 10, pageY: 30});
    assert.deepEqual(caret, {node: textNode, offset: 1});
  } finally {
    Object.assign(Number, saved);
    if (hadDocument) {
      globalThis.document = savedDocument;
    } else {
      delete globalThis.document;
    }
  }
});
