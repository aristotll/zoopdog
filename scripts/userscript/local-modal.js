// A fragment of the -local popup build, moved out of popupdict-local.runtime.js verbatim.
// scripts/build-popupdict-userscript.js concatenates it (LOCAL_RUNTIME_SOURCES) inside the one IIFE of
// popupdict.runtime.js, so it shares that scope; nothing here is exported or imported.
// Holds: the selection-tools and entry-diff instances, toast and modal mechanics (geometry, open, close,
// drag, resize, dismiss), ZOO_MODAL_IDS, the form states and zooRenderLocalActions.
// Relies on shared-IIFE globals declared elsewhere:
// createZooSelectionTools, createZooEntryDiffRenderer, createZooModalGeometry (local-selection.js,
// local-entry-diff.js, local-modal-geometry.js), escapeHtml and zdCaretFromPoint (core runtime /
// zd-words.js) and ZOO_LOCAL_AVAILABLE (local-server.js).

  // Normalised here because a selection becomes the key of a saved Chu Nom entry: a decomposed
  // selection would be stored as a term no precomposed lookup can ever reach again.
  var zooSelectionTools = createZooSelectionTools({document: document, scanLimit: 5000,
    caretFromPoint: function(point) { return zdCaretFromPoint(point); },
    getSelection: function() { return window.getSelection(); }});
  function zooTrimSelectionPunctuation(value) { return zooSelectionTools.trim(value); }

  // -- entry-diff preview (draws the server's `diff`, like reader_entry_diff.js) --
  //
  // The server builds the rows (field labels, badges, the character-level narrowing --
  // scripts/entry_diff.py in book-translator) and every preview response carries them as
  // `diff`: {changed, rows}. This only draws segments, with textContent, so a stored value
  // can never inject markup.

  var zooRenderEntryDiff = createZooEntryDiffRenderer(document);

  // -- modal mechanics (mirrors shared/modal.js) --

  var ZOO_TOAST_VISIBLE_MS = 2400;
  var ZOO_TOAST_FADE_MS = 220;
  var zooToastTimer = null;
  var zooToastFadeTimer = null;

  // A short list of common two-label public suffixes (co.uk, com.au, ...) so
  // subdomains of the same site (www./m./old.example.com) share one saved
  // position instead of each getting their own. Not a full public-suffix
  // list -- good enough for grouping, not for security decisions.
  var ZOO_MULTI_LABEL_TLDS = [
    'co.uk', 'org.uk', 'gov.uk', 'ac.uk', 'me.uk',
    'co.jp', 'ne.jp', 'or.jp',
    'co.kr', 'co.in', 'co.nz', 'co.za',
    'com.au', 'net.au', 'org.au',
    'com.cn', 'net.cn', 'org.cn',
    'com.hk', 'com.tw', 'com.sg',
    'com.br', 'com.mx', 'com.ar'
  ];

  function zooRegistrableDomain(hostname) {
    if (!hostname || hostname === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(hostname)) return hostname;
    var labels = hostname.split('.');
    if (labels.length <= 2) return hostname;
    var lastTwo = labels.slice(-2).join('.');
    var lastThree = labels.slice(-3).join('.');
    return ZOO_MULTI_LABEL_TLDS.indexOf(lastTwo) !== -1 ? lastThree : lastTwo;
  }

  var zooModalGeometry = createZooModalGeometry({
    domain: function() { return zooRegistrableDomain(location.hostname); },
    viewport: function() { return {width: window.innerWidth, height: window.innerHeight}; },
    readPosition: function(key) { return typeof GM_getValue === 'function' ? GM_getValue(key, null) : null; },
    writePosition: function(key, value) { if (typeof GM_setValue === 'function') GM_setValue(key, value); },
    readSize: function(key) { return typeof GM_getValue === 'function' ? GM_getValue(key, null) : localStorage.getItem(key); },
    writeSize: function(key, value) {
      if (typeof GM_setValue === 'function') GM_setValue(key, value);
      else localStorage.setItem(key, value);
    }
  });
  function zooSaveModalPosition(id, left, top) { zooModalGeometry.savePosition(id, left, top); }
  function zooRestoreModalPosition(id, panel) { zooModalGeometry.restorePosition(id, panel); }
  function zooSaveModalSize(id, width, height) { zooModalGeometry.saveSize(id, width, height); }
  function zooRestoreModalSize(id, panel) { zooModalGeometry.restoreSize(id, panel); }

  // The native `resize: both` grip (class zd-modal-resizable); the size is saved on
  // pointer release only when the user changed it, so content growth is never frozen.
  function zooMakeModalResizable(modalId) {
    var panel = document.querySelector('#' + modalId + ' .zd-modal');
    if (!panel) return;
    panel.classList.add('zd-modal-resizable');
    var before = null;
    panel.addEventListener('pointerdown', function() {
      before = { width: panel.offsetWidth, height: panel.offsetHeight };
    });
    function release() {
      if (!before) return;
      var width = panel.offsetWidth, height = panel.offsetHeight;
      if (width !== before.width || height !== before.height) zooSaveModalSize(modalId, width, height);
      before = null;
    }
    panel.addEventListener('pointerup', release);
    panel.addEventListener('pointercancel', release);
    // A resize can end with the pointer outside the panel.
    document.addEventListener('pointerup', release);
  }

  function zooOpenModal(id) {
    var backdrop = document.getElementById(id);
    backdrop.hidden = false;
    var panel = backdrop.querySelector('.zd-modal');
    if (panel) {
      panel.scrollTop = 0;
      panel.removeAttribute('data-zd-dirty');
    }
    zooRestoreModalSize(id, panel);
    zooRestoreModalPosition(id, panel);
  }

  function zooCloseModal(id) {
    document.getElementById(id).hidden = true;
  }

  function zooSetModalStatus(id, message, isError) {
    var node = document.getElementById(id);
    if (!node) return;
    node.textContent = message || '';
    node.hidden = !message;
    if (isError) {
      node.classList.add('zd-error');
    } else {
      node.classList.remove('zd-error');
    }
  }

  function zooShowToast(message) {
    var toast = document.getElementById('zoopdog-toast');
    if (!toast) return;
    clearTimeout(zooToastTimer);
    clearTimeout(zooToastFadeTimer);
    toast.textContent = message;
    toast.hidden = false;
    void toast.offsetWidth;
    toast.classList.add('zd-visible');
    zooToastTimer = setTimeout(function() {
      toast.classList.remove('zd-visible');
      zooToastFadeTimer = setTimeout(function() { toast.hidden = true; }, ZOO_TOAST_FADE_MS);
    }, ZOO_TOAST_VISIBLE_MS);
  }

  function zooBindModalDismiss() {
    document.querySelectorAll('.zd-modal-backdrop').forEach(function(backdrop) {
      backdrop.querySelectorAll('[data-zd-modal-cancel]').forEach(function(button) {
        button.addEventListener('click', function() { zooCloseModal(backdrop.id); });
      });
    });
    document.addEventListener('keydown', function(event) {
      if (event.key !== 'Escape') return;
      document.querySelectorAll('.zd-modal-backdrop').forEach(function(backdrop) {
        if (!backdrop.hidden) zooCloseModal(backdrop.id);
      });
    });
    // The modals are click-through (pointer-events: none on the backdrop) so the
    // page stays usable beside them. A modal the user never typed into -- e.g.
    // opened from a mis-selected word -- closes when they press elsewhere on the
    // page; one with edits stays, so an errant click cannot discard typing.
    document.addEventListener('input', function(event) {
      var panel = event.target && event.target.closest && event.target.closest('.zd-modal');
      if (panel) panel.setAttribute('data-zd-dirty', '');
    }, true);
    document.addEventListener('mousedown', function(event) {
      if (event.target && event.target.closest && event.target.closest('.zd-modal, #zoopdog-userscript-selection-bar')) return;
      document.querySelectorAll('.zd-modal-backdrop').forEach(function(backdrop) {
        if (backdrop.hidden) return;
        var panel = backdrop.querySelector('.zd-modal');
        if (!panel || !panel.hasAttribute('data-zd-dirty')) zooCloseModal(backdrop.id);
      });
    }, true);
  }

  function zooMakeModalDraggable(modalId) {
    var panel = document.querySelector('#' + modalId + ' .zd-modal');
    if (!panel) return;
    var handle = panel.querySelector('h2');
    if (!handle) return;
    handle.classList.add('zd-modal-drag-handle');
    handle.title = 'Drag to move';
    var drag = null;

    handle.addEventListener('pointerdown', function(event) {
      var rect = panel.getBoundingClientRect();
      drag = { pointerId: event.pointerId, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top };
      panel.style.position = 'fixed';
      panel.style.margin = '0';
      panel.style.left = rect.left + 'px';
      panel.style.top = rect.top + 'px';
      if (handle.setPointerCapture) handle.setPointerCapture(event.pointerId);
      handle.classList.add('zd-dragging');
    });

    handle.addEventListener('pointermove', function(event) {
      if (!drag || event.pointerId !== drag.pointerId) return;
      var maxLeft = Math.max(window.innerWidth - panel.offsetWidth, 0);
      var maxTop = Math.max(window.innerHeight - panel.offsetHeight, 0);
      panel.style.left = Math.min(Math.max(event.clientX - drag.offsetX, 0), maxLeft) + 'px';
      panel.style.top = Math.min(Math.max(event.clientY - drag.offsetY, 0), maxTop) + 'px';
    });

    function endDrag(event) {
      if (!drag || event.pointerId !== drag.pointerId) return;
      if (handle.releasePointerCapture) handle.releasePointerCapture(event.pointerId);
      handle.classList.remove('zd-dragging');
      drag = null;
      zooSaveModalPosition(modalId, parseFloat(panel.style.left) || 0, parseFloat(panel.style.top) || 0);
    }
    handle.addEventListener('pointerup', endDrag);
    handle.addEventListener('pointercancel', endDrag);
  }

  // -- markup + wiring for the two modals --

  var ZOO_MODAL_IDS = {
    nom: {
      backdrop: 'zoopdog-nom-modal',
      form: 'zoopdog-nom-form',
      title: 'zoopdog-nom-modal-title',
      existingInfo: 'zoopdog-nom-existing-info',
      vi: 'zoopdog-nom-vi',
      nom: 'zoopdog-nom-nom',
      suggestions: 'zoopdog-nom-nom-suggestions',
      replaceRow: 'zoopdog-nom-replace-row',
      replace: 'zoopdog-nom-replace',
      explain: 'zoopdog-nom-explain',
      nomRefresh: 'zoopdog-nom-nom-refresh',
      viSearch: 'zoopdog-nom-vi-search',
      notesRefresh: 'zoopdog-nom-notes-refresh',
      notesClear: 'zoopdog-nom-notes-clear',
      notesStrip: 'zoopdog-nom-notes-strip',
      notesAll: 'zoopdog-nom-notes-all',
      notesAllList: 'zoopdog-nom-notes-all-list',
      diffPreview: 'zoopdog-nom-diff-preview',
      status: 'zoopdog-nom-form-status',
      saveBtn: 'zoopdog-nom-save-btn',
      confirmBtn: 'zoopdog-nom-confirm-update-btn'
    },
    order: {
      backdrop: 'zoopdog-nom-order-modal',
      form: 'zoopdog-nom-order-form',
      title: 'zoopdog-nom-order-modal-title',
      existingInfo: 'zoopdog-nom-order-existing-info',
      vi: 'zoopdog-nom-order-vi',
      words: 'zoopdog-nom-order-words',
      nom: 'zoopdog-nom-order-nom',
      suggestions: 'zoopdog-nom-order-suggestions',
      current: 'zoopdog-nom-order-current',
      caseSensitive: 'zoopdog-nom-order-case-sensitive',
      diffPreview: 'zoopdog-nom-order-diff-preview',
      status: 'zoopdog-nom-order-form-status',
      saveBtn: 'zoopdog-nom-order-save-btn',
      confirmBtn: 'zoopdog-nom-order-confirm-btn'
    },
    blacklist: {
      backdrop: 'zoopdog-explored-blacklist-modal',
      form: 'zoopdog-explored-blacklist-form',
      title: 'zoopdog-explored-blacklist-title',
      host: 'zoopdog-explored-blacklist-host',
      reason: 'zoopdog-explored-blacklist-reason',
      status: 'zoopdog-explored-blacklist-status',
      saveBtn: 'zoopdog-explored-blacklist-save-btn'
    }
  };

  var zooNomFormState = null;
  var zooOrderState = null;

  function zooRenderLocalActions(vn) {
    if (!ZOO_LOCAL_AVAILABLE) return '';
    var vi = escapeHtml(vn);
    return [
      '<div class="zd-local-actions">',
      '<button type="button" class="zd-local-btn" data-zd-action="add-nom" data-zd-vi="', vi, '">+ Add Ch\u1EEF N\u00F4m</button>',
      '<button type="button" class="zd-local-btn" data-zd-action="set-order" data-zd-vi="', vi, '">Set order</button>',
      '</div>'
    ].join('');
  }
