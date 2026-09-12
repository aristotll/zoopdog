'use strict';

// The nom userscript runs as an IIFE against a live DOM, so it is exercised here the way a
// browser runs it: the runtime source is rendered with a tiny dictionary and evaluated in a
// vm against a minimal DOM that reports the same mutation records a browser reports.

const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');

const {readRuntime, renderRuntime} = require('../scripts/lib/userscript');

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const DOCUMENT_FRAGMENT_NODE = 11;

function createDom() {
  const records = [];
  let observedRoot = null;

  // A browser records a mutation only when its target is inside the observed subtree, so a
  // ruby assembled off-document produces no records until it is inserted.
  function record(entry) {
    if (observedRoot && observedRoot.contains(entry.target)) {
      records.push(entry);
    }
  }

  class MiniNode {
    constructor(nodeType) {
      this.nodeType = nodeType;
      this.parentNode = null;
      this.childNodes = [];
    }

    get previousSibling() {
      if (!this.parentNode) {
        return null;
      }
      const index = this.parentNode.childNodes.indexOf(this);
      return index > 0 ? this.parentNode.childNodes[index - 1] : null;
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

  class MiniElement extends MiniNode {
    constructor(tagName) {
      super(ELEMENT_NODE);
      this.tagName = tagName.toUpperCase();
      this.className = '';
      this.title = '';
      this.isContentEditable = false;
    }

    get textContent() {
      return this.childNodes.map((child) =>
        child.nodeType === TEXT_NODE ? child.nodeValue : child.textContent).join('');
    }

    set textContent(value) {
      this.childNodes.slice().forEach((child) => this.removeChild(child));
      this.appendChild(new MiniText(value));
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
      observedRoot = root;
    },
    appendSilently: (parent, node) => {
      parent.childNodes.push(node);
      node.parentNode = parent;
    },
    takeRecords: () => records.splice(0, records.length)
  };
}

function runRuntime(nomMap) {
  const dom = createDom();
  const source = renderRuntime(readRuntime('nom-ruby.runtime.js'), {
    '{"__ZOOPDOG_NOM_MAP__": true}': JSON.stringify(nomMap),
    '__ZOOPDOG_ENTRY_COUNT__': Object.keys(nomMap).length,
    '__ZOOPDOG_UPDATE_URL__': 'about:blank',
    '__ZOOPDOG_DOWNLOAD_URL__': 'about:blank',
    '__ZOOPDOG_VERSION__': '0.0.0-test'
  });

  const intervals = [];
  const context = {
    document: dom.document,
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
