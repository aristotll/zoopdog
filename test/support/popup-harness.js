'use strict';

// Loads the popup userscript (assembled from the real runtime sources, with a small fixture
// dictionary) into a vm context with a minimal fake DOM, so tests can drive pointer events
// through the shipped hover path. Only the surface the hover path touches is faked.

const vm = require('node:vm');

const {buildUserscript, readRuntimeSources} = require('../../scripts/build-popupdict-userscript');

function fakeElement(tagName = 'DIV') {
  const listeners = {};
  const node = {
    nodeType: 1,
    tagName,
    id: '',
    children: [],
    dataset: {},
    style: {},
    classList: {add() {}, remove() {}, contains() { return false; }},
    parentNode: null,
    get isConnected() { return !!this.parentNode; },
    parentElement: null,
    firstChild: null,
    nextSibling: null,
    addEventListener(type, listener) { (listeners[type] || (listeners[type] = [])).push(listener); },
    removeEventListener() {},
    appendChild(child) {
      child.parentNode = node;
      child.parentElement = node;
      node.children.push(child);
      return child;
    },
    setAttribute() {},
    getAttribute() { return null; },
    closest() { return null; },
    contains() { return false; },
    getBoundingClientRect() { return {left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0}; },
    getContext() {
      return {
        rect() {}, beginPath() {}, setTransform() {}, clearRect() {}, fill() {}
      };
    },
    textContent: '',
    innerHTML: ''
  };
  return node;
}

// One paragraph holding one text node; the caret API always answers with that text node.
function createPopupHarness({
  dictionary = {'bạn': [[['bạn'], [['friend', '']]]]},
  maxWords = 3,
  debug = false,
  animationFrames = false,
  pointerEvents = true,
  // A frame (window.top is another window) of this size; the top window by default.
  frame = null,
  localMode = false
} = {}) {
  const calls = {caret: 0, elementFromPoint: 0, addStyle: 0};
  const documentListeners = {};
  const state = {caretMiss: false};
  const parsed = []; // every text the runtime passed to JSON.parse
  const windowListeners = {};
  const body = fakeElement('BODY');
  const paragraph = fakeElement('P');
  const text = {nodeType: 3, data: 'bạn bè', parentNode: paragraph, parentElement: paragraph, nextSibling: null};
  paragraph.firstChild = text;
  body.appendChild(paragraph);

  const document = {
    body,
    documentElement: {clientWidth: 800, children: []},
    createElement: fakeElement,
    createTextNode: (data) => ({nodeType: 3, data}),
    getElementById: () => null,
    getElementsByTagName: () => [fakeElement('HEAD')],
    addEventListener(type, listener) { (documentListeners[type] || (documentListeners[type] = [])).push(listener); },
    querySelectorAll: () => [],
    caretRangeFromPoint() {
      calls.caret += 1;
      if (state.caretMiss) return null;
      return {startContainer: text, startOffset: 1};
    },
    elementFromPoint() {
      calls.elementFromPoint += 1;
      return paragraph;
    }
  };

  const frames = [];
  const sandbox = {
    document,
    Node: {ELEMENT_NODE: 1, TEXT_NODE: 3},
    Range: class {
      setStart() {}
      setEnd() {}
      getClientRects() { return [{left: 0, top: 0, right: 10, bottom: 10, width: 10, height: 10}]; }
    },
    console,
    JSON: {
      parse: (text) => { parsed.push(String(text)); return JSON.parse(text); },
      stringify: (...args) => JSON.stringify(...args)
    },
    Object, Array, String, Number, Math, Date, Set, Map, WeakMap, Promise, Error, isFinite, parseInt,
    setTimeout() { return 0; },
    clearTimeout() {},
    GM_addStyle() { calls.addStyle += 1; },
    localStorage: {
      getItem: (key) => (debug && key === 'zoopdogDebug' ? '1' : null),
      setItem() {}
    }
  };
  const window = sandbox;
  window.window = window;
  window.innerWidth = frame ? frame.width : 800;
  window.frames = []; // no child frames for the Shift relay to forward to
  window.innerHeight = frame ? frame.height : 600;
  if (localMode) window.location = {hostname: 'example.test', pathname: '/', search: '', href: 'https://example.test/'};
  window.top = frame ? {} : window;
  const parentMessages = [];
  window.parent = frame ? {postMessage(message) { parentMessages.push(message); }} : window;
  window.addEventListener = (type, listener) => { (windowListeners[type] || (windowListeners[type] = [])).push(listener); };
  window.removeEventListener = (type, listener) => {
    const list = windowListeners[type] || [];
    const at = list.indexOf(listener);
    if (at !== -1) list.splice(at, 1);
  };
  window.setTimeout = () => 0;
  window.getComputedStyle = () => ({display: 'block'});
  if (pointerEvents) window.PointerEvent = function PointerEvent() {};
  if (animationFrames) {
    window.requestAnimationFrame = (callback) => { frames.push(callback); return frames.length; };
  }

  const context = vm.createContext(sandbox);
  const source = buildUserscript(dictionary, maxWords, readRuntimeSources(localMode), {
    targetKey: localMode ? 'popupLocalUserscript' : 'popupUserscript', nameSuffix: localMode ? ' (Local)' : '', localMode
  });
  vm.runInContext(source, context);

  function pointerMove(x, y, extra) {
    const type = pointerEvents ? 'pointermove' : 'mousemove';
    const event = Object.assign({type, pointerType: 'mouse', clientX: x, clientY: y, target: paragraph}, extra);
    (windowListeners[type] || []).forEach((listener) => listener(event));
    return event;
  }

  function popupElement() {
    return body.children.find((child) => child.id === 'zoopdog-userscript-popup');
  }

  return {
    calls,
    parsed,
    state,
    context,
    source,
    pointerMove,
    popupElement,
    paragraph,
    parentMessages,
    windowListenerCount: (type) => (windowListeners[type] || []).length,
    documentListeners,
    // Event types with a listener on the window / the document, as a sorted list.
    windowListenerTypes: () => Object.keys(windowListeners).filter((type) => windowListeners[type].length).sort(),
    documentListenerTypes: () => Object.keys(documentListeners).filter((type) => documentListeners[type].length).sort(),
    // Resizes the window and tells its listeners, as a browser does.
    resize(width, height) {
      window.innerWidth = width;
      window.innerHeight = height;
      (windowListeners.resize || []).slice().forEach((listener) => listener({}));
    },
    // Dispatches an event of any type to the window listeners the runtime registered.
    dispatch(type, event) {
      (windowListeners[type] || []).forEach((listener) => listener(event));
    },
    // Runs every queued animation-frame callback, as the browser would at the next frame.
    flushFrames() {
      const pending = frames.splice(0);
      pending.forEach((callback) => callback(0));
      return pending.length;
    },
    get lastHover() { return popupElement().dataset.lastHover; }
  };
}

module.exports = {createPopupHarness};
