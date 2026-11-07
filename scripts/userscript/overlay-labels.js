// Shared "overlay" renderer, inlined into zoopdog-nom-ruby and zoopdog-cjk-ruby by their builders
//. It draws annotation labels in a fixed, click-through layer above
// the page and never touches the page's own DOM: translators, other scripts and the popup dictionary keep
// seeing the original text, and page CSS (clamped boxes, line-height, `display` resets such as Reddit's
// `all: revert; display: inline !important`) cannot break the layout.
//
// A record is {start, end, layers, onRemove?}: a word at [start, end) of a text node. `layers` are drawn
// outward from the word, `over` ones above it and `under` ones below it:
//   {under: boolean, scale: number (font size relative to the text), color?, family?, weight?,
//    pieces: [{text, from?, to?}]}      -- a piece with from/to sits over that sub-range (e.g. one
//                                          syllable over its hanzi), one without over the whole word.
// A label that would collide with an earlier one is lifted by a line (twice at most) instead of dropped.
function zdCreateOverlay(doc, win, options) {
  options = options || {};
  var records = new Set();
  var nodes = new WeakMap();   // text node -> {text, records}
  var host = null;
  var layer = null;
  var pool = [];
  var scheduled = false;
  var hidden = false;
  var lastStats = '';
  var HAN_LIFT_LEVELS = 3;

  function removeRecord(rec) {
    records.delete(rec);
    if (typeof rec.onRemove === 'function') rec.onRemove(rec);
  }

  function ensureHost() {
    if (host && host.isConnected) return;
    if (!host) {
      host = doc.createElement('div');
      host.id = options.id || 'zoopdog-overlay';
      host.setAttribute('aria-hidden', 'true');
      host.style.cssText = 'all:initial;position:fixed;top:0;right:0;bottom:0;left:0;overflow:hidden;' +
        'pointer-events:none;z-index:2147483646;contain:strict;';
      layer = host.attachShadow({mode: 'closed'});
      var style = doc.createElement('style');
      style.textContent = '.l{position:absolute;left:0;top:0;white-space:nowrap;line-height:1.15;' +
        'text-align:center;font-family:system-ui,sans-serif;font-weight:400;will-change:transform;}';
      layer.appendChild(style);
    }
    // Translators and frameworks rebuild <body>; a layer that fell out of the document is put back.
    doc.documentElement.appendChild(host);
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    // A hidden tab pauses animation frames; the timer keeps the labels current there too.
    if (win.requestAnimationFrame) win.requestAnimationFrame(layout);
    win.setTimeout(layout, 250);
  }

  function set(node, text, recs) {
    var known = nodes.get(node);
    if (known) known.records.forEach(removeRecord);
    nodes.set(node, {text: text, records: recs});
    recs.forEach(function(rec) {
      rec.node = node;
      records.add(rec);
    });
    schedule();
  }

  function clear() {
    Array.from(records).forEach(removeRecord);
    nodes = new WeakMap();
    schedule();
  }

  function layout() {
    if (!scheduled) return; // the frame or the timer already ran this round
    scheduled = false;
    try {
      ensureHost();
      host.style.display = hidden ? 'none' : '';
      var vw = win.innerWidth;
      var vh = win.innerHeight;
      var parentCache = new Map();
      var placed = [];
      var used = 0;
      var dropped = 0;

      var put = function(text, cx, bottom, size, style) {
        if (!text) return;
        var width = text.length * size * 0.5;
        var left = cx - width / 2;
        if (left < 0) cx += -left;
        if (left + width > vw) cx -= left + width - vw;
        var box = null;
        for (var level = 0; level < HAN_LIFT_LEVELS && !box; level++) {
          var lift = level * size * 1.15;
          var candidate = {l: cx - width / 2, r: cx + width / 2, t: bottom - lift - size * 1.15, b: bottom - lift};
          var clash = false;
          for (var i = 0; i < placed.length && !clash; i++) {
            var o = placed[i];
            clash = candidate.l < o.r - 1 && o.l < candidate.r - 1 && candidate.t < o.b - 1 && o.t < candidate.b - 1;
          }
          if (!clash) { box = candidate; bottom -= lift; }
        }
        if (!box) { dropped++; return; }
        placed.push(box);
        var el = pool[used];
        if (!el) {
          el = doc.createElement('div');
          el.className = 'l';
          layer.appendChild(el);
          pool.push(el);
        }
        used++;
        el.textContent = text;
        el.style.display = '';
        el.style.fontSize = size + 'px';
        el.style.color = style.color;
        el.style.fontFamily = style.family || '';
        el.style.fontWeight = style.weight || '';
        el.style.transform = 'translate(' + Math.round(cx) + 'px,' + Math.round(bottom) + 'px) translate(-50%,-100%)';
      };

      records.forEach(function(rec) {
        var node = rec.node;
        if (!node.isConnected) { removeRecord(rec); return; }
        var known = nodes.get(node);
        if (!known || known.text !== node.nodeValue) return; // text changed: the next scan redoes it
        var parent = node.parentElement;
        if (!parent) return;
        var info = parentCache.get(parent);
        if (!info) {
          var box = parent.getBoundingClientRect();
          var cs = win.getComputedStyle(parent);
          info = {
            visible: box.width > 0 && box.height > 0 && box.bottom > -40 && box.top < vh + 40 &&
              box.right > 0 && box.left < vw && cs.visibility !== 'hidden' && cs.display !== 'none',
            size: parseFloat(cs.fontSize) || 16,
            color: cs.color
          };
          parentCache.set(parent, info);
        }
        if (!info.visible || !rec.layers || !rec.layers.length) return;

        var range = doc.createRange();
        var rectOf = function(from, to) {
          range.setStart(node, from);
          range.setEnd(node, to);
          return range.getClientRects()[0];
        };
        var first = rectOf(rec.start, rec.end);
        if (!first || first.bottom < 0 || first.top > vh) return;

        var overOffset = 0;
        var underOffset = 0;
        rec.layers.forEach(function(item) {
          var size = Math.max(9, info.size * (item.scale || 0.55));
          var style = {color: item.color || info.color, family: item.family, weight: item.weight};
          item.pieces.forEach(function(piece) {
            var r = piece.from == null ? first : rectOf(piece.from, piece.to);
            if (!r) return;
            var cx = r.left + r.width / 2;
            if (item.under) put(piece.text, cx, r.bottom + underOffset + size * 1.15, size, style);
            else put(piece.text, cx, r.top - 1 - overOffset, size, style);
          });
          if (item.under) underOffset += size * 1.2;
          else overOffset += size * 1.2;
        });
      });
      for (var j = used; j < pool.length; j++) pool[j].style.display = 'none';
      lastStats = 'labels=' + used + ' records=' + records.size + ' dropped=' + dropped;
      if (options.onStats) options.onStats(lastStats);
    } catch (error) {
      console.warn('Zoopdog overlay: layout failed:', error && error.message);
    }
  }

  return {
    set: set,
    known: function(node) { return nodes.get(node); },
    clear: clear,
    schedule: schedule,
    setHidden: function(value) { hidden = !!value; schedule(); },
    onScroll: function() { schedule(); },
    size: function() { return records.size; }
  };
}
