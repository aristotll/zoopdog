// Popup userscript: the offline Nom-review queue (flag a term, store it with GM_setValue), its
// export panel on the reader's /control page, and the floating selection bar that flags a term
// the dictionary does not have.
// A fragment, not a standalone script: scripts/build-popupdict-userscript.js concatenates it into
// the popup userscript's single IIFE (PUBLIC_RUNTIME_SOURCES), so it shares that scope. It relies
// on these names declared elsewhere in the build: createZooNomReviewStore (nom-review-store.js),
// zdContainerBoundary (zd-words.js), escapeHtml (popup-render.js), isExcludedTarget
// (popupdict.runtime.js), zooRenderLocalActions (-local build only, read behind typeof), and the
// GM_getValue/GM_setValue grants. Moved verbatim out of popupdict.runtime.js; see
// docs/runtime-boundaries.md.

  // Offline Nom-review queue -- see
  // docs/superpowers/specs/2026-09-23-offline-nom-review-queue-design.md. This runs in BOTH
  // builds but only does anything when zooRenderLocalActions is absent (the non-local build):
  // the -local build already has a real add-entry flow against the reader server and doesn't
  // need an offline queue. It needs no network grant -- flagging just writes to GM storage, and
  // exporting only ever runs as a same-origin fetch from the reader's own /control page.
  var ZOO_NOM_REVIEW_QUEUE_KEY = 'zoopdog_nom_review_queue';
  // A whole paragraph captured as "context" would bloat GM storage and the review file for no
  // benefit -- a reviewer needs enough surrounding text to judge the term's sense, not the
  // entire page. Matches book-translator's own MAX_CONTEXT_LENGTH in nom_review_queue.py.
  var ZOO_NOM_REVIEW_CONTEXT_MAX = 500;

  var ZOO_NOM_REVIEW_SENTENCE_END_RE = /[.!?\u3002\uFF01\uFF1F\n]/;

  // Character offset of (node, begin) inside `boundary`'s textContent, or -1 if `node` is not
  // one of its text nodes.
  function zooTextOffsetWithin(boundary, node, begin) {
    if (!node || node.nodeType !== 3 || typeof begin !== 'number') return -1;
    var walker = document.createTreeWalker(boundary, 4);
    var offset = 0;
    var cur;
    while ((cur = walker.nextNode())) {
      if (cur === node) return offset + begin;
      offset += cur.data.length;
    }
    return -1;
  }

  // The sentence the flagged term sits in, so a reviewer isn't judging a bare word later.
  // Anchored on the term's real position (the highlighter's text node + offset, else a search
  // for `term` in the block) -- never the start of the block, which drops the term whenever it
  // sits past the length cap in a long paragraph.
  function zooExtractNomReviewContext(node, term, begin) {
    if (!node || typeof zdContainerBoundary !== 'function') return '';
    var boundary = zdContainerBoundary(node);
    var full = boundary && boundary.textContent ? boundary.textContent : '';
    if (!full) return '';

    var pos = zooTextOffsetWithin(boundary, node, begin);
    if (pos < 0 && term) pos = full.toLowerCase().indexOf(String(term).toLowerCase());
    if (pos < 0) pos = 0;

    var termLength = term ? String(term).length : 1;
    var start = 0;
    for (var i = pos - 1; i >= 0; i--) {
      if (ZOO_NOM_REVIEW_SENTENCE_END_RE.test(full.charAt(i))) { start = i + 1; break; }
    }
    var end = full.length;
    for (var j = pos + termLength; j < full.length; j++) {
      if (ZOO_NOM_REVIEW_SENTENCE_END_RE.test(full.charAt(j))) { end = j + 1; break; }
    }

    var half = Math.floor(ZOO_NOM_REVIEW_CONTEXT_MAX / 2);
    if (end - start > ZOO_NOM_REVIEW_CONTEXT_MAX) {
      start = Math.max(start, pos - half);
      end = Math.min(end, Math.max(start + ZOO_NOM_REVIEW_CONTEXT_MAX, pos + termLength));
    }

    var text = full.slice(start, end).replace(/\s+/g, ' ').trim();
    return zooScrubLoneSurrogates(text.slice(0, ZOO_NOM_REVIEW_CONTEXT_MAX));
  }

  // Drops UTF-16 surrogates that are not part of a valid pair. slice() counts code units, so
  // cutting a context at 500 can split a character outside the BMP (rare CJK / Chu Nom
  // extension characters) and leave half of it. JSON.stringify happily sends that as "\ud863",
  // but the server decodes it into a string it cannot encode as UTF-8, and the whole export
  // dies with a connection failure. Applied when the context is cut and again at export time,
  // since entries queued before this fix may already hold one.
  function zooScrubLoneSurrogates(text) {
    var out = '';
    for (var i = 0; i < text.length; i++) {
      var code = text.charCodeAt(i);
      if (code >= 0xD800 && code <= 0xDBFF) {
        var next = text.charCodeAt(i + 1);
        if (next >= 0xDC00 && next <= 0xDFFF) {
          out += text.charAt(i) + text.charAt(i + 1);
          i++;
        }
      } else if (code < 0xDC00 || code > 0xDFFF) {
        out += text.charAt(i);
      }
    }
    return out;
  }

  var zooNomReviewStore = createZooNomReviewStore({
    read: function() { return typeof GM_getValue === 'function' ? GM_getValue(ZOO_NOM_REVIEW_QUEUE_KEY, '[]') : '[]'; },
    write: function(value) { if (typeof GM_setValue === 'function') GM_setValue(ZOO_NOM_REVIEW_QUEUE_KEY, value); }
  });

  function zooReadNomReviewQueue() { return zooNomReviewStore.read(); }

  function zooWriteNomReviewQueue(entries) {
    zooNomReviewStore.write(entries);
  }

  function zooIsNomReviewQueued(vi) {
    return zooNomReviewStore.has(vi);
  }

  // Once queued, the button stays disabled for that term (never re-enabled by a timeout):
  // clicking it again would be a silent no-op against storage anyway (queue() dedupes), and a
  // button that looks clickable but does nothing is worse than one that honestly can't be
  // pressed. It re-renders enabled again only if the term is later exported/cleared from the
  // queue and this popup is reopened.
  function zooQueueNomReview(vi, context, button) {
    if (!zooNomReviewStore.add({ vi: vi, context: context || '', ts: Date.now() })) return;
    if (button) {
      button.textContent = 'Đã đánh dấu ✓';
      button.disabled = true;
    }
  }

  function zooRenderNomReviewAction(vn) {
    var queued = zooIsNomReviewQueued(vn);
    return '<button type="button" class="zd-action-btn" data-zd-action="queue-nom-review" data-zd-vi="' +
      escapeHtml(vn) + '"' + (queued ? ' disabled' : '') + '>' +
      (queued ? 'Đã đánh dấu ✓' : '+ Đánh dấu Nôm') + '</button>';
  }

  // True only on the reader's own phone-remote page (scripts/reader/static/control.html in
  // book-translator), reachable either on the machine running it or from another device on the
  // same LAN, by IP or by its Bonjour name (MacBook-Air-cua-cheng.local). Being on that exact page
  // already proves the server answered -- no separate reachability probe is needed the way zooProbeLocalMode needs one for arbitrary pages.
  function zooOnReaderControlPage() {
    if (!window.location || window.location.pathname !== '/control') return false;
    var host = window.location.hostname || '';
    return host === '127.0.0.1' || host === 'localhost' ||
      /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.local$/.test(host) ||
      /^192\.168\.\d{1,3}\.\d{1,3}$/.test(host) ||
      /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(host);
  }

  function zooRenderNomReviewExportPanel(queue) {
    var panel = document.createElement('section');
    panel.id = 'zoopdog-nom-review-export';
    panel.style.cssText = 'background:#1f1f24;border:1px solid #33333b;border-radius:1rem;' +
      'padding:1rem;margin:1rem auto;max-width:30rem;display:grid;gap:0.75rem;' +
      'color:#f2f2f5;font:1.15rem/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;';

    var heading = document.createElement('h1');
    heading.style.cssText = 'margin:0;font-size:0.95rem;font-weight:600;letter-spacing:0.08em;' +
      'text-transform:uppercase;color:#9a9aa3;';
    heading.textContent = 'Hàng đợi Nôm cần review';
    panel.appendChild(heading);

    var list = document.createElement('ul');
    list.style.cssText = 'margin:0;padding-left:1.25rem;';
    queue.forEach(function(entry) {
      var item = document.createElement('li');
      item.textContent = entry.vi;
      if (entry.context) {
        var contextLine = document.createElement('div');
        contextLine.style.cssText = 'color:#9a9aa3;font-size:0.9rem;';
        contextLine.textContent = entry.context;
        item.appendChild(contextLine);
      }
      list.appendChild(item);
    });
    panel.appendChild(list);

    var error = document.createElement('p');
    error.style.cssText = 'margin:0;color:#ff6b6b;font-size:1rem;display:none;';
    panel.appendChild(error);

    var button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Export ' + queue.length + ' từ';
    button.style.cssText = 'min-height:3rem;font:inherit;font-size:1.1rem;color:#f2f2f5;' +
      'background:#2b2b33;border:1px solid #33333b;border-radius:0.75rem;cursor:pointer;';
    button.addEventListener('click', function() {
      button.disabled = true;
      error.style.display = 'none';
      var words = queue.map(function(entry) { return entry.vi; });
      var entries = queue.map(function(entry) {
        return {
          word: zooScrubLoneSurrogates(String(entry.vi || '')),
          context: zooScrubLoneSurrogates(String(entry.context || ''))
        };
      });
      // The whole queue rides in the POST body, same JSON array the older query-string form
      // carried: a queue of sentence-length contexts overflows a URL and the server answers 414.
      // (The server still accepts the old `entries=` / `words=` query forms for older installs.)
      var url = window.location.origin + '/v1/nom/entries/import';
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entries)
      }).then(function(response) {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.json().catch(function() { return {}; });
      }).then(function() {
        zooWriteNomReviewQueue(zooReadNomReviewQueue().filter(function(entry) {
          return words.indexOf(entry.vi) === -1;
        }));
        panel.remove();
      }).catch(function(err) {
        error.textContent = 'Export thất bại: ' + err.message;
        error.style.display = 'block';
        button.disabled = false;
      });
    });
    panel.appendChild(button);

    document.body.appendChild(panel);
  }

  function zooMaybeRenderNomReviewExportPanel() {
    if (typeof zooRenderLocalActions === 'function') return;
    if (!zooOnReaderControlPage()) return;
    var queue = zooReadNomReviewQueue();
    if (!queue.length) return;
    zooRenderNomReviewExportPanel(queue);
  }

  // A hovered/selected term the dictionary recognizes gets its flag button from
  // zooRenderNomReviewAction, inside the lookup popup -- but that popup only ever appears for a
  // term already in ZOO_DICTIONARY. Most of what is worth flagging for a Chữ Nôm entry is
  // exactly the opposite: a term the dictionary does NOT have yet, so no popup ever shows and
  // there is nothing to click. This selection bar covers that gap by reacting to the browser's
  // own native text selection instead of a dictionary hit -- select any short span (a word or a
  // short phrase, not a dictionary lookup) and a small floating button appears next to it.
  //
  // This also is the only way to flag anything at all on mobile Safari: selecting text there
  // hands the whole gesture to the OS's own callout (Copy/Look Up/...), which a userscript
  // cannot add a custom item to, and it never fires 'contextmenu' or 'mousedown' the way a
  // desktop selection does. What it does still fire, on both platforms, is 'selectionchange' as
  // the selection is made and 'touchend'/'mouseup' once the gesture ends -- so this bar is
  // positioned from the selection's own bounding rect and shown from those events, entirely
  // independent of whatever the OS callout is doing on top of it.
  var ZOO_NOM_REVIEW_SELECTION_MAX_CHARS = 60;
  var ZOO_NOM_REVIEW_SELECTION_MAX_WORDS = 8;
  var ZOO_NOM_REVIEW_SELECTION_MAX_NODES = 200;
  var zooNomReviewSelectionBarEl = null;
  // While a press on the bar is in flight, selectionchange must not hide it -- see
  // zooEnsureNomReviewSelectionBar.
  var zooNomReviewBarPressedUntil = 0;
  // Text of the selection the user dismissed by clicking elsewhere (a dictionary lookup click).
  // A page can keep the selection alive through such a click; without this the mouseup handler
  // would re-show the bar for that same still-selected text.
  var zooNomReviewDismissedText = '';
  var zooNomReviewCurrentText = '';
  var zooNomReviewCollapsed = false;

  // Whether `range` covers more than `max` characters, decided by walking at most a few
  // hundred text nodes from the range start rather than calling selection.toString(): that
  // materializes the entire selected text, so an accidental select-all on a long page (a
  // million-plus characters) cost tens of ms per selectionchange/mouseup/touchend, on the main
  // thread, before the length limit was ever looked at -- which is what made the page hang.
  function zooNomReviewSelectionTooLong(range, max) {
    var start = range.startContainer;
    var end = range.endContainer;
    if (start === end && start.nodeType === 3) {
      return (range.endOffset - range.startOffset) > max;
    }
    var walker = document.createTreeWalker(range.commonAncestorContainer, NodeFilter.SHOW_ALL);
    var first = start.nodeType === 3 ? start : (start.childNodes[range.startOffset] || start);
    walker.currentNode = first;
    var node = first;
    var total = 0;
    var visited = 0;
    while (node && range.intersectsNode(node)) {
      if (++visited > ZOO_NOM_REVIEW_SELECTION_MAX_NODES) return true;
      if (node.nodeType !== 3) { node = walker.nextNode(); continue; }
      var from = node === start ? range.startOffset : 0;
      var to = node === end ? range.endOffset : node.data.length;
      total += Math.max(0, to - from);
      if (total > max) return true;
      node = walker.nextNode();
    }
    return false;
  }

  // Named distinctly from the -local build's own zooTrimSelectionPunctuation/zooDebounce
  // (scripts/userscript/popupdict-local.runtime.js): both files share one IIFE in the -local
  // build, and this selection bar never runs there anyway (see the guard in
  // zooWireNomReviewSelectionBar below), so a name collision would just be confusing to read.
  function zooTrimNomReviewSelection(value) {
    return String(value || '').trim().replace(/\p{Cf}/gu, '')
      .replace(/^\p{P}+|\p{P}+$/gu, '').trim().normalize('NFC');
  }

  function zooNomReviewDebounce(fn, wait) {
    var timer = null;
    var wrapped = function() {
      var args = arguments;
      clearTimeout(timer);
      timer = setTimeout(function() { fn.apply(null, args); }, wait);
    };
    wrapped.cancel = function() { clearTimeout(timer); };
    return wrapped;
  }

  function zooEnsureNomReviewSelectionBar() {
    if (zooNomReviewSelectionBarEl) return zooNomReviewSelectionBarEl;
    var bar = document.createElement('div');
    bar.id = 'zoopdog-nom-review-selection-bar';
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Đánh dấu Nôm');
    bar.setAttribute('translate', 'no');
    bar.style.cssText = 'position:fixed;z-index:2147483647;display:none;' +
      'background:#1f1f24;border:1px solid #33333b;border-radius:0.5rem;padding:0.25rem;' +
      'box-shadow:0 2px 8px rgba(0,0,0,0.4);';
    // mousedown, not click: a native text selection collapses on mousedown over a non-text
    // control, which would otherwise clear the selection (and the bar with it, via the next
    // selectionchange) before the click this button is waiting for ever fires.
    bar.addEventListener('mousedown', function(event) { event.stopPropagation(); });
    // Pressing the bar collapses the page selection, which fires selectionchange; the debounced
    // handler then sees "nothing selected" and hides the bar. On a responsive page the click
    // lands inside the 180ms debounce, but on a laggy one (right after a heavy selection) the
    // timer fires first and removes the button out from under the click, so the tap does
    // nothing. Marking the press keeps the bar alive until that click has had time to arrive.
    function markPressed() { zooNomReviewBarPressedUntil = Date.now() + 1500; }
    bar.addEventListener('touchstart', markPressed, {passive: true});
    bar.addEventListener('pointerdown', markPressed);
    document.body.appendChild(bar);
    zooNomReviewSelectionBarEl = bar;
    return bar;
  }

  function zooHideNomReviewSelectionBar(force) {
    if (!force && Date.now() < zooNomReviewBarPressedUntil) return;
    if (zooNomReviewSelectionBarEl) zooNomReviewSelectionBarEl.style.display = 'none';
  }

  function zooDismissNomReviewSelection() {
    zooNomReviewDismissedText = zooNomReviewCurrentText;
    zooNomReviewBarPressedUntil = 0;
    zooHideNomReviewSelectionBar(true);
    // Explicit close also releases accidental native selection, including select-all.
    try { var selection = window.getSelection(); if (selection) selection.removeAllRanges(); } catch (e) {}
  }

  function zooPositionNomReviewBar(rect) {
    var bar = zooNomReviewSelectionBarEl;
    if (!bar || bar.style.display === 'none') return;
    var view = window.visualViewport;
    var left = view ? view.offsetLeft : 0;
    var top = view ? view.offsetTop : 0;
    var width = view ? view.width : window.innerWidth;
    var height = view ? view.height : window.innerHeight;
    bar.style.maxWidth = Math.max(0, width - 16) + 'px';
    var box = bar.getBoundingClientRect();
    bar.style.left = Math.max(left + 8, Math.min(rect.left, left + width - box.width - 8)) + 'px';
    var y = rect.top - box.height - 12;
    if (y < top + 8) y = rect.bottom + 12;
    bar.style.top = Math.max(top + 8, Math.min(y, top + height - box.height - 8)) + 'px';
  }

  function zooShowNomReviewSelectionBar(rect, text, contextNode) {
    var bar = zooEnsureNomReviewSelectionBar();
    // Do not detach the control under a finger or recreate it for the same selection.
    if (bar.style.display !== 'none' && zooNomReviewCurrentText === text) {
      zooPositionNomReviewBar(rect);
      return;
    }
    zooNomReviewCurrentText = text;
    bar.textContent = '';
    function control(label, title, action) {
      var el = document.createElement('button');
      el.type = 'button'; el.textContent = label;
      el.title = title; el.setAttribute('aria-label', title);
      el.addEventListener('click', function(event) {
        event.preventDefault(); event.stopPropagation(); action(el);
      });
      bar.appendChild(el);
      return el;
    }
    var queued = zooIsNomReviewQueued(text);
    var button = control(queued ? 'Đã đánh dấu ✓' : '+ Đánh dấu Nôm: ' + text,
      'Đánh dấu Nôm: ' + text, function(el) {
        try {
          // Never read an unbounded ancestor paragraph to capture context.
          var context = contextNode && contextNode.nodeType === 3
            ? contextNode.data.slice(0, ZOO_NOM_REVIEW_CONTEXT_MAX) : text;
          zooQueueNomReview(text, context);
          el.textContent = 'Đã đánh dấu ✓'; el.disabled = true;
          zooNomReviewBarPressedUntil = 0;
          window.setTimeout(function() {
            if (zooNomReviewCurrentText === text) zooDismissNomReviewSelection();
          }, 700);
        } catch (error) {
          el.textContent = 'Lưu lỗi — chạm để thử lại';
          el.disabled = false;
        }
      });
    button.className = 'zd-review-save'; button.disabled = queued;
    var toggle = control(zooNomReviewCollapsed ? '＋' : '−', 'Thu gọn / mở rộng', function(el) {
      zooNomReviewCollapsed = !zooNomReviewCollapsed;
      bar.setAttribute('data-collapsed', String(zooNomReviewCollapsed));
      el.textContent = zooNomReviewCollapsed ? '＋' : '−';
      el.setAttribute('aria-expanded', String(!zooNomReviewCollapsed));
      zooPositionNomReviewBar(rect);
    });
    toggle.setAttribute('aria-expanded', String(!zooNomReviewCollapsed));
    control('×', 'Đóng và bỏ chọn', zooDismissNomReviewSelection);
    bar.setAttribute('data-collapsed', String(zooNomReviewCollapsed));
    bar.style.display = 'flex';
    zooPositionNomReviewBar(rect);
  }

  function zooHandleNomReviewSelectionChange() {
    // Defensive, same reasoning as the -local selection bar: this runs on arbitrary
    // third-party pages that may carry other scripts/extensions mutating the DOM around the
    // same selection mid-gesture.
    if (Date.now() < zooNomReviewBarPressedUntil) return;
    try {
      var selection = window.getSelection ? window.getSelection() : null;
      if (!selection || selection.rangeCount !== 1 || selection.isCollapsed) {
        zooHideNomReviewSelectionBar();
        return;
      }
      var anchorNode = selection.anchorNode;
      if (anchorNode && anchorNode.nodeType !== Node.ELEMENT_NODE) anchorNode = anchorNode.parentElement;
      if (isExcludedTarget(anchorNode)) {
        zooHideNomReviewSelectionBar();
        return;
      }
      var range = selection.getRangeAt(0);
      // Cheap bounded check first; only a selection already known to be short is ever turned
      // into a string, so a runaway selection costs a few hundred node visits at most.
      if (zooNomReviewSelectionTooLong(range, ZOO_NOM_REVIEW_SELECTION_MAX_CHARS * 2)) {
        zooHideNomReviewSelectionBar();
        return;
      }
      var text = zooTrimNomReviewSelection(selection.toString());
      if (!text || text.length > ZOO_NOM_REVIEW_SELECTION_MAX_CHARS ||
          text.split(/\s+/).length > ZOO_NOM_REVIEW_SELECTION_MAX_WORDS) {
        zooHideNomReviewSelectionBar();
        return;
      }
      if (text === zooNomReviewDismissedText) {
        zooHideNomReviewSelectionBar();
        return;
      }
      zooNomReviewDismissedText = '';
      var rect = range.getBoundingClientRect();
      if (!rect || (!rect.width && !rect.height)) {
        zooHideNomReviewSelectionBar();
        return;
      }
      zooShowNomReviewSelectionBar(rect, text, range.commonAncestorContainer);
    } catch (e) {
      zooHideNomReviewSelectionBar();
    }
  }

  function zooWireNomReviewSelectionBar() {
    // Non-local build only -- the -local build already has its own richer selection bar
    // (add/set-order straight against the reader server) wired by zooWireSelectionBar, and
    // showing a second, different one alongside it would just be confusing.
    if (typeof zooRenderLocalActions === 'function') return;
    var debounced = zooNomReviewDebounce(zooHandleNomReviewSelectionChange, 180);
    document.addEventListener('selectionchange', debounced);
    // Same reasoning as the -local build's own listener pair: the gesture's end event
    // (mouseup/touchend) fires once the selection is already final, so use it to show
    // immediately instead of waiting out the debounce -- and cancel the pending debounced call
    // so it doesn't re-render (and detach) the button a moment later. The debounced
    // 'selectionchange' listener stays as the path for selections that don't end with
    // mouseup/touchend, e.g. keyboard (Shift+Arrow) selection.
    function immediate(event) {
      if (event && event.target && event.target.closest &&
          event.target.closest('#zoopdog-nom-review-selection-bar')) {
        return;
      }
      debounced.cancel();
      zooHandleNomReviewSelectionChange();
    }
    document.addEventListener('mouseup', immediate);
    document.addEventListener('touchend', immediate);

    // A plain click (press + release without dragging) anywhere outside the bar -- e.g. on a
    // word to open the dictionary popup -- closes the bar, even if the page keeps the old
    // selection alive and no selectionchange follows.
    var pressPoint = null;
    function onPress(event) {
      if (event.target && event.target.closest &&
          event.target.closest('#zoopdog-nom-review-selection-bar')) {
        pressPoint = null;
        return;
      }
      pressPoint = {x: event.clientX, y: event.clientY};
    }
    function onRelease(event) {
      var start = pressPoint;
      pressPoint = null;
      if (!start || !zooNomReviewSelectionBarEl ||
          zooNomReviewSelectionBarEl.style.display === 'none') {
        return;
      }
      if (Math.abs(event.clientX - start.x) > 4 || Math.abs(event.clientY - start.y) > 4) return;
      zooNomReviewDismissedText = zooNomReviewCurrentText;
      debounced.cancel();
      zooNomReviewBarPressedUntil = 0;
      zooHideNomReviewSelectionBar(true);
    }
    document.addEventListener('mousedown', onPress, true);
    document.addEventListener('touchstart', function(e) {
      var t = e.touches && e.touches[0];
      if (t) onPress({target: e.target, clientX: t.clientX, clientY: t.clientY});
    }, {capture: true, passive: true});
    document.addEventListener('mouseup', onRelease, true);
    document.addEventListener('touchend', function(e) {
      var t = e.changedTouches && e.changedTouches[0];
      if (t) onRelease({clientX: t.clientX, clientY: t.clientY});
    }, {capture: true, passive: true});
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') { debounced.cancel(); zooDismissNomReviewSelection(); }
    });
    function hideOnViewportChange() {
      debounced.cancel(); zooNomReviewBarPressedUntil = 0; zooHideNomReviewSelectionBar(true);
    }
    window.addEventListener('scroll', hideOnViewportChange, {passive: true});
    window.addEventListener('resize', hideOnViewportChange);
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', hideOnViewportChange);
      window.visualViewport.addEventListener('scroll', hideOnViewportChange);
    }
  }
