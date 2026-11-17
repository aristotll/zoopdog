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

    // Only the selector the runtime's removeAnnotations asks for.
    querySelectorAll(selector) {
      assert.equal(selector, 'ruby.zoopdog-nom-ruby');
      const found = [];
      (function walk(node) {
        node.childNodes.forEach((child) => {
          if (child.nodeType !== ELEMENT_NODE) return;
          if (child.tagName === 'RUBY' && /zoopdog-nom-ruby/.test(child.className)) found.push(child);
          walk(child);
        });
      })(this);
      return found;
    }

    // Merges adjacent text nodes without reporting records, like the runtime's own cleanup.
    normalize() {
      for (let i = this.childNodes.length - 1; i > 0; i--) {
        const here = this.childNodes[i], before = this.childNodes[i - 1];
        if (here.nodeType === TEXT_NODE && before.nodeType === TEXT_NODE) {
          before.data += here.data;
          here.parentNode = null;
          this.childNodes.splice(i, 1);
        }
      }
    }

    remove() {
      if (this.parentNode) {
        this.parentNode.removeChild(this);
      }
    }

    insertBefore(node, reference) {
      // A DocumentFragment hands over its children, in order, in a single childList record.
      if (node instanceof MiniFragment) {
        const moved = node.childNodes.splice(0, node.childNodes.length);
        const at = reference ? this.childNodes.indexOf(reference) : this.childNodes.length;
        this.childNodes.splice(at, 0, ...moved);
        moved.forEach((child) => { child.parentNode = this; });
        record({type: 'childList', target: this, addedNodes: moved});
        return node;
      }
      if (node.parentNode) {
        node.parentNode.removeChild(node);
      }
      const index = reference ? this.childNodes.indexOf(reference) : this.childNodes.length;
      this.childNodes.splice(index, 0, node);
      node.parentNode = this;
      record({type: 'childList', target: this, addedNodes: [node]});
      return node;
    }

    replaceChild(node, old) {
      this.insertBefore(node, old);
      return this.removeChild(old);
    }

    removeChild(node) {
      const index = this.childNodes.indexOf(node);
      if (index === -1) {
        throw new Error('removeChild: not a child');
      }
      this.childNodes.splice(index, 1);
      node.parentNode = null;
      record({type: 'childList', target: this, addedNodes: [], removedNodes: [node]});
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

  class MiniFragment extends MiniNode {
    constructor() {
      super(DOCUMENT_FRAGMENT_NODE);
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
      this.style = {};
      this.listeners = {};
    }

    addEventListener(type, listener) {
      (this.listeners[type] = this.listeners[type] || []).push(listener);
    }

    dispatch(type) {
      (this.listeners[type] || []).forEach((listener) => listener({stopPropagation() {}}));
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

  const flags = {challengeMarkup: false};
  const body = new MiniElement('body');
  const head = new MiniElement('head');

  const created = [];
  const document = {
    body,
    documentElement: null,
    createElement: (tagName) => {
      const element = new MiniElement(tagName);
      created.push(element);
      return element;
    },
    createTextNode: (data) => new MiniText(data),
    createDocumentFragment: () => new MiniFragment(),
    getElementsByTagName: (tagName) => (tagName === 'head' ? [head] : []),
    // Only the Cloudflare challenge markers are looked up by selector (see isCloudflareChallenge).
    querySelector: () => (flags.challengeMarkup ? {} : null),
    querySelectorAll: (selector) => body.querySelectorAll(selector)
  };

  return {
    document,
    body,
    MiniText,
    MiniElement,
    created,
    flags,
    observe: (root) => {
      observedRoots.add(root);
    },
    disconnect: () => {
      observedRoots.clear();
      records.length = 0;
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

// Options beyond the page itself: `timers` queues window.setTimeout instead of running it at once
// (drive it with runTimers), `clockStep` gives the runtime a fake performance.now() that moves that
// many milliseconds per read (0 = frozen, so a scan never runs out of time), and `toggle` makes the
// frame the top window with a <html> element so the toggle button exists (dom.button).
function runRuntime(nomMap, caseSensitiveNomMap = {}, {challengeMarkup = false, hostname = 'example.test', prototypeArrayFrom = false, parseCalls = null, timers = false, clockStep = null, toggle = false} = {}) {
  const dom = createDom();
  dom.flags.challengeMarkup = challengeMarkup;
  const source = renderRuntime(readRuntime('nom-ruby.runtime.js'), {
    '__ZOOPDOG_NOM_MATCH_ENGINE__': fs.readFileSync(nomMatchEnginePath, 'utf8'),
    '__ZOOPDOG_WORDS__': fs.readFileSync(wordsPath, 'utf8'),
    '__ZOOPDOG_OVERLAY_LABELS__': readRuntime('overlay-labels.js'),
    '__ZOOPDOG_LOCAL_SITE_RULES__': '[]',
    '{"__ZOOPDOG_NOM_MAP__": true}': JSON.stringify(JSON.stringify(nomMap)),
    '{"__ZOOPDOG_CASE_SENSITIVE_NOM_MAP__": true}': JSON.stringify(JSON.stringify(caseSensitiveNomMap)),
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
    Element: dom.MiniElement,
    getComputedStyle: displayOf,
    Node: {ELEMENT_NODE, TEXT_NODE, DOCUMENT_FRAGMENT_NODE},
    NodeList: {prototype: {forEach: Array.prototype.forEach}},
    MutationObserver: class {
      constructor() {}
      observe(root) {
        dom.observe(root);
      }
      disconnect() {
        dom.disconnect();
      }
      takeRecords() {
        return dom.takeRecords();
      }
    }
  };
  if (parseCalls) {
    // Records every JSON.parse the runtime performs, to show when the embedded maps are parsed.
    context.JSON = {
      parse: (text) => { parseCalls.push(String(text).length); return JSON.parse(text); },
      stringify: (...args) => JSON.stringify(...args)
    };
  }
  const timerQueue = [];
  let nextTimerId = 1;
  context.window = {
    location: {hostname},
    setTimeout: timers === 'absent' ? undefined : timers
      ? (fn, delay) => { const id = nextTimerId++; timerQueue.push({id, fn, delay}); return id; }
      : (fn) => fn(),
    clearTimeout: (id) => {
      const at = timerQueue.findIndex((timer) => timer.id === id);
      if (at !== -1) timerQueue.splice(at, 1);
    },
    setInterval: (fn) => intervals.push(fn),
    clearInterval: (fn) => {
      const at = intervals.indexOf(fn);
      if (at !== -1) intervals.splice(at, 1);
    }
  };
  if (clockStep !== null) {
    let clock = 0;
    context.performance = {now: () => (clock += clockStep)};
  }
  if (toggle) {
    context.window.top = context.window;
    dom.document.documentElement = new dom.MiniElement('html');
    dom.document.documentElement.dataset = {};
  }

  const originalAttachShadow = dom.MiniElement.prototype.attachShadow;
  vm.createContext(context);
  if (prototypeArrayFrom) {
    vm.runInContext("Array.from = function (value) { return Array.prototype.slice.call(value); }", context);
  }
  vm.runInContext(source, context);

  return Object.assign(dom, {
    attachShadowFn: () => dom.MiniElement.prototype.attachShadow,
    attachShadowPatched: () => dom.MiniElement.prototype.attachShadow !== originalAttachShadow,
    tick: () => intervals.forEach((fn) => fn()),
    pendingTimers: () => timerQueue.length,
    // Runs queued timers in order, including ones they queue, until none is left or `limit` ran.
    runTimers: (limit = 100000) => {
      let ran = 0;
      while (timerQueue.length && ran < limit) {
        timerQueue.shift().fn();
        ran++;
      }
      return ran;
    },
    button: () => dom.created.filter((element) => element.tagName === 'BUTTON')[0]});
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

test('the embedded maps are not parsed until a text node with word characters needs matching', () => {
  const parseCalls = [];
  const dom = runRuntime(NOM_MAP, {}, {parseCalls});
  const paragraph = dom.document.createElement('p');
  paragraph.appendChild(dom.document.createTextNode('.. ... \u4e2d\u6587 !!'));
  dom.body.appendChild(paragraph);
  dom.tick();
  assert.deepEqual(parseCalls, [], 'no word characters on the page, so no parse');

  const second = dom.document.createElement('p');
  second.appendChild(dom.document.createTextNode('của bạn'));
  dom.body.appendChild(second);
  dom.tick();
  assert.equal(parseCalls.length, 2, 'one parse per embedded map on first need');
  assert.deepEqual(rubyAnnotations(second), ['𧵑', '伴']);

  const third = dom.document.createElement('p');
  third.appendChild(dom.document.createTextNode('tình cảm'));
  dom.body.appendChild(third);
  dom.tick();
  assert.equal(parseCalls.length, 2, 'later matching reuses the built matcher');
  assert.deepEqual(rubyAnnotations(third), ['情感']);
});

test('annotates when Prototype replaces Array.from with an array-like converter', () => {
  const dom = runRuntime(NOM_MAP, {}, {prototypeArrayFrom: true});
  const paragraph = dom.document.createElement('p');
  paragraph.appendChild(dom.document.createTextNode('của bạn'));
  dom.body.appendChild(paragraph);
  dom.tick();
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

function headStyles(dom) {
  return dom.document.getElementsByTagName('head')[0].childNodes
    .filter((node) => node.tagName === 'STYLE')
    .map((node) => node.textContent);
}

test('injects the Nom Na Tong webfont for Chu Nom ruby text', () => {
  const dom = runRuntime(NOM_MAP);
  const paragraph = dom.document.createElement('p');
  paragraph.appendChild(dom.document.createTextNode('của bạn'));
  dom.body.appendChild(paragraph);
  dom.tick();
  const styles = headStyles(dom).join('\n');

  assert.match(styles, /@font-face/);
  assert.match(styles, /font-family:\s*'Zoopdog Nom Na Tong'/);
  assert.match(styles, /NomNaTong-Regular\.ttf/);
  assert.match(styles, /ruby\.zoopdog-nom-ruby > rt\.zoopdog-nom-rt[\s\S]*font-family:\s*'Zoopdog Nom Na Tong'/);
});

// The -local build embeds the whole font (~14MB of base64) in that @font-face. Every page and
// iframe the userscript runs in used to parse it, annotated or not; now only a document that
// actually shows an annotation pays for it, and only once.
test('a page with nothing to annotate never receives the webfont', () => {
  const dom = runRuntime(NOM_MAP);
  const paragraph = dom.document.createElement('p');
  paragraph.appendChild(dom.document.createTextNode('nothing here in english'));
  dom.body.appendChild(paragraph);
  dom.tick();

  assert.doesNotMatch(headStyles(dom).join('\n'), /@font-face/);
});

test('the webfont is injected once, however many annotations follow', () => {
  const dom = runRuntime(NOM_MAP);
  for (let i = 0; i < 3; i++) {
    const paragraph = dom.document.createElement('p');
    paragraph.appendChild(dom.document.createTextNode('của bạn'));
    dom.body.appendChild(paragraph);
    dom.tick();
  }

  const fontFaces = headStyles(dom).filter((css) => /@font-face/.test(css));
  assert.equal(fontFaces.length, 1);
});

// A document-level @font-face is visible to shadow trees, so a shadow root only needs the
// ruby/rt rules; repeating the font there parsed the ~14MB font once per watched shadow root.
test('a watched shadow root gets the ruby rules but not another copy of the webfont', () => {
  const dom = runRuntime(NOM_MAP);
  const host = dom.document.createElement('app-video-captions');
  dom.body.appendChild(host);
  const shadow = host.attachShadow({mode: 'open'});
  const line = dom.document.createElement('span');
  line.appendChild(dom.document.createTextNode('của bạn'));
  shadow.appendChild(line);
  dom.tick();

  const shadowStyles = shadow.childNodes
    .filter((node) => node.tagName === 'STYLE')
    .map((node) => node.textContent)
    .join('\n');
  assert.match(shadowStyles, /ruby\.zoopdog-nom-ruby/);
  assert.doesNotMatch(shadowStyles, /@font-face/);
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

// An annotated caption row is taller than a plain one, and Eudict caps its rows with
// `max-height` + `overflow: hidden`, which clipped the lower lines and pushed them over the row
// above. The override has to reach the overlay's own shadow root, since a page style cannot.
test('the styles injected into a caption shadow root lift the overlay row height cap', () => {
  const dom = runRuntime(NOM_MAP);
  const host = dom.document.createElement('app-video-captions');
  dom.body.appendChild(host);
  const shadow = host.attachShadow({mode: 'open'});
  shadow.appendChild(dom.document.createElement('span'));

  dom.tick();

  const css = shadow.childNodes
    .filter((node) => node.tagName === 'STYLE')
    .map((node) => node.textContent)
    .join('\n');
  assert.match(css, /\.eudic-chrome-extension-video-dest[\s\S]*max-height:\s*none\s*!important/);
  assert.match(css, /overflow:\s*visible\s*!important/);
});

function shape(node) {
  return node.childNodes.map((child) =>
    child.nodeType === TEXT_NODE ? `T:${child.nodeValue}` : `R:${visibleText(child)}`);
}

test('several matches in one text node become alternating ruby and text, keeping the node itself', () => {
  const dom = runRuntime(NOM_MAP);
  const paragraph = dom.document.createElement('p');
  const original = dom.document.createTextNode('xin của bạn, tình cảm');
  paragraph.appendChild(original);
  dom.body.appendChild(paragraph);

  dom.tick();

  assert.deepEqual(shape(paragraph), ['T:xin ', 'R:của', 'T: ', 'R:bạn', 'T:, ', 'R:tình cảm', 'T:']);
  assert.equal(paragraph.childNodes[0], original, 'the page still holds the node that keeps the head text');
  assert.deepEqual(rubyAnnotations(paragraph), ['𧵑', '伴', '情感']);
});

test('the non-breaking spaces of a matched node survive annotation', () => {
  const dom = runRuntime(NOM_MAP);
  const paragraph = dom.document.createElement('p');
  paragraph.appendChild(dom.document.createTextNode('của bạn tình cảm'));
  dom.body.appendChild(paragraph);

  dom.tick();

  assert.equal(visibleText(paragraph), 'của bạn tình cảm');
});

test('text with no word character is left exactly as it is', () => {
  const dom = runRuntime(NOM_MAP);
  const paragraph = dom.document.createElement('p');
  const node = dom.document.createTextNode('  —— 。、 !? ');
  paragraph.appendChild(node);
  dom.body.appendChild(paragraph);

  dom.tick();

  assert.equal(paragraph.childNodes.length, 1);
  assert.equal(paragraph.childNodes[0], node);
  assert.equal(node.nodeValue, '  —— 。、 !? ');
});

test('annotating leaves no records queued for a second pass over the same nodes', () => {
  const dom = runRuntime(NOM_MAP);
  const paragraph = dom.document.createElement('p');
  paragraph.appendChild(dom.document.createTextNode('của bạn'));
  dom.body.appendChild(paragraph);

  dom.tick();

  assert.deepEqual(dom.takeRecords(), [], 'the script\'s own writes are not fed back to itself');
  const before = shape(paragraph);
  dom.tick();
  assert.deepEqual(shape(paragraph), before);
});

test('the text after a match that spans two wrappers is annotated in the same pass', () => {
  const dom = runRuntime(NOM_MAP);
  const row = dom.document.createElement('div');
  row.className = 'row';
  ['tình ', 'cảm của bạn'].forEach((words) => {
    const item = dom.document.createElement('span');
    item.className = 'item';
    item.appendChild(dom.document.createTextNode(words));
    row.appendChild(item);
  });
  dom.body.appendChild(row);

  dom.tick();

  assert.equal(visibleText(row), 'tình cảm của bạn');
  assert.deepEqual(rubyAnnotations(row), ['情', '感', '𧵑', '伴']);
});

test('a page mutating an annotated node still gets the new text annotated once', () => {
  const dom = runRuntime(NOM_MAP);
  const paragraph = dom.document.createElement('p');
  const node = dom.document.createTextNode('của');
  paragraph.appendChild(node);
  dom.body.appendChild(paragraph);
  dom.tick();

  node.nodeValue = 'bạn';
  dom.tick();

  assert.equal(visibleText(paragraph), 'bạn');
  assert.deepEqual(rubyAnnotations(paragraph), ['伴']);
});

// The scan that finds a match spanning two wrappers may be the only one that ever reaches the
// second wrapper's text (here the second row was added without any mutation record), so the
// text left after its wrapped word has to be picked up from the match itself, not from a
// follow-up record.
test('the tail of a following wrapper is annotated even when nothing else queues it', () => {
  const dom = runRuntime(NOM_MAP);
  const first = dom.document.createElement('div');
  const second = dom.document.createElement('div');
  const lead = dom.document.createTextNode('');
  first.appendChild(lead);
  second.appendChild(dom.document.createTextNode('cảm của bạn'));
  dom.appendSilently(dom.body, first);
  dom.appendSilently(dom.body, second);

  lead.nodeValue = 'tình ';
  dom.tick();
  dom.tick();

  assert.equal(visibleText(dom.body), 'tình cảm của bạn');
  assert.deepEqual(rubyAnnotations(dom.body), ['情', '感', '𧵑', '伴']);
});

// A Cloudflare challenge ("Just a moment...") loops forever when an extension rewrites its text
// or patches built-ins such as attachShadow; the script must leave such a page completely alone.
test('a Cloudflare challenge page is neither annotated nor has attachShadow patched', () => {
  const dom = runRuntime(NOM_MAP, {}, {challengeMarkup: true});
  const paragraph = dom.document.createElement('p');
  paragraph.appendChild(dom.document.createTextNode('của bạn'));
  dom.body.appendChild(paragraph);
  dom.tick();

  assert.deepEqual(rubyAnnotations(paragraph), []);
  assert.equal(dom.attachShadowPatched(), false);
});

test('the Turnstile frame on challenges.cloudflare.com is left alone', () => {
  const dom = runRuntime(NOM_MAP, {}, {hostname: 'challenges.cloudflare.com'});
  const paragraph = dom.document.createElement('p');
  paragraph.appendChild(dom.document.createTextNode('của bạn'));
  dom.body.appendChild(paragraph);
  dom.tick();

  assert.deepEqual(rubyAnnotations(paragraph), []);
});

// Bot detection reads `attachShadow.toString()`; a plain wrapper function shows its source.
test('the attachShadow patch of an ordinary page still reads as native code', () => {
  const dom = runRuntime(NOM_MAP);

  assert.equal(dom.attachShadowPatched(), true);
  assert.match(Function.prototype.toString.call(dom.attachShadowFn()), /\[native code\]/);
});

test('character changes and queued additions inside excluded ancestors are not annotated', () => {
  for (const tag of ['rt', 'rp', 'script', 'style', 'noscript', 'select', 'textarea',
    'input', 'button', 'option', 'code', 'pre', 'kbd', 'samp']) {
    const dom = runRuntime(NOM_MAP);
    const wrapper = dom.document.createElement(tag);
    const child = dom.document.createElement('span');
    const text = dom.document.createTextNode('foo');
    child.appendChild(text);
    wrapper.appendChild(child);
    dom.body.appendChild(wrapper);
    dom.tick();
    text.nodeValue = 'bạn';
    dom.tick();
    assert.equal(visibleText(child), 'bạn', tag);
    assert.deepEqual(rubyAnnotations(child), [], tag);
    const added = dom.document.createElement('span');
    added.appendChild(dom.document.createTextNode('bạn'));
    child.appendChild(added);
    dom.tick();
    assert.deepEqual(rubyAnnotations(added), [], `${tag}: nested addition`);
  }
});

test('Vietnamese inside another script\'s ruby base is annotated, its rt is not', () => {
  const dom = runRuntime(NOM_MAP);
  const ruby = dom.document.createElement('ruby');
  ruby.className = 'zd-cjk-ruby';
  const base = dom.document.createElement('span');
  base.appendChild(dom.document.createTextNode('bạn'));
  ruby.appendChild(base);
  const rt = dom.document.createElement('rt');
  const inRt = dom.document.createElement('span');
  inRt.appendChild(dom.document.createTextNode('bạn'));
  rt.appendChild(inRt);
  ruby.appendChild(rt);
  dom.body.appendChild(ruby);
  dom.tick();
  assert.equal(rubyAnnotations(base).length, 1);
  assert.deepEqual(rubyAnnotations(inRt), []);
});

test('on an overlay site the page text is left exactly as it is', () => {
  const dom = runRuntime(NOM_MAP, {}, {hostname: 'www.zhihu.com'});
  const p = dom.document.createElement('p');
  const text = dom.document.createTextNode('foo bạn bar');
  p.appendChild(text);
  dom.body.appendChild(p);
  dom.tick();
  dom.tick();
  assert.deepEqual(rubyAnnotations(p), [], 'no <ruby> is inserted in overlay mode');
  assert.equal(p.childNodes.length, 1, 'the text node is not split');
  assert.equal(text.nodeValue, 'foo bạn bar');
});

test('rewriting a later segment retires the entire cross-node annotation', () => {
  const dom = runRuntime(NOM_MAP);
  const parent = dom.document.createElement('p');
  const first = dom.document.createElement('span');
  const last = dom.document.createElement('span');
  const firstText = dom.document.createTextNode('tình ');
  const lastText = dom.document.createTextNode('cảm');
  first.appendChild(firstText);
  last.appendChild(lastText);
  parent.appendChild(first);
  parent.appendChild(last);
  dom.body.appendChild(parent);
  dom.tick();
  lastText.nodeValue = 'bạn';
  dom.tick();
  assert.equal(visibleText(parent), 'tình bạn');
  assert.deepEqual(rubyAnnotations(parent), ['伴']);
});

test('removing a segment retires remaining pieces without restoring removed content', () => {
  const dom = runRuntime(NOM_MAP);
  const parent = dom.document.createElement('p');
  const first = dom.document.createElement('span');
  const last = dom.document.createElement('span');
  first.appendChild(dom.document.createTextNode('tình '));
  last.appendChild(dom.document.createTextNode('cảm'));
  parent.appendChild(first); parent.appendChild(last); dom.body.appendChild(parent); dom.tick();
  parent.removeChild(last); dom.tick();
  assert.equal(visibleText(parent), 'tình ');
  assert.deepEqual(rubyAnnotations(parent), []);
});

test('adding an empty element does not rescan unrelated old paragraphs', () => {
  for (const count of [20, 100]) {
    const dom = runRuntime(NOM_MAP);
    const texts = [];
    for (let i = 0; i < count; i++) {
      const p = dom.document.createElement('p');
      const text = dom.document.createTextNode('nothing here');
      texts.push(text); p.appendChild(text); dom.body.appendChild(p);
    }
    dom.tick();
    let reads = 0;
    for (const text of texts) Object.defineProperty(text, 'nodeValue', {
      get() { reads++; return this.data; }, set(value) { this.data = value; }, configurable: true
    });
    dom.body.appendChild(dom.document.createElement('div'));
    dom.tick();
    assert.ok(reads < 10, `${count} paragraphs caused ${reads} reads`);
  }
});

test('rewriting the first segment preserves unchanged following text and tail', () => {
  const dom = runRuntime(NOM_MAP);
  const parent = dom.document.createElement('p');
  const first = dom.document.createElement('span');
  const last = dom.document.createElement('span');
  const firstText = dom.document.createTextNode('tình ');
  first.appendChild(firstText);
  last.appendChild(dom.document.createTextNode('cảm của bạn'));
  parent.appendChild(first); parent.appendChild(last); dom.body.appendChild(parent); dom.tick();
  firstText.nodeValue = 'bạn ';
  dom.tick();
  assert.equal(visibleText(parent), 'bạn cảm của bạn');
});

test('queued text moved into an editable ancestor stays unannotated', () => {
  const dom = runRuntime(NOM_MAP);
  const paragraph = dom.document.createElement('p');
  const editor = dom.document.createElement('div');
  editor.isContentEditable = true;
  dom.body.appendChild(paragraph); dom.body.appendChild(editor); dom.tick();
  const text = dom.document.createTextNode('bạn');
  paragraph.appendChild(text);
  editor.appendChild(text);
  dom.tick();
  assert.equal(visibleText(editor), 'bạn');
  assert.deepEqual(rubyAnnotations(editor), []);
});

test('rewriting each segment of a three-node span preserves all other text', () => {
  for (const changed of [0, 1, 2]) {
    const dom = runRuntime({...NOM_MAP, 'tình cảm bạn': '情感伴'});
    const parent = dom.document.createElement('p');
    const nodes = [];
    for (const value of ['tình ', 'cảm ', 'bạn']) {
      const span = dom.document.createElement('span');
      const text = dom.document.createTextNode(value);
      nodes.push(text); span.appendChild(text); parent.appendChild(span);
    }
    dom.body.appendChild(parent); dom.tick();
    const replacement = changed === 2 ? 'của' : 'của ';
    nodes[changed].nodeValue = replacement;
    dom.tick();
    const expected = ['tình ', 'cảm ', 'bạn'];
    expected[changed] = replacement;
    assert.equal(visibleText(parent), expected.join(''), `changed segment ${changed}`);
  }
});

test('a page edit to a generated trailing text node survives later span reconciliation', () => {
  const dom = runRuntime(NOM_MAP);
  const parent = dom.document.createElement('p');
  const first = dom.document.createElement('span');
  const last = dom.document.createElement('span');
  const firstText = dom.document.createTextNode('tình ');
  first.appendChild(firstText); last.appendChild(dom.document.createTextNode('cảm xyz'));
  parent.appendChild(first); parent.appendChild(last); dom.body.appendChild(parent); dom.tick();
  const tail = last.childNodes.find(node => node.nodeType === TEXT_NODE && node.nodeValue.includes('xyz'));
  assert.ok(tail);
  tail.nodeValue = ' mới'; dom.tick();
  firstText.nodeValue = 'bạn '; dom.tick();
  assert.equal(visibleText(parent), 'bạn cảm mới');
});

test('rewriting a segment without its own ruby retires the cross-node annotation', () => {
  const dom = runRuntime({...NOM_MAP, 'tình cảm': '情'});
  const parent = dom.document.createElement('p');
  const first = dom.document.createElement('span');
  const last = dom.document.createElement('span');
  first.appendChild(dom.document.createTextNode('tình '));
  const lastText = dom.document.createTextNode('cảm');
  last.appendChild(lastText); parent.appendChild(first); parent.appendChild(last);
  dom.body.appendChild(parent); dom.tick();
  lastText.nodeValue = 'bạn'; dom.tick();
  assert.equal(visibleText(parent), 'tình bạn');
  assert.deepEqual(rubyAnnotations(parent), ['伴']);
});

test('a small body insertion does not rescan a large preceding subtree', () => {
  const dom = runRuntime(NOM_MAP);
  const feed = dom.document.createElement('div');
  const texts = [];
  for (let i = 0; i < 120; i++) {
    const p = dom.document.createElement('p');
    const text = dom.document.createTextNode('unrelated');
    texts.push(text); p.appendChild(text); feed.appendChild(p);
  }
  dom.body.appendChild(feed); dom.tick();
  let reads = 0;
  for (const text of texts) Object.defineProperty(text, 'nodeValue', {
    get() { reads++; return this.data; }, set(value) { this.data = value; }, configurable: true
  });
  const added = dom.document.createElement('p');
  added.appendChild(dom.document.createTextNode('bạn'));
  dom.body.appendChild(added); dom.tick();
  assert.ok(reads < 10, `read ${reads} unrelated text nodes`);
  assert.deepEqual(rubyAnnotations(added), ['伴']);
});

test('changing a segment with its own later annotation retires the cross-node annotation', () => {
  const dom = runRuntime({'tình bạn': '情', 'bạn': '伴', 'của': '𧵑'});
  const parent = dom.document.createElement('p');
  const first = dom.document.createElement('span');
  const last = dom.document.createElement('span');
  first.appendChild(dom.document.createTextNode('tình '));
  const lastText = dom.document.createTextNode('bạn');
  last.appendChild(lastText); parent.appendChild(first); parent.appendChild(last);
  dom.body.appendChild(parent); dom.tick();
  lastText.nodeValue = 'của'; dom.tick();
  assert.equal(visibleText(parent), 'tình của');
  assert.deepEqual(rubyAnnotations(parent), ['𧵑']);
});

test('an unannotated span segment leaves its following text eligible for annotation', () => {
  const dom = runRuntime({'tình bạn': '情', 'bạn': '伴', 'của': '𧵑'});
  const parent = dom.document.createElement('p');
  const first = dom.document.createElement('span');
  const last = dom.document.createElement('span');
  first.appendChild(dom.document.createTextNode('tình '));
  last.appendChild(dom.document.createTextNode('bạn của'));
  parent.appendChild(first); parent.appendChild(last); dom.body.appendChild(parent); dom.tick();
  assert.equal(visibleText(parent), 'tình bạn của');
  assert.deepEqual(rubyAnnotations(parent), ['情', '𧵑']);
});

test('removing a deeply nested detached subtree does not overflow during mutation cleanup', () => {
  const dom = runRuntime(NOM_MAP);
  const root = dom.document.createElement('div');
  let parent = root;
  for (let i = 0; i < 12000; i++) {
    const child = dom.document.createElement('div');
    // Construct the detached fixture without enqueuing unrelated mutation records.
    parent.childNodes.push(child); child.parentNode = parent; parent = child;
  }
  dom.body.appendChild(root);
  dom.body.removeChild(root);
  assert.doesNotThrow(() => dom.tick());
  assert.deepEqual(rubyAnnotations(dom.body), []);
});

test('edits and nested additions in a contenteditable ancestor are never annotated', () => {
  const dom = runRuntime(NOM_MAP);
  const editor = dom.document.createElement('div');
  editor.isContentEditable = true;
  const child = dom.document.createElement('span');
  const text = dom.document.createTextNode('foo');
  child.appendChild(text); editor.appendChild(child); dom.body.appendChild(editor); dom.tick();
  text.nodeValue = 'bạn';
  const added = dom.document.createElement('span');
  added.appendChild(dom.document.createTextNode('bạn'));
  child.appendChild(added); dom.tick();
  assert.equal(visibleText(editor), 'bạnbạn');
  assert.deepEqual(rubyAnnotations(editor), []);
});

test('append to feeds of different sizes inspects only a bounded preceding region', () => {
  for (const count of [20, 120, 500]) {
    const dom = runRuntime(NOM_MAP);
    const feed = dom.document.createElement('div'), texts = [];
    for (let i = 0; i < count; i++) {
      const row = dom.document.createElement('p'), text = dom.document.createTextNode('unrelated');
      texts.push(text); row.appendChild(text); feed.appendChild(row);
    }
    dom.body.appendChild(feed); dom.tick();
    let reads = 0;
    for (const text of texts) Object.defineProperty(text, 'nodeValue', {
      get() { reads++; return this.data; }, set(value) { this.data = value; }, configurable: true
    });
    const added = dom.document.createElement('p');
    added.appendChild(dom.document.createTextNode('bạn'));
    feed.appendChild(added); dom.tick();
    assert.ok(reads < 12, `${count} rows caused ${reads} reads`);
    assert.deepEqual(rubyAnnotations(added), ['伴']);
  }
});

test('the ancestor exclusion check runs once per scan root, not once per node', () => {
  const reads = [];
  for (const depth of [50, 200, 800]) {
    const dom = runRuntime(NOM_MAP);
    let count = 0;
    const track = (el) => Object.defineProperty(el, 'tagName', {
      get() { count++; return 'DIV'; }, configurable: true
    });
    const root = dom.document.createElement('div');
    track(root);
    let parent = root;
    for (let i = 0; i < depth; i++) {
      const child = dom.document.createElement('div');
      track(child);
      child.appendChild(dom.document.createTextNode('bạn'));
      parent.appendChild(child);
      parent = child;
    }
    dom.body.appendChild(root);
    count = 0;
    dom.tick();
    reads.push(count);
    // Every element is tested once by the descent; the root's own ancestor walk adds a constant.
    assert.ok(count <= depth + 5, `depth ${depth}: ${count} tagName reads`);
    assert.equal(rubyAnnotations(root).length, depth);
  }
});

// Every node, tag and text, so two runs can be compared exactly (visibleText hides the ruby text).
function serialize(node) {
  return node.nodeType === TEXT_NODE
    ? JSON.stringify(node.nodeValue)
    : `<${node.tagName}>${node.childNodes.map(serialize).join('')}</${node.tagName}>`;
}

// `silent` adds them without mutation records, so only a render (toggle click) queues the body.
function fillParagraphs(dom, count, text = 'của bạn và tình cảm', silent = false) {
  const paragraphs = [];
  for (let i = 0; i < count; i++) {
    const p = dom.document.createElement('p');
    p.appendChild(dom.document.createTextNode(text));
    if (silent) dom.appendSilently(dom.body, p); else dom.body.appendChild(p);
    paragraphs.push(p);
  }
  return paragraphs;
}

test('a large scan is sliced yet annotates exactly what an unsliced scan does', () => {
  const whole = runRuntime(NOM_MAP, {}, {timers: true, clockStep: 0});
  fillParagraphs(whole, 400);
  whole.tick();
  assert.equal(whole.pendingTimers(), 0, 'a frozen clock never pauses a scan');

  const sliced = runRuntime(NOM_MAP, {}, {timers: true, clockStep: 1});
  fillParagraphs(sliced, 400);
  sliced.tick();
  assert.equal(sliced.pendingTimers(), 1, 'the scan yielded and queued its continuation');
  assert.ok(rubyAnnotations(sliced.body).length < rubyAnnotations(whole.body).length);
  const slices = sliced.runTimers();

  assert.ok(slices > 5, `only ${slices} continuations`);
  assert.equal(sliced.pendingTimers(), 0);
  assert.equal(rubyAnnotations(whole.body).length, 400 * 3);
  assert.equal(serialize(sliced.body), serialize(whole.body));
});

test('a scan without a clock or timers stays synchronous', () => {
  const dom = runRuntime(NOM_MAP, {}, {timers: 'absent', clockStep: 1});
  fillParagraphs(dom, 200);
  dom.tick();
  assert.equal(rubyAnnotations(dom.body).length, 200 * 3);
});

test('mutations that arrive between slices are not lost and nothing is annotated twice', () => {
  const dom = runRuntime(NOM_MAP, {}, {timers: true, clockStep: 1, toggle: true});
  const paragraphs = fillParagraphs(dom, 300, 'của bạn và tình cảm', true);
  dom.button().dispatch('click');
  dom.runTimers(1); // the click's own delay; the body scan it starts pauses and queues a continuation
  assert.equal(dom.pendingTimers(), 1);
  const firstUnvisited = paragraphs.findIndex((p) => rubyAnnotations(p).length === 0);
  assert.ok(firstUnvisited > 0 && firstUnvisited < 100, `paused after ${firstUnvisited} paragraphs`);

  // The page rewrites a paragraph that was already annotated, removes the very next one the scan
  // was about to reach, rewrites a later one and appends a new one.
  paragraphs[0].childNodes[0].nodeValue = 'bạn';
  dom.body.removeChild(paragraphs[firstUnvisited]);
  paragraphs[200].childNodes[0].nodeValue = 'của';
  const added = dom.document.createElement('p');
  added.appendChild(dom.document.createTextNode('tình cảm'));
  dom.body.appendChild(added);
  dom.runTimers();

  assert.equal(dom.pendingTimers(), 0);
  const expected = new Map([[paragraphs[0], ['伴']], [paragraphs[200], ['𧵑']], [added, ['情感']]]);
  const texts = new Map([[paragraphs[0], 'bạn'], [paragraphs[200], 'của'], [added, 'tình cảm']]);
  paragraphs.forEach((p) => {
    if (p === paragraphs[firstUnvisited]) return;
    assert.deepEqual(rubyAnnotations(p), expected.get(p) || ['𧵑', '伴', '情感'], serialize(p));
    assert.equal(visibleText(p), texts.get(p) || 'của bạn và tình cảm');
  });
  assert.deepEqual(rubyAnnotations(added), ['情感']);
  assert.equal(visibleText(added), 'tình cảm');
});

test('turning the script off during a sliced scan leaves no annotation behind', () => {
  const dom = runRuntime(NOM_MAP, {}, {timers: true, clockStep: 1, toggle: true});
  fillParagraphs(dom, 300);
  dom.tick();
  assert.equal(dom.pendingTimers(), 1);
  assert.ok(rubyAnnotations(dom.body).length > 0);

  dom.button().dispatch('dblclick');
  assert.equal(dom.pendingTimers(), 1, 'only the removal is queued; the continuation was cancelled');
  dom.runTimers();
  dom.tick();

  assert.deepEqual(rubyAnnotations(dom.body), []);
  assert.equal(dom.pendingTimers(), 0);
  assert.equal(visibleText(dom.body), 'của bạn và tình cảm'.repeat(300));
});

test('rendering again during a sliced scan supersedes it without double annotation', () => {
  const dom = runRuntime(NOM_MAP, {}, {timers: true, clockStep: 1, toggle: true});
  fillParagraphs(dom, 300);
  dom.tick();
  assert.equal(dom.pendingTimers(), 1);

  dom.button().dispatch('click');
  dom.runTimers();

  assert.equal(dom.pendingTimers(), 0);
  assert.equal(rubyAnnotations(dom.body).length, 300 * 3);
  assert.equal(visibleText(dom.body), 'của bạn và tình cảm'.repeat(300));
});
