// Selection helpers are independent of popup state and receive the page document explicitly.
/**
 * @typedef {object} ZooSelectionOptions
 * @property {Document} document
 * @property {number} scanLimit
 * @property {(point: {x: number, y: number}) => ({node: Node, offset: number} | null | undefined)} caretFromPoint
 * @property {() => Selection} getSelection
 */
/** @param {ZooSelectionOptions} options */
function createZooSelectionTools(options) {
  /** @param {unknown} value */
  function trim(value) {
    return String(value || '').trim().replace(/\p{Cf}/gu, '')
      .replace(/^\p{P}+|\p{P}+$/gu, '').trim().normalize('NFC');
  }
  /** @param {any} node */
  function collectRoots(node) {
    /** @type {any[]} */
    var roots = [];
    if (!node) return roots;
    var start = node.nodeType === 1 ? node : node.parentElement;
    if (!start) return roots;
    var queue = [start], scanned = 0;
    while (queue.length && scanned < options.scanLimit) {
      var current = queue.pop();
      scanned++;
      if (current.shadowRoot) {
        roots.push(current.shadowRoot);
        queue.push(current.shadowRoot);
      }
      var children = current.children || [];
      for (var i = 0; i < children.length; i++) queue.push(children[i]);
    }
    return roots;
  }
  /** @param {any} selection @param {any} container */
  function composed(selection, container) {
    if (typeof selection.getComposedRanges !== 'function') return null;
    try {
      var roots = collectRoots(container);
      if (!roots.length) return null;
      var ranges = selection.getComposedRanges({shadowRoots: roots});
      if (!ranges || !ranges.length) return null;
      var range = options.document.createRange();
      range.setStart(ranges[0].startContainer, ranges[0].startOffset);
      range.setEnd(ranges[0].endContainer, ranges[0].endOffset);
      var rect = range.getBoundingClientRect();
      if (!rect || (!rect.width && !rect.height)) return null;
      var holder = options.document.createElement('div');
      holder.appendChild(range.cloneContents());
      Array.prototype.forEach.call(holder.querySelectorAll('rt, rp'), function(node) {
        node.parentNode.removeChild(node);
      });
      return {rect: rect, text: holder.textContent};
    } catch (error) { return null; }
  }
  // The term of a selection is the page's own words: Chu Nom <rt>/<rp> annotations are dropped even
  // when the browser reports them in toString() (user-select:none is not honoured everywhere, and
  // a page rule can override it). A selection without annotations keeps toString() untouched.
  /** @param {any} selection */
  function plainText(selection) {
    var raw = selection ? selection.toString() : '';
    try {
      if (!selection || !selection.rangeCount) return raw;
      var holder = options.document.createElement('div');
      for (var i = 0; i < selection.rangeCount; i++) holder.appendChild(selection.getRangeAt(i).cloneContents());
      var notes = holder.querySelectorAll('rt, rp');
      if (!notes.length) return raw;
      Array.prototype.forEach.call(notes, function(node) { node.parentNode.removeChild(node); });
      return holder.textContent;
    } catch (error) { return raw; }
  }
  // "Copy protection" plugins (WordPress wccp, `disable_copy`) cancel mousedown/selectstart on the
  // document and body, so no text can be selected at all. Drop only those handlers, recognised by
  // name, and stop page selectstart blockers from seeing the event.
  var BLOCKER = /disable_copy|wccp|disableselect|nocontext/;
  function unblockSelection() {
    var doc = options.document;
    /** @type {any[]} */ ([doc, doc.body, doc.documentElement]).forEach(function(target) {
      if (!target) return;
      ['onselectstart', 'onmousedown', 'ondragstart'].forEach(function(name) {
        var handler = target[name];
        if (typeof handler === 'function' && BLOCKER.test(Function.prototype.toString.call(handler))) target[name] = null;
      });
    });
  }
  /** @param {number} x @param {number} y */
  function annotationInLinkAt(x, y) {
    var caret = options.caretFromPoint({x: x, y: y});
    /** @type {any} */
    var node = caret && caret.node;
    if (!node) return null;
    var element = node.nodeType === 1 ? node : node.parentElement;
    if (!element || !element.closest) return null;
    var ruby = element.closest('ruby.zoopdog-nom-ruby');
    return ruby && ruby.closest('a[href]') ? ruby : null;
  }
  /** @param {{node: Node, offset: number}} start @param {{node: Node, offset: number}} end */
  function rangeBetween(start, end) {
    var range = options.document.createRange();
    try {
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset);
    } catch (error) { return null; }
    return range.collapsed ? null : range;
  }
  /** @param {{x: number, y: number}} from @param {{x: number, y: number}} to */
  function selectBetweenPoints(from, to) {
    var start = options.caretFromPoint({x: from.x, y: from.y});
    var end = options.caretFromPoint({x: to.x, y: to.y});
    if (!start || !end) return;
    // A reverse drag collapses the first range; retry the carets in document order.
    var range = rangeBetween(start, end) || rangeBetween(end, start);
    if (!range && start.node === end.node) {
      // A caret recovered from a ruby element boundary can have the same offset at both
      // ends of a drag. In that case select the whole word rather than losing the gesture.
      range = options.document.createRange();
      range.selectNodeContents(start.node);
    }
    if (!range || range.collapsed) return;
    var selection = options.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }
  return {trim: trim, collectRoots: collectRoots, composed: composed, plainText: plainText,
    unblockSelection: unblockSelection,
    annotationInLinkAt: annotationInLinkAt, selectBetweenPoints: selectBetweenPoints};
}
