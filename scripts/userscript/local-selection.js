// Selection helpers are independent of popup state and receive the page document explicitly.
function createZooSelectionTools(options) {
  function trim(value) {
    return String(value || '').trim().replace(/\p{Cf}/gu, '')
      .replace(/^\p{P}+|\p{P}+$/gu, '').trim().normalize('NFC');
  }
  function collectRoots(node) {
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
  function annotationInLinkAt(x, y) {
    var caret = options.caretFromPoint({x: x, y: y});
    var node = caret && caret.node;
    if (!node) return null;
    var element = node.nodeType === 1 ? node : node.parentElement;
    if (!element || !element.closest) return null;
    var ruby = element.closest('ruby.zoopdog-nom-ruby');
    return ruby && ruby.closest('a[href]') ? ruby : null;
  }
  function rangeBetween(start, end) {
    var range = options.document.createRange();
    try {
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset);
    } catch (error) { return null; }
    return range.collapsed ? null : range;
  }
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
  return {trim: trim, collectRoots: collectRoots, composed: composed,
    annotationInLinkAt: annotationInLinkAt, selectBetweenPoints: selectBetweenPoints};
}
