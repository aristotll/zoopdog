'use strict';

// The nom userscript runs as an IIFE against a live DOM, so it is exercised here the way a
// browser runs it: the runtime source is rendered with a tiny dictionary and evaluated in a
// vm against a minimal DOM that reports the same mutation records a browser reports.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const {readRuntime, renderRuntime} = require('../scripts/lib/userscript');

const nomMatchEnginePath = path.join(__dirname, '..', 'zd-extension/js/zd-nom-match.js');
const wordsPath = path.join(__dirname, '..', 'zd-extension/js/zd-words.js');

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const DOCUMENT_FRAGMENT_NODE = 11;

function createDom() {
  const records = [];
  // A real MutationObserver can watch several targets at once (the runtime observes
  // document.body plus a separate call per shadow root it finds -- see watchShadowRoot in
  // nom-ruby.runtime.js), so this is a set, not a single slot.
  const observedRoots = new Set();

  // A browser records a mutation only when its target is inside one of the observed subtrees,
  // so a ruby assembled off-document produces no records until it is inserted.
  function record(entry) {
    for (const root of observedRoots) {
      if (root.contains(entry.target)) {
        records.push(entry);
        return;
      }
    }
  }

  class MiniNode {
    constructor(nodeType) {
      this.nodeType = nodeType;
      this.parentNode = null;
      this.childNodes = [];
    }

    get parentElement() {
      return this.parentNode && this.parentNode.nodeType === ELEMENT_NODE ? this.parentNode : null;
    }

    get firstChild() {
      return this.childNodes[0] || null;
    }

    get nextSibling() {
      if (!this.parentNode) {
        return null;
      }
      const index = this.parentNode.childNodes.indexOf(this);
      return this.parentNode.childNodes[index + 1] || null;
    }

    get previousSibling() {
      if (!this.parentNode) {
        return null;
      }
      const index = this.parentNode.childNodes.indexOf(this);
      return index > 0 ? this.parentNode.childNodes[index - 1] : null;
    }

    // The runtime's own connectedness check walks through an attached shadow root (via
    // `.host`, since a ShadowRoot has no `.parentNode`) the same way a real browser's
    // `Node.isConnected` does, so this mirrors that rather than reimplementing `contains()`.
    get isConnected() {
      for (let current = this; current; current = current.parentNode || current.host) {
        if (current === body) {
          return true;
        }
      }
      return false;
    }

    contains(node) {
      for (let current = node; current; current = current.parentNode) {
        if (current === this) {
          return true;
        }
      }
      return false;
    }

    appendChild(node) {
      return this.insertBefore(node, null);
    }

    insertBefore(node, reference) {
      if (node.parentNode) {
        node.parentNode.removeChild(node);
      }
      const index = reference ? this.childNodes.indexOf(reference) : this.childNodes.length;
      this.childNodes.splice(index, 0, node);
      node.parentNode = this;
      record({type: 'childList', target: this, addedNodes: [node]});
      return node;
    }

    removeChild(node) {
      const index = this.childNodes.indexOf(node);
      if (index === -1) {
        throw new Error('removeChild: not a child');
      }
      this.childNodes.splice(index, 1);
      node.parentNode = null;
      record({type: 'childList', target: this, addedNodes: []});
      return node;
    }
  }

  class MiniText extends MiniNode {
    constructor(data) {
      super(TEXT_NODE);
      this.data = data;
    }

    get nodeValue() {
      return this.data;
    }

    set nodeValue(value) {
      this.data = value;
      record({type: 'characterData', target: this, addedNodes: []});
    }

    // Browsers queue a characterData record for the node being split, then insert the new
    // node as a sibling, so the shim does both.
    splitText(offset) {
      const tail = new MiniText(this.data.substring(offset));
      this.nodeValue = this.data.substring(0, offset);
      this.parentNode.insertBefore(tail, this.parentNode.childNodes[
        this.parentNode.childNodes.indexOf(this) + 1] || null);
      return tail;
    }
  }

  // Real DOM: a ShadowRoot is a DocumentFragment with a `.host` back-reference and no
  // `.parentNode` of its own -- scanTextNodes' isConnected check and zd-words.js's point
  // search both rely on exactly this shape to walk through an attached shadow root.
  class MiniShadowRoot extends MiniNode {
    constructor(host, mode) {
      super(DOCUMENT_FRAGMENT_NODE);
      this.host = host;
      this.mode = mode;
    }
  }

  class MiniElement extends MiniNode {
    constructor(tagName) {
      super(ELEMENT_NODE);
      this.tagName = tagName.toUpperCase();
      this.className = '';
      this.title = '';
      this.isContentEditable = false;
      this.shadowRoot = null;
    }

    get textContent() {
      return this.childNodes.map((child) =>
        child.nodeType === TEXT_NODE ? child.nodeValue : child.textContent).join('');
    }

    set textContent(value) {
      this.childNodes.slice().forEach((child) => this.removeChild(child));
      this.appendChild(new MiniText(value));
    }

    // A closed root is real but unreachable from outside (`.shadowRoot` stays null), matching
    // the one property that actually distinguishes 'open' from 'closed' in a real browser.
    attachShadow(init) {
      const root = new MiniShadowRoot(this, init && init.mode);
      if (root.mode === 'open') {
        this.shadowRoot = root;
      }
      return root;
    }
  }

  const body = new MiniElement('body');
  const head = new MiniElement('head');

  const document = {
    body,
    createElement: (tagName) => new MiniElement(tagName),
    createTextNode: (data) => new MiniText(data),
    getElementsByTagName: (tagName) => (tagName === 'head' ? [head] : [])
  };

  return {
    document,
    body,
    MiniText,
    observe: (root) => {
      observedRoots.add(root);
    },
    appendSilently: (parent, node) => {
      parent.childNodes.push(node);
      node.parentNode = parent;
    },
    takeRecords: () => records.splice(0, records.length)
  };
}

// What a browser reports for the fixtures below: caption rows are flex, their per-word wrappers
// block, ruby its own display, everything else inline.
function displayOf(el) {
  if (el.tagName === 'RUBY' || el.tagName === 'RT') return {display: 'ruby'};
  if (el.tagName === 'BODY' || el.tagName === 'P') return {display: 'block'};
  if (el.className === 'row') return {display: 'flex', flexDirection: 'row'};
  if (el.className === 'item') return {display: 'block'};
  return {display: 'inline'};
}

function runRuntime(nomMap, caseSensitiveNomMap = {}) {
  const dom = createDom();
  const source = renderRuntime(readRuntime('nom-ruby.runtime.js'), {
    '__ZOOPDOG_NOM_MATCH_ENGINE__': fs.readFileSync(nomMatchEnginePath, 'utf8'),
    '__ZOOPDOG_WORDS__': fs.readFileSync(wordsPath, 'utf8'),
    '{"__ZOOPDOG_NOM_MAP__": true}': JSON.stringify(nomMap),
    '{"__ZOOPDOG_CASE_SENSITIVE_NOM_MAP__": true}': JSON.stringify(caseSensitiveNomMap),
    '__ZOOPDOG_ENTRY_COUNT__': Object.keys(nomMap).length,
    '__ZOOPDOG_NAME_SUFFIX__': '',
    '__ZOOPDOG_UPDATE_URL__': 'about:blank',
    '__ZOOPDOG_DOWNLOAD_URL__': 'about:blank',
    '__ZOOPDOG_NOM_FONT_SRC__':
      "url('https://github.com/nomfoundation/font/releases/download/v5.17/NomNaTong-Regular.ttf') format('truetype')",
    '__ZOOPDOG_VERSION__': '0.0.0-test'
  });

  const intervals = [];
  const context = {
    document: dom.document,
    getComputedStyle: displayOf,
    Node: {ELEMENT_NODE, TEXT_NODE, DOCUMENT_FRAGMENT_NODE},
    NodeList: {prototype: {forEach: Array.prototype.forEach}},
    MutationObserver: class {
      constructor() {}
      observe(root) {
        dom.observe(root);
      }
      takeRecords() {
        return dom.takeRecords();
      }
    }
  };
  context.window = {
    setTimeout: (fn) => fn(),
    setInterval: (fn) => intervals.push(fn)
  };

  vm.runInNewContext(source, context);

  return Object.assign(dom, {tick: () => intervals.forEach((fn) => fn())});
}

// Text seen by a reader: the annotated words plus everything around them, with the ruby
// text (`rt`) left out.
function visibleText(node) {
  if (node.nodeType === TEXT_NODE) {
    return node.nodeValue;
  }
  if (node.tagName === 'RT') {
    return '';
  }
  return node.childNodes.map(visibleText).join('');
}

function rubyAnnotations(node) {
  if (node.nodeType !== ELEMENT_NODE) {
    return [];
  }
  if (node.tagName === 'RT') {
    return [node.textContent];
  }
  return node.childNodes.reduce((all, child) => all.concat(rubyAnnotations(child)), []);
}

const NOM_MAP = {'bạn': '伴', 'của': '𧵑', 'tình cảm': '情感'};

test('annotates text present when the script starts', () => {
  const dom = runRuntime(NOM_MAP);
  const paragraph = dom.document.createElement('p');
  paragraph.appendChild(dom.document.createTextNode('của bạn'));
  dom.body.appendChild(paragraph);

  dom.tick();

  assert.equal(visibleText(paragraph), 'của bạn');
  assert.deepEqual(rubyAnnotations(paragraph), ['𧵑', '伴']);
});

// A video-caption or translation-overlay widget (Eudict/欧路翻译, Immersive Translate) renders
// its actual on-screen text inside its own open shadow root. That content is real DOM, but it
// is not part of the host element's childNodes, so a scan or observer that never looks at
// `.shadowRoot` finds nothing there -- the annotation lands on the page's own (often hidden)
// native caption markup instead, and the text the viewer actually sees stays unannotated.
test('a widget that renders through an open shadow root still gets annotated', () => {
  const dom = runRuntime(NOM_MAP);
  const host = dom.document.createElement('app-video-captions');
  dom.body.appendChild(host);

  const shadow = host.attachShadow({mode: 'open'});
  const line = dom.document.createElement('span');
  line.appendChild(dom.document.createTextNode('của bạn'));
  shadow.appendChild(line);

  dom.tick();

  assert.equal(visibleText(line), 'của bạn');
  assert.deepEqual(rubyAnnotations(line), ['𧵑', '伴']);
});

// A closed shadow root's content is real but genuinely unreachable from outside -- `.shadowRoot`
// stays null on the host, same as in a real browser -- so this documents the one case that
// really cannot be annotated, rather than leaving it looking like an oversight.
test('a closed shadow root is left alone rather than throwing', () => {
  const dom = runRuntime(NOM_MAP);
  const host = dom.document.createElement('app-video-captions');
  dom.body.appendChild(host);
  host.attachShadow({mode: 'closed'});

  assert.doesNotThrow(() => dom.tick());
});

test('injects the Nom Na Tong webfont for Chu Nom ruby text', () => {
  const dom = runRuntime(NOM_MAP);
  const styles = dom.document.getElementsByTagName('head')[0].childNodes
    .filter((node) => node.tagName === 'STYLE')
    .map((node) => node.textContent)
    .join('\n');

  assert.match(styles, /@font-face/);
  assert.match(styles, /font-family:\s*'Zoopdog Nom Na Tong'/);
  assert.match(styles, /NomNaTong-Regular\.ttf/);
  assert.match(styles, /ruby\.zoopdog-nom-ruby > rt\.zoopdog-nom-rt[\s\S]*font-family:\s*'Zoopdog Nom Na Tong'/);
});

test('folds decomposed text before matching', () => {
  // Some pages and browser extensions write "của" as "c" + "u" + U+0309 + "a". The trie is
  // keyed on precomposed strings, so without folding the walk dies on the combining mark and
  // the reader silently gets no ruby at all. Built through NFD rather than written out, so
  // that an editor touching this file cannot recompose the fixture and void the test.
  const precomposed = 'của bạn';
  const dom = runRuntime(NOM_MAP);
  const paragraph = dom.document.createElement('p');
  const decomposed = precomposed.normalize('NFD');
  paragraph.appendChild(dom.document.createTextNode(decomposed));
  dom.body.appendChild(paragraph);

  assert.notEqual(decomposed, precomposed, 'the fixture really is decomposed');

  dom.tick();

  assert.deepEqual(rubyAnnotations(paragraph), [NOM_MAP['của'], NOM_MAP['bạn']]);
  assert.equal(visibleText(paragraph), precomposed, 'the text is left precomposed in the DOM');
});

test('annotates text a page streams into an existing text node', () => {
  const dom = runRuntime(NOM_MAP);
  const paragraph = dom.document.createElement('p');
  const streamed = dom.document.createTextNode('của');
  paragraph.appendChild(streamed);
  dom.body.appendChild(paragraph);
  dom.tick();

  // The page keeps its own reference to the text node and rewrites it as more text arrives.
  streamed.nodeValue = 'của bạn tình cảm';
  dom.tick();

  assert.equal(visibleText(paragraph), 'của bạn tình cảm');
  assert.deepEqual(rubyAnnotations(paragraph), ['𧵑', '伴', '情感']);
});

test('a later async line makes the runtime recover a missed first line in its container', () => {
  const dom = runRuntime(NOM_MAP);
  const translation = dom.document.createElement('div');
  dom.body.appendChild(translation);
  dom.tick();

  // Mobile translation widgets can assemble the first line outside the observed subtree,
  // then attach it before streaming later lines normally. The next child-list mutation is
  // the runtime's opportunity to reconcile the whole container.
  const firstLine = dom.document.createElement('p');
  firstLine.appendChild(dom.document.createTextNode('tình cảm của bạn'));
  dom.appendSilently(translation, firstLine);

  const secondLine = dom.document.createElement('p');
  secondLine.appendChild(dom.document.createTextNode('của bạn'));
  translation.appendChild(secondLine);
  dom.tick();

  assert.deepEqual(rubyAnnotations(firstLine), ['情感', '𧵑', '伴']);
  assert.deepEqual(rubyAnnotations(secondLine), ['𧵑', '伴']);
});

test('a rewritten text node leaves no annotated copy of the old text behind', () => {
  const dom = runRuntime(NOM_MAP);
  const paragraph = dom.document.createElement('p');
  const streamed = dom.document.createTextNode('của bạn');
  paragraph.appendChild(streamed);
  dom.body.appendChild(paragraph);
  dom.tick();

  streamed.nodeValue = 'tình cảm';
  dom.tick();

  assert.equal(visibleText(paragraph), 'tình cảm');
  assert.deepEqual(rubyAnnotations(paragraph), ['情感']);
});

test('a short ASCII-only word keeps its Vietnamese context after an earlier match in the same node is split off', () => {
  // "xe" itself carries no diacritics, so annotating it as ASCII-only text relies on
  // Vietnamese context nearby. Annotating "chạy" first splits the text node and leaves "xe"
  // in a tail node whose own text has lost that context, even though the original sentence
  // clearly had it just before the match.
  const map = Object.assign({}, NOM_MAP, {chạy: '走', xe: '車'});
  const dom = runRuntime(map);
  const paragraph = dom.document.createElement('p');
  paragraph.appendChild(dom.document.createTextNode('chạy xe'));
  dom.body.appendChild(paragraph);

  dom.tick();

  assert.equal(visibleText(paragraph), 'chạy xe');
  assert.deepEqual(rubyAnnotations(paragraph), ['走', '車']);
});

test('re-scanning unchanged content does not duplicate annotations', () => {
  const dom = runRuntime(NOM_MAP);
  const paragraph = dom.document.createElement('p');
  paragraph.appendChild(dom.document.createTextNode('của bạn'));
  dom.body.appendChild(paragraph);

  dom.tick();
  dom.tick();
  dom.tick();

  assert.equal(visibleText(paragraph), 'của bạn');
  assert.deepEqual(rubyAnnotations(paragraph), ['𧵑', '伴']);
});

// Video-caption widgets (Eudict) give every word its own block wrapper -- one text node per word
// inside a flex row, an empty text node and a no-break-space span after it -- so a dictionary
// entry of several words never sits in one text node. Matching only inside a text node
// annotated "chỉ" and "trích" separately (or not at all) instead of the entry "chỉ trích".
test('a multi-word entry split across per-word wrappers is annotated word by word', () => {
  const dom = runRuntime(Object.assign({}, NOM_MAP, {'chỉ trích': '指責'}));
  const row = dom.document.createElement('div');
  row.className = 'row';
  ['chỉ', 'trích', 'bạn'].forEach((word) => {
    const item = dom.document.createElement('span');
    item.className = 'item';
    const inner = dom.document.createElement('span');
    inner.appendChild(dom.document.createTextNode(word));
    item.appendChild(inner);
    item.appendChild(dom.document.createTextNode(''));
    const gap = dom.document.createElement('span');
    gap.appendChild(dom.document.createTextNode('\u00a0'));
    item.appendChild(gap);
    row.appendChild(item);
  });
  dom.body.appendChild(row);

  dom.tick();

  assert.equal(visibleText(row), 'chỉ\u00a0trích\u00a0bạn\u00a0');
  assert.deepEqual(rubyAnnotations(row), ['指', '責', '伴'],
    'the two characters of the entry are split one per word; the next word keeps its own');
});

test('punctuation between per-word wrappers keeps an entry from spanning them', () => {
  const dom = runRuntime(Object.assign({}, NOM_MAP, {'chỉ trích': '指責'}));
  const row = dom.document.createElement('div');
  row.className = 'row';
  ['chỉ,', 'trích'].forEach((word) => {
    const item = dom.document.createElement('span');
    item.className = 'item';
    const inner = dom.document.createElement('span');
    inner.appendChild(dom.document.createTextNode(word));
    item.appendChild(inner);
    row.appendChild(item);
  });
  dom.body.appendChild(row);

  dom.tick();

  assert.deepEqual(rubyAnnotations(row), [], 'neither "chỉ" nor "trích" is an entry by itself here');
});
