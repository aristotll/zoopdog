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
  // What was last written to each pooled label (same index as `pool`) and to the host, so a layout
  // pass only touches the properties whose value changed, without reading styles back.
  var poolState = [];
  var hostDisplay = null;
  var scheduled = false;
  var scheduleId = 0;
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
      host.style.cssText = options.documentAnchored
        ? 'all:initial;position:absolute;top:0;left:0;width:0;height:0;overflow:visible;pointer-events:none;z-index:2147483645;'
        : 'all:initial;position:fixed;top:0;right:0;bottom:0;left:0;overflow:hidden;' +
          'pointer-events:none;z-index:2147483645;contain:strict;';
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
    var id = ++scheduleId;
    var run = function() { if (id === scheduleId) layout(); };
    // A hidden tab pauses animation frames; the timer keeps the labels current there too.
    if (win.requestAnimationFrame) win.requestAnimationFrame(run);
    win.setTimeout(run, 250);
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
      var display = hidden ? 'none' : '';
      if (hostDisplay !== display) {
        host.style.display = display;
        hostDisplay = display;
      }
      var vw = win.innerWidth;
      var vh = win.innerHeight;
      var parentCache = new Map();
      var placed = [];
      // Labels decided by this pass, in order. The pass reads (rects, computed styles) first and writes the
      // pooled labels afterwards: a read that follows a label write makes the browser bring style and layout up
      // to date again, which dominated scrolling on a long page (1.85 s of Range.getClientRects in 10 s).
      var drawn = [];
      var dropped = 0;
      // One Range serves the whole pass; it is made only once a record actually needs measuring.
      var range = null;
      var rectOf = function(node, from, to) {
        if (!range) range = doc.createRange();
        range.setStart(node, from);
        range.setEnd(node, to);
        return range.getClientRects()[0];
      };

      // `down` labels sit below their word, so a clash pushes them further down; lifting them would
      // push them back into the text they annotate (and into the next line's labels).
      var put = function(text, cx, bottom, size, style, down) {
        if (!text) return;
        // Wide (CJK/kana) glyphs are a full em, Latin about 0.55 em: a flat 0.5 em let neighbours overlap.
        var width = 0;
        for (var c = 0; c < text.length; c++) width += (text.charCodeAt(c) >= 0x2e80 ? 1 : 0.55) * size;
        var left = cx - width / 2;
        if (left < 0) cx += -left;
        if (left + width > vw) cx -= left + width - vw;
        var box = null;
        for (var level = 0; level < HAN_LIFT_LEVELS && !box; level++) {
          var lift = (down ? -level : level) * size * 1.15;
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
        var x = cx + (options.documentAnchored ? (win.scrollX || 0) : 0);
        var y = bottom + (options.documentAnchored ? (win.scrollY || 0) : 0);
        // Only decided here; written after every measurement is done (see `drawn` below).
        drawn.push({text: text, size: size, style: style, x: x, y: y});
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
          info = {visible: false};
          // The computed style is only needed for a parent that is on screen.
          if (box.width > 0 && box.height > 0 && box.bottom > -40 && box.top < vh + 40 &&
              box.right > 0 && box.left < vw) {
            var cs = win.getComputedStyle(parent);
            info.visible = cs.visibility !== 'hidden' && cs.display !== 'none';
            info.size = parseFloat(cs.fontSize) || 16;
            info.color = cs.color;
          }
          parentCache.set(parent, info);
        }
        if (!info.visible || !rec.layers || !rec.layers.length) return;

        var first = rectOf(node, rec.start, rec.end);
        if (!first || first.bottom < 0 || first.top > vh) return;

        var overOffset = 0;
        var underOffset = 0;
        rec.layers.forEach(function(item) {
          var size = Math.max(9, info.size * (item.scale || 0.55));
          var style = {color: item.color || info.color, family: item.family, weight: item.weight};
          item.pieces.forEach(function(piece) {
            var r = piece.from == null ? first : rectOf(node, piece.from, piece.to);
            if (!r) return;
            var cx = r.left + r.width / 2;
            if (item.under) put(piece.text, cx, r.bottom + underOffset + size * 1.15, size, style, true);
            else put(piece.text, cx, r.top - 1 - overOffset, size, style);
          });
          if (item.under) underOffset += size * 1.2;
          else overOffset += size * 1.2;
        });
      });
      var used = drawn.length;
      drawn.forEach(function(label, index) {
        var el = pool[index];
        if (!el) {
          el = doc.createElement('div');
          el.className = 'l';
          layer.appendChild(el);
          pool.push(el);
          poolState.push({});
        }
        var written = poolState[index];
        var text = label.text;
        var style = label.style;
        if (written.text !== text) { el.textContent = text; written.text = text; }
        if (written.display !== '') { el.style.display = ''; written.display = ''; }
        var fontSize = label.size + 'px';
        if (written.fontSize !== fontSize) { el.style.fontSize = fontSize; written.fontSize = fontSize; }
        if (written.color !== style.color) { el.style.color = style.color; written.color = style.color; }
        var family = style.family || '';
        if (written.family !== family) { el.style.fontFamily = family; written.family = family; }
        var weight = style.weight || '';
        if (written.weight !== weight) { el.style.fontWeight = weight; written.weight = weight; }
        var transform = 'translate(' + Math.round(label.x) + 'px,' + Math.round(label.y) + 'px) translate(-50%,-100%)';
        if (written.transform !== transform) { el.style.transform = transform; written.transform = transform; }
      });
      for (var j = used; j < pool.length; j++) {
        if (poolState[j].display !== 'none') {
          pool[j].style.display = 'none';
          poolState[j].display = 'none';
        }
      }
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
