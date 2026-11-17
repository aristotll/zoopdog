// A fragment of the -local popup build, moved out of popupdict-local.runtime.js verbatim.
// scripts/build-popupdict-userscript.js concatenates it (LOCAL_RUNTIME_SOURCES) inside the one IIFE of
// popupdict.runtime.js, so it shares that scope; nothing here is exported or imported.
// Holds: the floating selection toolbar -- its state, link-drag handling, selection reading and
// positioning, the read hotkey, and zooWireSelectionBar, which installs the listeners.
// Relies on shared-IIFE globals declared elsewhere:
// zooSelectionTools, zooTrimSelectionPunctuation, zooShowToast (local-modal.js), zooHttpRequest and
// ZOO_LOCAL_AVAILABLE (local-server.js), zooDebounce (local-requests.js), zooOpenNomModal and
// zooOpenNomOrderModal (local-nom-form.js, local-nom-order-form.js), isExcludedTarget and zooSetHTML
// (core runtime).

  // -- selection toolbar --
  //
  // The hover popup above only ever appears over text the dictionary
  // already recognizes (`lookupContext` requires a match), so there was no
  // way to seed "Add Chữ Nôm entry" with an arbitrary multi-word phrase --
  // the "Vietnamese term" field was editable, but nothing let a reader pick
  // several words off the page to start from. This listens for the
  // browser's own text selection (drag on desktop, long-press-drag on
  // mobile) and floats the same two actions beside it, seeded with
  // whatever was selected -- one, several, or a whole sentence's worth of
  // words -- independent of whether the dictionary has ever heard of it.

  var ZOO_SELECTION_MAX_CHARS = 120;
  var zooSelectionBar = null;
  // The node the shown bar's selection sits in, so the window-level scroll
  // listener below can tell "this scroll could have moved the bar" from "an
  // unrelated widget elsewhere on the page fired a scroll event" -- see that
  // listener for why this distinction matters.
  var zooSelectionAnchorNode = null;

  // Press-to-pointer distance, in px, before a press inside a link counts as
  // a drag rather than a click -- see the mousedown handler in
  // zooWireSelectionBar for why that gesture is run by hand at all.
  var ZOO_LINK_DRAG_SLOP = 3;
  var zooLinkDrag = null;
  var zooSwallowClickUntil = 0;

  // Resolved from the *caret* under the pointer, not from event.target: a
  // press on a word inside one of these link-wrapped rows reports the <a>
  // itself as the target (the same hit-test elementFromPoint gives), and the
  // <ruby> is a descendant of that, so `target.closest('ruby...')` -- which
  // only ever walks upwards -- never matches. The caret lands in the text
  // node itself, which does sit inside the <ruby>.
  function zooAnnotationInLinkAt(x, y) {
    return zooSelectionTools.annotationInLinkAt(x, y);
  }

  // `zdCaretFromPoint` rather than caretRangeFromPoint directly: it carries
  // the recovery for the points where Chromium resolves a caret to an element
  // boundary instead of a text node, which is most of them over <ruby> in a
  // tight row -- exactly the text this drag exists to select.
  function zooSelectBetweenPoints(from, to) {
    return zooSelectionTools.selectBetweenPoints(from, to);
  }

  function zooEnsureSelectionBar() {
    if (zooSelectionBar) return zooSelectionBar;
    var bar = document.createElement('div');
    bar.id = 'zoopdog-userscript-selection-bar';
    bar.className = 'zd-selection-bar';
    bar.hidden = true;
    bar.addEventListener('mousedown', function(event) { event.stopPropagation(); });
    document.body.appendChild(bar);
    zooSelectionBar = bar;
    return bar;
  }

  function zooHideSelectionBar() {
    if (zooSelectionBar) zooSelectionBar.hidden = true;
    zooSelectionAnchorNode = null;
  }

  // Reading a selection aloud (docs/local-mode.md): the text goes to the local TTS server, which
  // splits it by language, reads each part in its own configured voice, and queues it behind
  // whatever is already playing. Nothing is decided here -- the server answers with the finished
  // label ("vi → en") or the question to ask ("This selection is long ... anyway?").
  function zooReadSelection(text, confirmed) {
    var spoken = String(text || '').trim();
    if (!spoken) {
      zooShowToast('Select some text first');
      return Promise.resolve();
    }
    return zooHttpRequest('POST', '/v1/zoopdog/speak', null, JSON.stringify({text: spoken, confirm: !!confirmed}))
      .then(function(answer) {
        zooShowToast('\uD83D\uDD0A ' + (answer.label || 'queued'));
      })
      .catch(function(error) {
        var payload = error.payload || {};
        if (error.status === 409 && payload.status === 'confirm') {
          if (window.confirm(payload.message)) return zooReadSelection(spoken, true);
          return undefined;
        }
        zooShowToast(error.message || 'Could not reach the reader server');
        return undefined;
      });
  }

  function zooShowSelectionBar(rect, text, nomEligible) {
    var bar = zooEnsureSelectionBar();
    zooSetHTML(bar, [
      nomEligible ? '<button type="button" class="zd-local-btn" data-zd-action="add-nom">+ Add Chữ Nôm</button>' : '',
      nomEligible ? '<button type="button" class="zd-local-btn" data-zd-action="set-order">Set order</button>' : '',
      '<button type="button" class="zd-local-btn" data-zd-action="read" title="Read aloud (Alt+R)">\uD83D\uDD0A</button>'
    ].join(''));
    Array.prototype.forEach.call(bar.querySelectorAll('[data-zd-action]'), function(button) {
      button.addEventListener('click', function(event) {
        event.preventDefault();
        var action = button.getAttribute('data-zd-action');
        zooHideSelectionBar();
        if (action === 'read') {
          zooReadSelection(text);
        } else if (action === 'add-nom') {
          zooOpenNomModal(text);
        } else {
          zooOpenNomOrderModal(text);
        }
      });
    });
    bar.hidden = false;
    bar.style.left = Math.max(8, rect.left) + 'px';
    bar.style.top = Math.max(8, rect.top - 44) + 'px';
    var barRect = bar.getBoundingClientRect();
    if (barRect.right > window.innerWidth) {
      bar.style.left = Math.max(8, window.innerWidth - barRect.width - 8) + 'px';
    }
    if (rect.top - 44 < 0) {
      bar.style.top = (rect.bottom + 8) + 'px';
    }
  }

  function zooComposedSelection(selection, container) { return zooSelectionTools.composed(selection, container); }

  function zooHandleSelectionChange() {
    // Defensive: this runs on arbitrary third-party pages that may carry
    // other userscripts/extensions mutating the DOM around the same
    // selection (removing/replacing nodes mid-drag). An exception here would
    // otherwise leave the bar stuck in whatever state the last successful
    // call left it in -- silently "not showing" with no indication why.
    try {
      if (!ZOO_LOCAL_AVAILABLE) return;
      var selection = window.getSelection ? window.getSelection() : null;
      // Text inside a shadow root reports isCollapsed=true (the range is
      // collapsed on the host) while toString() still holds the selection, so
      // only an empty toString() counts as "nothing selected".
      if (!selection || selection.rangeCount === 0 ||
          (selection.isCollapsed && !selection.toString())) {
        zooHideSelectionBar();
        return;
      }
      var anchorNode = selection.anchorNode;
      if (anchorNode && anchorNode.nodeType !== Node.ELEMENT_NODE) anchorNode = anchorNode.parentElement;
      if (isExcludedTarget(anchorNode)) {
        zooHideSelectionBar();
        return;
      }
      var text = zooTrimSelectionPunctuation(zooSelectionTools.plainText(selection));
      if (!text) {
        zooHideSelectionBar();
        return;
      }
      var range = selection.getRangeAt(0);
      var rect = range.getBoundingClientRect();
      var anchorContainer = range.commonAncestorContainer;
      if (!rect || (!rect.width && !rect.height)) {
        // Text inside an open shadow root (e.g. Bilibili's <bili-comments>)
        // reports a range collapsed on the host with an empty rect. Only in
        // that empty-rect case ask for the composed range; every page that
        // already had a usable rect keeps the exact path above.
        var composed = zooComposedSelection(selection, anchorContainer);
        if (!composed) {
          zooHideSelectionBar();
          return;
        }
        rect = composed.rect;
        // toString() of a shadow-root selection also carries the <rt> Chu Nom
        // annotations (the page-level user-select:none rule does not reach
        // most shadow roots), so the term comes from the range minus those.
        text = zooTrimSelectionPunctuation(composed.text);
        if (!text) {
          zooHideSelectionBar();
          return;
        }
      }
      zooSelectionAnchorNode = anchorContainer;
      // A selection too long for a Chữ Nôm entry is still worth reading aloud.
      zooShowSelectionBar(rect, text, text.length <= ZOO_SELECTION_MAX_CHARS);
    } catch (error) {
      zooHideSelectionBar();
    }
  }

  // Alt+R reads the current selection. Matched by physical key (`code`), because on macOS
  // Option+R types a different character and `key` would never say "r".
  function zooHandleReadHotkey(event) {
    if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.code !== 'KeyR') return;
    var selection = window.getSelection ? window.getSelection() : null;
    var text = selection ? zooSelectionTools.plainText(selection) : '';
    if (!text.trim() && selection && selection.rangeCount) {
      var composed = zooComposedSelection(selection, selection.anchorNode);
      text = composed ? composed.text : '';
    }
    if (!text.trim()) return;
    event.preventDefault();
    zooReadSelection(text);
  }

  function zooWireSelectionBar() {
    // Copy-protection plugins can run after us (and re-arm on load), so clear them now and again later.
    zooSelectionTools.unblockSelection();
    window.addEventListener('load', zooSelectionTools.unblockSelection);
    document.addEventListener('mousedown', zooSelectionTools.unblockSelection, true);
    var debounced = zooDebounce(zooHandleSelectionChange, 180);
    document.addEventListener('selectionchange', debounced);
    // A mouse/touch drag fires 'selectionchange' repeatedly while it is in
    // progress, so the debounce above only settles ~180ms after the last one
    // -- and on a page busy running a pile of other userscripts/extensions,
    // the browser can delay that timer well past 180ms, which reads as "the
    // buttons are slow to show up". The gesture's own end event
    // (mouseup/touchend) fires once the selection is already final, so use
    // it to show immediately instead of waiting out the debounce; cancel the
    // pending debounced call so it doesn't re-render the bar (and detach the
    // buttons the user is about to click) a moment later. The debounced
    // 'selectionchange' listener stays as the path for selections that don't
    // end with mouseup/touchend, e.g. keyboard (Shift+Arrow) selection.
    function immediate(event) {
      // A mouseup/touchend *on the bar itself* -- e.g. releasing a click on
      // "+ Add Chữ Nôm" -- natively collapses the page's text selection
      // first (browsers clear selection on mousedown over a non-text
      // control such as a <button>). Re-running the handler here would then
      // see an empty selection and hide the bar before the 'click' event
      // that follows mouseup ever fires on it -- hiding a button out from
      // under its own click, so the action never runs. Only react to
      // mouseup/touchend elsewhere on the page.
      if (event && event.target && event.target.closest &&
          event.target.closest('#zoopdog-userscript-selection-bar')) {
        return;
      }
      debounced.cancel();
      zooHandleSelectionChange();
    }
    document.addEventListener('mouseup', immediate);
    document.addEventListener('touchend', immediate);
    // Capture-phase so a scroll inside a nested scrollable container is seen
    // too (those don't bubble a 'scroll' event to window). But capture also
    // means this sees a scroll from *any* scrollable element on the page --
    // including ones with nothing to do with the selected text, such as an
    // auto-scrolling news ticker/carousel (e.g. jQuery SimplyScroll's
    // `.simply-scroll-clip`) that fires its own 'scroll' event dozens of
    // times a second purely from its own animation. Reacting to those hid
    // the bar within tens of milliseconds of ever showing it, on any page
    // carrying such a widget -- selecting a word and never seeing the bar.
    // Only a scroll of the document itself, or of a container the selection
    // actually sits inside, can have moved the selection out from under it.
    window.addEventListener('scroll', function(event) {
      var target = event.target;
      if (target && target !== document && target !== window && target !== document.documentElement &&
          zooSelectionAnchorNode && !(typeof target.contains === 'function' && target.contains(zooSelectionAnchorNode))) {
        return;
      }
      zooHideSelectionBar();
    }, true);
    window.addEventListener('resize', zooHideSelectionBar);
    document.addEventListener('mousedown', function(event) {
      if (!zooSelectionBar || zooSelectionBar.hidden) return;
      if (event.target && event.target.closest && event.target.closest('#zoopdog-userscript-selection-bar')) return;
      zooHideSelectionBar();
    }, true);
    document.addEventListener('keydown', function(event) {
      if (event.key === 'Escape') zooHideSelectionBar();
      zooHandleReadHotkey(event);
    });
    // A word this script wrapped in <ruby> cannot be selected by mouse at all
    // when the page puts it inside a link -- Google's sitelink cards wrap a
    // whole row in one <a>, so there is no non-link pixel to start a drag
    // from. The browser classifies mousedown-then-move over an <a> as "drag
    // this link", never as a text selection, and the release lands as a click
    // that navigates away: "I can't select it, the page just jumps."
    //
    // Measured against a page with the same shape (link > ruby > word):
    // `draggable = false` on the link selects nothing *and* turns the drag
    // into a navigating click; cancelling `dragstart` selects nothing either,
    // because the gesture is classified before that event ever fires. So the
    // drag is run here instead -- cancel the native gesture at mousedown,
    // extend a Range from the press point to the pointer as it moves, and
    // swallow the click the release would otherwise fire.
    //
    // Only a press that starts on our own <ruby> inside a link is taken over,
    // so an ordinary click on that link still navigates, and selection
    // anywhere else on the page is untouched.
    document.addEventListener('mousedown', function(event) {
      if (event.button !== 0 || !zooAnnotationInLinkAt(event.clientX, event.clientY)) return;
      zooLinkDrag = {x: event.clientX, y: event.clientY, moved: false};
      event.preventDefault();
    }, true);
    document.addEventListener('mousemove', function(event) {
      if (!zooLinkDrag) return;
      if (Math.abs(event.clientX - zooLinkDrag.x) < ZOO_LINK_DRAG_SLOP &&
          Math.abs(event.clientY - zooLinkDrag.y) < ZOO_LINK_DRAG_SLOP) {
        return;
      }
      zooLinkDrag.moved = true;
      zooSelectBetweenPoints(zooLinkDrag, {x: event.clientX, y: event.clientY});
    }, true);
    document.addEventListener('mouseup', function() {
      if (!zooLinkDrag) return;
      // Only a press that actually moved swallows its click; a plain click
      // through the same annotation still follows the link. The deadline
      // keeps a press whose click never arrives from eating a later one.
      if (zooLinkDrag.moved) zooSwallowClickUntil = Date.now() + 400;
      zooLinkDrag = null;
    }, true);
    document.addEventListener('click', function(event) {
      if (Date.now() > zooSwallowClickUntil) return;
      zooSwallowClickUntil = 0;
      event.preventDefault();
      event.stopPropagation();
    }, true);
  }
