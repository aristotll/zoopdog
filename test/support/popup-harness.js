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
  pointerEvents = true
} = {}) {
  const calls = {caret: 0, elementFromPoint: 0};
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
    addEventListener() {},
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
    GM_addStyle() {},
    localStorage: {
      getItem: (key) => (debug && key === 'zoopdogDebug' ? '1' : null),
      setItem() {}
    }
  };
  const window = sandbox;
  window.window = window;
  window.innerWidth = 800;
  window.frames = []; // no child frames for the Shift relay to forward to
  window.innerHeight = 600;
  window.addEventListener = (type, listener) => { (windowListeners[type] || (windowListeners[type] = [])).push(listener); };
  window.setTimeout = () => 0;
  window.getComputedStyle = () => ({display: 'block'});
  if (pointerEvents) window.PointerEvent = function PointerEvent() {};
  if (animationFrames) {
    window.requestAnimationFrame = (callback) => { frames.push(callback); return frames.length; };
  }

  const context = vm.createContext(sandbox);
  const source = buildUserscript(dictionary, maxWords, readRuntimeSources(false), {
    targetKey: 'popupUserscript', nameSuffix: '', localMode: false
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
