// Popup userscript: ResultPopup (the floating result box), its remembered pin position, the
// visible-viewport helpers, and the obstacle avoidance and placement of the box.
// A fragment, not a standalone script: scripts/build-popupdict-userscript.js concatenates it into
// the popup userscript's single IIFE (PUBLIC_RUNTIME_SOURCES), so it shares that scope. It relies
// on renderDefinition and zooSetHTML (popup-render.js) and the GM_getValue/GM_setValue grants.
// Moved verbatim out of popupdict.runtime.js; see docs/runtime-boundaries.md.

  function ResultPopup() {
    this.container = document.createElement('div');
    this.container.id = 'zoopdog-userscript-popup';
    this.container.addEventListener('mousedown', function(event) { event.stopPropagation(); });
    this.container.addEventListener('scroll', function(event) { event.stopPropagation(); });

    this.lockIcon = document.createElement('div');
    this.lockIcon.id = 'zoopdog-userscript-popup-lock-icon';
    this.lockIcon.textContent = '📌';

    this.body = document.createElement('div');
    this.body.id = 'zoopdog-userscript-popup-body';
    this.container.appendChild(this.lockIcon);
    this.container.appendChild(this.body);
    document.body.appendChild(this.container);
    this.locked = false;
    this.bindDrag();
  }

  var PIN_POSITION_KEY = 'zoopdog-popup-pin-position';

  function readPinPosition() {
    try {
      var raw = typeof GM_getValue === 'function'
        ? GM_getValue(PIN_POSITION_KEY, null)
        : window.localStorage.getItem(PIN_POSITION_KEY);
      var pos = raw ? JSON.parse(raw) : null;
      if (pos && isFinite(pos.left) && isFinite(pos.top)) return pos;
    } catch (error) { /* no stored position */ }
    return null;
  }

  function writePinPosition(pos) {
    var raw = JSON.stringify(pos);
    try {
      if (typeof GM_setValue === 'function') GM_setValue(PIN_POSITION_KEY, raw);
      else window.localStorage.setItem(PIN_POSITION_KEY, raw);
    } catch (error) { /* position just is not remembered */ }
  }

  // The part of the page actually on screen, in the coordinates a `position: fixed` box and
  // getBoundingClientRect() use (the layout viewport). On a phone these differ: a page without a
  // mobile viewport lays out ~980px wide, and pinch-zoom shows only a slice of that, so clamping
  // to `clientWidth`/`innerWidth` let the popup run off the right edge of the screen.
  function visibleViewport() {
    var vv = window.visualViewport;
    if (vv && vv.width > 0 && vv.height > 0) {
      return {left: vv.offsetLeft, top: vv.offsetTop, width: vv.width, height: vv.height};
    }
    return {
      left: 0,
      top: 0,
      width: document.documentElement.clientWidth || window.innerWidth,
      height: window.innerHeight
    };
  }

  function clampInto(value, min, max) {
    return Math.max(min, Math.min(value, max));
  }

  ResultPopup.prototype.moveTo = function(left, top) {
    var box = this.container.getBoundingClientRect();
    var view = visibleViewport();
    var style = this.container.style;
    style.left = clampInto(left, view.left, view.left + view.width - box.width) + 'px';
    style.top = clampInto(top, view.top, view.top + view.height - box.height) + 'px';
    style.bottom = 'auto';
  };

  // The pin icon is the drag handle while the popup is locked; the spot is remembered.
  ResultPopup.prototype.bindDrag = function() {
    var popup = this;
    this.lockIcon.addEventListener('mousedown', function(event) {
      if (!popup.locked || event.button !== 0) return;
      event.preventDefault();
      var box = popup.container.getBoundingClientRect();
      var dx = event.clientX - box.left;
      var dy = event.clientY - box.top;
      function onMove(moveEvent) {
        popup.moveTo(moveEvent.clientX - dx, moveEvent.clientY - dy);
      }
      function onUp() {
        document.removeEventListener('mousemove', onMove, true);
        document.removeEventListener('mouseup', onUp, true);
        var end = popup.container.getBoundingClientRect();
        writePinPosition({left: end.left, top: end.top});
      }
      document.addEventListener('mousemove', onMove, true);
      document.addEventListener('mouseup', onUp, true);
    });
  };

  ResultPopup.prototype.populate = function(results) {
    zooSetHTML(this.body, results.map(renderDefinition).join(''));
  };

  var OBSTACLE_MIN_SIZE = 20;
  var OBSTACLE_RECHECK_MS = [150, 450, 1000];

  // Rects of other extensions' / pages' floating boxes (dictionary popups, selection bubbles)
  // currently on screen, so the popup can be placed beside them instead of on top. Looks only at
  // top-level fixed/absolute elements and shadow hosts, and descends into them (and their shadow
  // roots) when the host itself is a zero-size or full-screen wrapper.
  function foreignObstacles(own, view) {
    var found = [];
    var viewArea = view.width * view.height;

    function visible(el) {
      var style = window.getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    }

    function collect(el, depth) {
      if (!el || el.nodeType !== Node.ELEMENT_NODE || !visible(el)) return;
      var tag = el.tagName;
      if (tag === 'STYLE' || tag === 'SCRIPT' || tag === 'LINK' || tag === 'TEMPLATE') return;
      var box = el.getBoundingClientRect();
      // Not filtered on `pointer-events`: 10ten's popup is click-through ("ghost") while it is
      // only displayed, and is still very much on screen.
      var big = box.width * box.height > viewArea * 0.8;
      if (!big && box.width >= OBSTACLE_MIN_SIZE && box.height >= OBSTACLE_MIN_SIZE) {
        found.push(box);
        return;
      }
      if (depth >= 3) return;
      var kids = el.shadowRoot ? el.shadowRoot.children : el.children;
      for (var i = 0; i < kids.length; i++) collect(kids[i], depth + 1);
    }

    [document.body, document.documentElement].forEach(function(root) {
      if (!root) return;
      for (var i = 0; i < root.children.length; i++) {
        var el = root.children[i];
        if (el === own || el.id === 'zoopdog-userscript-canvas' || el === document.body) continue;
        var position = window.getComputedStyle(el).position;
        if (position === 'fixed' || position === 'absolute' || el.shadowRoot ||
            el.getBoundingClientRect().height === 0) {
          collect(el, 0);
        }
      }
    });
    return found;
  }

  function overlapArea(a, b) {
    var w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    var h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    return w > 0 && h > 0 ? w * h : 0;
  }

  ResultPopup.prototype.show = function(rect) {
    var style = this.container.style;
    var margin = 8;
    var view = visibleViewport();
    var viewBottom = view.top + view.height;
    var below = viewBottom - rect.bottom - margin;
    var above = rect.top - view.top - margin;
    var placeAbove = below < 160 && above > below;
    var room = Math.max(80, placeAbove ? above : below);

    // Fit the popup to the visible area: cap its size, then clamp its position.
    style.maxWidth = Math.max(0, Math.min(400, view.width - 2 * margin)) + 'px';
    style.maxHeight = Math.min(Math.max(280, view.height * 0.5), room) + 'px';
    style.visibility = 'visible';

    this.place(rect, placeAbove);
    this.scheduleObstacleRecheck(rect, placeAbove);
  };

  // Another extension's popup often appears a beat after ours (it renders async), so look again.
  ResultPopup.prototype.scheduleObstacleRecheck = function(rect, placeAbove) {
    var popup = this;
    (this.recheckTimers || []).forEach(window.clearTimeout);
    this.recheckTimers = OBSTACLE_RECHECK_MS.map(function(ms) {
      return window.setTimeout(function() {
        if (popup.locked || popup.container.style.visibility !== 'visible') return;
        popup.place(rect, placeAbove);
      }, ms);
    });
  };

  // Places the popup below/above the word, or -- when that would cover another floating box --
  // beside the word or on the opposite side, whichever overlaps the others least.
  ResultPopup.prototype.place = function(rect, placeAbove) {
    var style = this.container.style;
    var margin = 8;
    var view = visibleViewport();
    var viewRight = view.left + view.width;
    var viewBottom = view.top + view.height;

    // A fixed box shrink-wraps to the space right of `left`, so measure its
    // natural width at the left edge before clamping.
    style.left = '0px';
    style.top = '0px';
    style.bottom = 'auto';
    var box = this.container.getBoundingClientRect();
    // The CSS `margin-top` offsets the box below its `top`.
    var offsetTop = box.top;
    var width = box.width;
    var height = box.height;
    var leftAligned = clampInto(rect.left - 20, view.left + margin, viewRight - width - margin);

    function candidate(left, visualTop) {
      var l = clampInto(left, view.left + margin, viewRight - width - margin);
      var t = clampInto(visualTop, view.top + margin, viewBottom - height - margin);
      return {left: l, top: t - offsetTop,
        box: {left: l, top: t, right: l + width, bottom: t + height}};
    }

    // Placed by `top` in both cases: a `bottom` offset is measured from the layout viewport's
    // bottom edge, which on a phone is not where the visible screen ends.
    var primary = {left: leftAligned,
      top: placeAbove ? rect.top - 4 - height - offsetTop : rect.bottom};
    primary.box = {left: primary.left, top: primary.top + offsetTop,
      right: primary.left + width, bottom: primary.top + offsetTop + height};
    var best = primary;

    var obstacles = foreignObstacles(this.container, view);
    if (obstacles.length) {
      var cost = function(c) {
        return obstacles.reduce(function(sum, o) { return sum + overlapArea(c.box, o); }, 0);
      };
      var alternatives = [
        candidate(leftAligned, placeAbove ? rect.bottom : rect.top - 4 - height),
        candidate(rect.right + margin, rect.top),
        candidate(rect.left - margin - width, rect.top)
      ];
      var bestCost = cost(primary);
      for (var i = 0; i < alternatives.length && bestCost > 0; i++) {
        var c = cost(alternatives[i]);
        if (c < bestCost) { best = alternatives[i]; bestCost = c; }
      }
    }

    style.left = best.left + 'px';
    style.top = best.top + 'px';
    this.shownView = view;

    // Last guard: whatever the page's CSS did to the box, pull it back on screen.
    box = this.container.getBoundingClientRect();
    if (box.right > viewRight - margin || box.left < view.left + margin) {
      style.left = clampInto(box.left, view.left + margin, viewRight - box.width - margin) + 'px';
    }
  };

  // True when the visible area moved or zoomed since the popup was placed, so its
  // on-screen position no longer matches the word.
  ResultPopup.prototype.viewChanged = function() {
    if (!this.shownView) return false;
    var now = visibleViewport();
    var was = this.shownView;
    return Math.abs(now.left - was.left) > 1 || Math.abs(now.top - was.top) > 1 ||
      Math.abs(now.width - was.width) > 1 || Math.abs(now.height - was.height) > 1;
  };

  ResultPopup.prototype.hide = function() {
    if (this.locked) {
      return true;
    }
    this.container.style.visibility = 'hidden';
  };

  ResultPopup.prototype.toggleLock = function() {
    if (this.locked) {
      this.locked = false;
      this.lockIcon.style.visibility = 'hidden';
      this.hide();
    } else if (this.container.style.visibility === 'visible') {
      this.locked = true;
      this.lockIcon.style.visibility = 'visible';
      var pos = readPinPosition();
      if (pos) this.moveTo(pos.left, pos.top);
    }
  };
