// Popup userscript: the Highlighter, the fixed full-viewport canvas that paints the looked-up
// word.
// A fragment, not a standalone script: scripts/build-popupdict-userscript.js concatenates it into
// the popup userscript's single IIFE (PUBLIC_RUNTIME_SOURCES), so it shares that scope. It relies
// on zdContainerBoundary, zdIsWordChar and zdNextTextNode (zd-words.js). Moved verbatim out of
// popupdict.runtime.js; see docs/runtime-boundaries.md.

  function Highlighter() {
    this.highlights = [];
    this.padding = 5;
    this.locked = false;
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'zoopdog-userscript-canvas';
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.position = 'fixed';
    this.canvas.style.left = 0;
    this.canvas.style.top = '1px';
    this.canvas.style.zIndex = 2147483645;
    this.canvas.style.pointerEvents = 'none';
    document.body.appendChild(this.canvas);
    this.context = this.canvas.getContext('2d');
    this.resize();
  }

  Highlighter.prototype.resize = function() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
  };

  Highlighter.prototype.on = function(node, begin, howManyWords) {
    if (this.highlights.length) {
      this.off();
    }
    if (node === undefined) {
      return true;
    }
    // Remembered so the window-level scroll listener can tell "the article
    // scrolled, this highlight is stale" from "some unrelated widget on the
    // page fired a scroll event" -- see that listener below.
    this.node = node;
    this.begin = begin;

    var boundary = zdContainerBoundary(node);
    var ranges = [];
    var words = 0;
    var prevChar = '';
    var curNode = node;
    var curBegin = begin;

    // A match can straddle more than one <ruby>-wrapped word (see zd-words.js), so keep
    // building ranges into whatever text node follows once this one runs out, rather than
    // stopping at this node's own end.
    while (curNode && words < howManyWords) {
      var data = curNode.data;
      var i;
      for (i = curBegin; i < data.length; i++) {
        if (/\s/.test(data[i])) {
          if (prevChar && zdIsWordChar(prevChar)) {
            words++;
          }
        } else if (!zdIsWordChar(data[i])) {
          break;
        }

        if (words === howManyWords) {
          break;
        }

        prevChar = data[i];
      }

      if (i === curBegin) {
        break;
      }

      var rangeBegin = curBegin;
      if (/\s/.test(data[rangeBegin])) {
        rangeBegin++;
      }
      if (rangeBegin < i) {
        var range = new Range();
        range.setStart(curNode, rangeBegin);
        range.setEnd(curNode, i);
        ranges.push(range);
      }

      if (words >= howManyWords || i < data.length) {
        break;
      }

      var nextNode = zdNextTextNode(curNode, boundary);
      if (!nextNode) {
        break;
      }
      if (prevChar && zdIsWordChar(prevChar)) {
        // The node boundary itself stands in for the space between words.
        words++;
        prevChar = '';
        if (words === howManyWords) {
          break;
        }
      }
      curNode = nextNode;
      curBegin = 0;
    }

    if (!ranges.length) {
      return true;
    }

    this.highlights = ranges.reduce(function(rects, range) {
      return rects.concat(Array.from(range.getClientRects()));
    }, []);

    this.context.beginPath();
    for (var j = 0; j < this.highlights.length; j++) {
      var hl = this.highlights[j];
      this.context.rect(
        hl.left - this.padding,
        hl.top - this.padding,
        hl.width + (this.padding * 2),
        hl.height + (this.padding * 2)
      );
      this.context.globalAlpha = 0.25;
      this.context.fillStyle = '#B6638F';
      this.context.fill();
    }
  };

  Highlighter.prototype.off = function() {
    if (this.locked) {
      return true;
    }
    this.context.beginPath();
    this.context.setTransform(1, 0, 0, 1, 0, 0);
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.context.globalAlpha = 0;
    this.highlights = [];
    this.node = null;
  };

  Highlighter.prototype.toggleLock = function() {
    if (this.locked) {
      this.locked = false;
      this.off();
    } else if (this.highlights.length) {
      this.locked = true;
    }
  };
