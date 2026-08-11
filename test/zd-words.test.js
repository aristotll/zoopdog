const test = require('node:test');
const assert = require('node:assert/strict');

const words = require('../zd-extension/js/zd-words');

// The three literals that existed before consolidation, one per consumer. They are kept here
// verbatim so the test proves the shared class matches what shipped, not what the shared file
// happens to say today.
const HISTORICAL_CLASSES = {
  extension: '-ÐA-Za-zÀÁÂÃÈÉÊÌÍÒÓÔÕÙÚĂĐĨŨƠàáâãèéêìíòóôõùúăđĩũơƯĂẠẢẤẦẨẪẬẮẰẲẴẶẸẺẼỀẾỂưăạảấầẩẫậắằẳẵặẹẻẽếềểỄỆỈỊỌỎỐỒỔỖỘỚỜỞỠỢỤỦỨỪễệỉịọỏốồổỗộớờởỡợụúủứừỬỮỰỲỴÝỶỸửữựỳýỵỷỹ',
  website: '-ÐA-Za-zÀÁÂÃÈÉÊÌÍÒÓÔÕÙÚĂĐĨŨƠàáâãèéêìíòóôõùúăđĩũơƯĂẠẢẤẦẨẪẬẮẰẲẴẶẸẺẼỀẾỂưăạảấầẩẫậắằẳẵặẹẻẽếềểỄỆỈỊỌỎỐỒỔỖỘỚỜỞỠỢỤỦỨỪễệỉịọỏốồổỗộớờởỡợụúủứừỬỮỰỲỴÝỶỸửữựỳýỵỷỹ',
  userscript: '-ÐA-Za-zÀÁÂÃÈÉÊÌÍÒÓÔÕÙÚĂĐĨŨƠƯàáâãèéêìíòóôõùúăđĩũơưẠẢẤẦẨẪẬẮẰẲẴẶẸẺẼỀẾỂỄỆỈỊỌỎỐỒỔỖỘỚỜỞỠỢỤỦỨỪỬỮỰỲỴÝỶỸạảấầẩẫậắằẳẵặẹẻẽềếểễệỉịọỏốồổỗộớờởỡợụúủứừửữựỳýỵỷỹ'
};

function expandClass(body) {
  const points = new Set(['-']);
  const text = body.replace(/^-/, '');
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

function textNode(data) {
  return {nodeType: 3, data};
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

test('the shared character class matches every pre-consolidation definition exactly', () => {
  const shared = expandClass(words.ZD_WORD_CHAR_RE.source.replace(/^\[|\]$/g, ''));

  for (const [consumer, body] of Object.entries(HISTORICAL_CLASSES)) {
    const historical = expandClass(body);
    const added = [...shared].filter((ch) => !historical.has(ch));
    const removed = [...historical].filter((ch) => !shared.has(ch));

    assert.deepEqual(added, [], `no code point was added relative to the ${consumer} class`);
    assert.deepEqual(removed, [], `no code point was removed relative to the ${consumer} class`);
  }

  assert.equal(shared.size, 188, 'the class still covers the same 188 code points');
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

test('a non-text caret target reports no word', () => {
  const result = withDocument({
    caretRangeFromPoint: () => ({startContainer: {nodeType: 1}, startOffset: 0})
  }, () => words.getWordAndContext({x: 1, y: 1}));

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
