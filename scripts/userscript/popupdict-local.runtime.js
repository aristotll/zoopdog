// Local-mode extension for zoopdog-popupdict.user.js -- see docs/local-mode.md.
// Only concatenated into the -local build by scripts/build-popupdict-userscript.js
// (readRuntimeSources / LOCAL_SOURCE_FILES); the github-hosted build never inlines this.
// Declared inside the same IIFE as popupdict.runtime.js, so it shares that scope --
// core helpers like escapeHtml() and ZOO_DICTIONARY are visible here, and this file's
// zooRenderLocalActions/zooProbeLocalMode/zooWireSelectionBar are what the core file's
// typeof-guarded call sites pick up when present.

  // ---------------------------------------------------------------------
  // Local mode
  //
  // Talks to the book-translator reader server (scripts/reader/tts_server.py
  // in the book-translator repo) running on the user's own machine, so
  // "Add Ch\u1EEF N\u00F4m entry" / "Set Ch\u1EEF N\u00F4m order" write to the very same
  // user_nom_entries.jsonc / user_nom_order.jsonc the reader itself edits.
  // Every piece below mirrors the reader's own modals (reader_nom.js,
  // reader_nom_order.js, and the shared shared/entry_forms.js,
  // shared/suggest.js, shared/modal.js, reader_entry_diff.js) field for
  // field -- same suggestion lookups, same notes re-translate, same
  // preview -> confirm diff -- just re-hosted against GM_xmlhttpRequest
  // instead of same-origin fetch, since this popup runs on arbitrary
  // third-party pages. `book` is never sent: both endpoints already treat a
  // missing book as "the shared dictionary", which is the only thing that
  // makes sense from a page that isn't the reader.
  // ---------------------------------------------------------------------

  var ZOO_LOCAL_BASE = 'http://127.0.0.1:8770';
  var ZOO_LOCAL_AVAILABLE = false;
  var ZOO_LOCAL_REQUEST_TIMEOUT = 8000;

  function zooHttpRequest(method, path, params) {
    return new Promise(function(resolve, reject) {
      var settled = false;
      var watchdog = null;
      function settle(callback, value) {
        if (settled) return;
        settled = true;
        clearTimeout(watchdog);
        callback(value);
      }
      if (typeof GM_xmlhttpRequest !== 'function') {
        settle(reject, new Error('GM_xmlhttpRequest unavailable'));
        return;
      }
      var pairs = [];
      if (params) {
        Object.keys(params).forEach(function(key) {
          var value = params[key];
          if (value === undefined || value === null || value === '') return;
          pairs.push(encodeURIComponent(key) + '=' + encodeURIComponent(value));
        });
      }
      var query = pairs.join('&');
      var url = ZOO_LOCAL_BASE + path + (query ? (path.indexOf('?') === -1 ? '?' : '&') + query : '');
      watchdog = setTimeout(function() {
        settle(reject, new Error('request timed out'));
      }, ZOO_LOCAL_REQUEST_TIMEOUT + 25);
      try {
      GM_xmlhttpRequest({
        method: method,
        url: url,
        timeout: ZOO_LOCAL_REQUEST_TIMEOUT,
        onload: function(response) {
          var payload = {};
          try {
            payload = JSON.parse(response.responseText || '{}');
          } catch (parseError) {
            payload = {};
          }
          if (response.status >= 200 && response.status < 300) {
            settle(resolve, payload);
          } else {
            settle(reject, new Error(payload.error || ('request failed (' + response.status + ')')));
          }
        },
        onerror: function() { settle(reject, new Error('request failed')); },
        ontimeout: function() { settle(reject, new Error('request timed out')); }
      });
      } catch (error) {
        settle(reject, error);
      }
    });
  }

  function zooGetJSON(path, params) { return zooHttpRequest('GET', path, params); }
  function zooPost(path, params) { return zooHttpRequest('POST', path, params); }

  // The -local build only ever ships to a machine that is actively running
  // the book-translator reader server for local-mode development -- unlike
  // the github-hosted build, nobody installs it without that server. A
  // /healthz round trip before showing "+ Add Chữ Nôm" / "Set order" bought
  // nothing but startup latency and a permanent false negative if that one
  // probe was slow/unlucky (see git history), so this build assumes the
  // server is up rather than asking first. A real request that fails still
  // reports its own error normally (zooHttpRequest's onerror/ontimeout).
  function zooProbeLocalMode() {
    ZOO_LOCAL_AVAILABLE = true;
  }

  // -- suggestion / debounce / edit-tracking plumbing (mirrors shared/suggest.js) --

  function zooDebounce(fn, wait) {
    var timer = null;
    var wrapped = function() {
      var args = arguments;
      clearTimeout(timer);
      timer = setTimeout(function() { fn.apply(null, args); }, wait);
    };
    wrapped.cancel = function() { clearTimeout(timer); };
    return wrapped;
  }

  function zooCreateRaceGuard() {
    var latest = 0;
    return {
      begin: function() {
        var token = ++latest;
        return function() { return token === latest; };
      }
    };
  }

  function zooFetchSuggestions(kind, text) {
    if (!text) return Promise.resolve([]);
    return zooGetJSON('/v1/suggest', { kind: kind, text: text }).then(function(data) {
      return data.candidates || [];
    });
  }

  // Everything the Ch\u1EEF N\u00F4m modal shows for a term, decided by the server
  // (`/v1/nom/form`): candidates in the requested order, the prior entry, the modal title and
  // info text, and `next_order` -- the order the refresh button asks for next, so the toggle
  // between zoopdog order and the default ranking lives there and not here.
  function zooFetchNomForm(text, order) {
    var params = { vi: text };
    if (order) params.order = order;
    return zooGetJSON('/v1/nom/form', params).then(function(form) {
      if (!form || !Array.isArray(form.candidates)) throw new Error('bad /v1/nom/form answer');
      return form;
    });
  }

  function zooFetchNotesRefresh(kind, text, engineIndex) {
    if (!text) return Promise.resolve({ candidates: [], engine: '' });
    var params = { kind: kind, text: text, refresh: '1' };
    if (typeof engineIndex === 'number' && isFinite(engineIndex)) params.engine = String(engineIndex);
    return zooGetJSON('/v1/suggest', params).then(function(data) {
      return { candidates: data.candidates || [], engine: data.engine || '' };
    });
  }

  // Asks every refresh engine at once (`refresh=all`). The server answers with the
  // finished `rows` ({engines, text[, skipped]}), already grouped and folded; an engine
  // with no answer is in a trailing row with empty text.
  function zooFetchNotesAll(kind, text) {
    if (!text) return Promise.resolve([]);
    return zooGetJSON('/v1/suggest', { kind: kind, text: text, refresh: 'all' }).then(function(data) {
      return data.rows || [];
    });
  }

  // GM_setClipboard first (works on any page), then the async clipboard API,
  // then a hidden textarea + the legacy copy command for plain-HTTP pages.
  function zooCopyText(text) {
    if (typeof GM_setClipboard === 'function') {
      GM_setClipboard(text);
      return Promise.resolve();
    }
    function legacy() {
      var area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
      document.body.appendChild(area);
      area.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(area);
      return ok ? Promise.resolve() : Promise.reject(new Error('copy failed'));
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(legacy);
    }
    return legacy();
  }

  // Wires a "Refresh all" button: results are listed under the note as
  // "engines: translation" for reference, each with a Copy button. Returns
  // { run } so the modal that owns this button can also trigger it itself --
  // it auto-runs right after the modal opens (see zooOpenNomModal), without
  // making the modal's own show wait on it.
  function zooWireNotesAll(button, list, kind, getText, statusId) {
    function run() {
      var text = getText();
      if (!text || button.disabled) return;
      button.disabled = true;
      list.hidden = false;
      list.textContent = '';
      var pending = document.createElement('li');
      pending.textContent = 'Asking every engine...';
      list.appendChild(pending);
      zooFetchNotesAll(kind, text).then(function(rows) {
        if (!rows.length) rows = [{ engines: [], text: '' }];
        list.textContent = '';
        rows.forEach(function(row) {
          var li = document.createElement('li');
          var label = document.createElement('strong');
          label.textContent = row.engines.length ? row.engines.join(', ') + ': ' : '';
          li.appendChild(label);
          li.appendChild(document.createTextNode(row.text || (row.skipped ? '(skipped: limited quota)' : row.engines.length ? '(no answer)' : 'No engine answered.')));
          if (row.text) {
            var copy = document.createElement('button');
            copy.type = 'button';
            copy.className = 'zd-notes-all-copy';
            copy.title = 'Copy this translation';
            copy.textContent = 'Copy';
            copy.addEventListener('click', function() {
              zooCopyText(row.text).then(function() { copy.textContent = 'Copied'; }, function() { copy.textContent = 'Failed'; });
              setTimeout(function() { copy.textContent = 'Copy'; }, 1200);
            });
            li.appendChild(document.createTextNode(' '));
            li.appendChild(copy);
          }
          list.appendChild(li);
        });
      }, function() {
        list.textContent = '';
        zooSetModalStatus(statusId, zooLocalRequestRecoveryMessage(), true);
      }).then(function() {
        button.disabled = false;
      });
    }
    button.addEventListener('click', run);
    return { run: run };
  }

  // Drops punctuation from a machine-translated note. A hyphen or apostrophe
  // between two letters/digits ("don't", "well-known") is part of the word and
  // stays; every other punctuation mark (ASCII or CJK) is removed, and the
  // whitespace it leaves behind is collapsed.
  function zooStripPunctuation(text) {
    function isWordChar(ch) { return !!ch && /[\p{L}\p{N}]/u.test(ch); }
    return String(text)
      .replace(/\p{P}/gu, function(mark, offset, whole) {
        return (mark === "'" || mark === '\u2019' || mark === '-') &&
          isWordChar(whole[offset - 1]) && isWordChar(whole[offset + 1]) ? mark : ' ';
      })
      .replace(/\s+/g, ' ')
      .trim();
  }

  function zooNotesEngineMessage(engine, ok) {
    if (!engine) return ok ? 'Re-translated.' : 'Re-translate failed -- try again in a moment.';
    return ok
      ? 'Re-translated with ' + engine + '.'
      : engine + ': no answer -- click again to try the next engine.';
  }

  function zooCreateEngineRotator() {
    var index = 0;
    return function() { return index++; };
  }

  function zooTrackEdits(input) {
    var edited = false;
    input.addEventListener('input', function() { edited = true; });
    return {
      get edited() { return edited; },
      isEdited: function() { return edited; },
      reset: function() { edited = false; },
      mark: function() { edited = true; }
    };
  }

  function zooFillDatalist(id, candidates) {
    var datalist = document.getElementById(id);
    if (!datalist) return;
    var values = (candidates || []).map(String);
    datalist._containingCandidates = values;
    if (datalist.dataset.containingDatalist === 'true') {
      zooRenderContainingDatalist(datalist, values, datalist._containingInput.value);
      return;
    }
    datalist.textContent = '';
    values.forEach(function(value) {
      var option = document.createElement('option');
      option.value = value;
      datalist.appendChild(option);
    });
  }

  // Browser datalists match prefixes only. The authoring picker instead
  // matches anywhere in each Chữ Nôm rendering, so 𠊛 finds 𥪝𠊛.
  function zooFilterContainingSuggestions(candidates, query) {
    var needle = String(query || '');
    return (candidates || []).map(String).filter(function(candidate) {
      return !needle || candidate.indexOf(needle) !== -1;
    });
  }

  function zooRenderContainingDatalist(datalist, candidates, query) {
    var needle = String(query || '');
    var matches = zooFilterContainingSuggestions(candidates, query);
    datalist.textContent = '';
    matches.forEach(function(value) {
      var option = document.createElement('option');
      option.value = value;
      if (needle && value.indexOf(needle) !== 0) option.label = needle;
      datalist.appendChild(option);
    });
  }

  function zooWireContainingDatalist(input, datalist) {
    datalist.dataset.containingDatalist = 'true';
    datalist._containingInput = input;
    input.addEventListener('focus', function() {
      zooRenderContainingDatalist(datalist, datalist._containingCandidates || [], input.value);
    });
    input.addEventListener('input', function() {
      zooRenderContainingDatalist(datalist, datalist._containingCandidates || [], input.value);
    });
  }

  function zooSetAutofillDefault(input, value) {
    input.value = value;
    input.dataset.autofillDefault = value;
  }

  // zooWireDatalistAutoClear's focus handler only fires once, at the moment
  // the field is focused -- but suggestions arrive from an async fetch that
  // can resolve *after* that moment (the reader clicked in, and only then
  // did the network round-trip land). zooSetAutofillDefault still runs when
  // it resolves, refilling the field with a full candidate while it is
  // already focused, with no second 'focus' event to clear it again. The
  // field is then left sitting at a value that exactly equals its own first
  // datalist option, so the native dropdown -- opened before the data
  // arrived, or reopened without a fresh focus -- filters to that one match
  // (or shows nothing at all, if the browser cached an empty popup from
  // before the options existed). Regression: "cứu người" --
  // the field settled on "救人" post-fetch while focused, and the
  // datalist never got a chance to show its other 79 candidates (including
  // "救𠊛") until the input was blurred and refocused by
  // hand. Setting the default and immediately clearing it back out
  // (mirroring the focus handler's own condition) keeps the field blank
  // whenever the reader is actively looking at it, so the dropdown --
  // opened now or later -- always reflects the freshly-arrived, unfiltered
  // list; zooWireDatalistAutoClear's blur handler still restores the
  // default if nothing gets picked.
  function zooSetAutofillDefaultLive(input, value, isEdited) {
    zooSetAutofillDefault(input, value);
    if (document.activeElement === input && !isEdited()) input.value = '';
  }

  function zooClearNomGeneratedState(ids) {
    zooFillDatalist(ids.suggestions, []);
    var nomInput = document.getElementById(ids.nom);
    nomInput.value = '';
    delete nomInput.dataset.autofillDefault;
  }

  function zooLocalRequestRecoveryMessage() {
    return 'Unable to contact the local reader server. Reload the page and try again.';
  }

  function zooWireDatalistAutoClear(input, isEdited) {
    input.addEventListener('focus', function() {
      if (!isEdited() && input.value && input.value === input.dataset.autofillDefault) input.value = '';
    });
    input.addEventListener('blur', function() {
      if (!isEdited() && !input.value && input.dataset.autofillDefault) input.value = input.dataset.autofillDefault;
    });
  }

  function zooWirePickerAutoClear(input) {
    var valueBeforeFocus = '';
    input.addEventListener('focus', function() {
      valueBeforeFocus = input.value;
      if (input.value) input.value = '';
    });
    input.addEventListener('blur', function() {
      if (!input.value) input.value = valueBeforeFocus;
    });
  }

  // Normalised here because a selection becomes the key of a saved Chu Nom entry: a decomposed
  // selection would be stored as a term no precomposed lookup can ever reach again.
  function zooTrimSelectionPunctuation(value) {
    // Some pages (v2ex among them) embed invisible Unicode format characters
    // -- zero-width space U+200B chief among them -- inside long Vietnamese
    // phrases as a line-wrap hint. A mouse-drag selection picks those up
    // along with the visible text, and the resulting string never matches
    // any dictionary key: "kiến​thức" looks identical to "kiến thức" on screen
    // but is a different string, so every suggestion/entry/order lookup for
    // it silently comes back empty. Strip the whole Cf (Format) category --
    // not just zero-width space -- since the same invisible-hint trick shows
    // up as word joiners and directional marks too, and none of them belong
    // in a Chu Nom dictionary key either way.
    return String(value || '').trim().replace(/\p{Cf}/gu, '')
      .replace(/^\p{P}+|\p{P}+$/gu, '').trim().normalize('NFC');
  }

  // -- entry-diff preview (draws the server's `diff`, like reader_entry_diff.js) --
  //
  // The server builds the rows (field labels, badges, the character-level narrowing --
  // scripts/entry_diff.py in book-translator) and every preview response carries them as
  // `diff`: {changed, rows}. This only draws segments, with textContent, so a stored value
  // can never inject markup.

  function zooDiffEl(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function zooDiffLine(kind, mark, segments) {
    var line = zooDiffEl('div', 'zd-entry-diff-line zd-entry-diff-' + kind);
    var markEl = zooDiffEl('span', 'zd-entry-diff-mark', mark);
    markEl.setAttribute('aria-hidden', 'true');
    var text = zooDiffEl(kind === 'old' ? 'del' : 'ins');
    if (!segments.length) text.appendChild(zooDiffEl('span', 'zd-entry-diff-empty', '(empty)'));
    segments.forEach(function(segment) {
      text.appendChild(segment.changed ? zooDiffEl('mark', '', segment.text) : document.createTextNode(segment.text));
    });
    line.appendChild(markEl);
    line.appendChild(text);
    return line;
  }

  function zooEntryDiffRow(row) {
    var item = zooDiffEl('li', 'zd-entry-diff-row');
    var head = zooDiffEl('div', 'zd-entry-diff-field', row.field);
    if (row.badge) {
      var kind = row.badge === 'locked' || row.badge === 'new' ? ' zd-entry-diff-badge-' + row.badge : '';
      head.appendChild(zooDiffEl('span', 'zd-entry-diff-badge' + kind, row.badge));
    }
    item.appendChild(head);
    if (row.kind === 'change') {
      if (row.old) item.appendChild(zooDiffLine('old', '\u2212', row.old));
      item.appendChild(zooDiffLine('new', '+', row.new));
      return item;
    }
    item.className += row.kind === 'key' ? ' zd-entry-diff-key' : ' zd-entry-diff-context';
    var line = zooDiffEl('div', 'zd-entry-diff-line');
    var mark = zooDiffEl('span', 'zd-entry-diff-mark', '\u00B7');
    mark.setAttribute('aria-hidden', 'true');
    var value = zooDiffEl('span', row.kind === 'key' ? 'zd-entry-diff-keyterm' : '');
    if (row.value) value.textContent = row.value;
    else value.appendChild(zooDiffEl('span', 'zd-entry-diff-empty', '(empty)'));
    line.appendChild(mark);
    line.appendChild(value);
    item.appendChild(line);
    return item;
  }

  function zooScrollEntryDiffToHead(list) {
    list.scrollTop = 0;
    var modal = list.closest ? list.closest('.zd-modal') : null;
    if (!modal) return;
    modal.scrollTop = Math.max(0, list.offsetTop - 12);
  }

  // Returns the number of *changes* drawn; neither the key nor a context row is something to confirm.
  function zooRenderEntryDiff(list, diff) {
    list.textContent = '';
    var rows = diff && Array.isArray(diff.rows) ? diff.rows : [];
    rows.forEach(function(row) { list.appendChild(zooEntryDiffRow(row)); });
    list.hidden = !list.childElementCount;
    zooScrollEntryDiffToHead(list);
    return diff && diff.changed ? diff.changed : 0;
  }

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

  function zooModalPositionKey(modalId) {
    return 'zd-modal-pos:' + zooRegistrableDomain(location.hostname) + ':' + modalId;
  }

  function zooSaveModalPosition(modalId, left, top) {
    if (typeof GM_setValue !== 'function') return;
    GM_setValue(zooModalPositionKey(modalId), JSON.stringify({ left: left, top: top }));
  }

  // Applied on every open so a modal dragged once on a site keeps reopening
  // there, instead of the anchoring wherever its markup happens to land.
  function zooRestoreModalPosition(modalId, panel) {
    if (!panel || typeof GM_getValue !== 'function') return;
    var raw = GM_getValue(zooModalPositionKey(modalId), null);
    if (!raw) return;
    var pos;
    try { pos = JSON.parse(raw); } catch (e) { return; }
    if (!pos || typeof pos.left !== 'number' || typeof pos.top !== 'number') return;
    var maxLeft = Math.max(window.innerWidth - panel.offsetWidth, 0);
    var maxTop = Math.max(window.innerHeight - panel.offsetHeight, 0);
    panel.style.position = 'fixed';
    panel.style.margin = '0';
    panel.style.left = Math.min(Math.max(pos.left, 0), maxLeft) + 'px';
    panel.style.top = Math.min(Math.max(pos.top, 0), maxTop) + 'px';
  }

  function zooOpenModal(id) {
    var backdrop = document.getElementById(id);
    backdrop.hidden = false;
    var panel = backdrop.querySelector('.zd-modal');
    if (panel) {
      panel.scrollTop = 0;
      panel.removeAttribute('data-zd-dirty');
    }
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
    var caret = zdCaretFromPoint({x: x, y: y});
    var node = caret && caret.node;
    if (!node) return null;
    var element = node.nodeType === 1 ? node : node.parentElement;
    if (!element || !element.closest) return null;
    var ruby = element.closest('ruby.zoopdog-nom-ruby');
    return ruby && ruby.closest('a[href]') ? ruby : null;
  }

  // `zdCaretFromPoint` rather than caretRangeFromPoint directly: it carries
  // the recovery for the points where Chromium resolves a caret to an element
  // boundary instead of a text node, which is most of them over <ruby> in a
  // tight row -- exactly the text this drag exists to select.
  function zooSelectBetweenPoints(from, to) {
    var start = zdCaretFromPoint({x: from.x, y: from.y});
    var end = zdCaretFromPoint({x: to.x, y: to.y});
    if (!start || !end) return;
    var range = zooRangeBetween(start, end) || zooRangeBetween(end, start);
    if (!range && start.node === end.node) {
      // Both ends landed on the same offset of the same node, so the range
      // between them is empty even though the pointer has moved across the
      // word. That is the ordinary case for the text this drag exists to
      // select: a word wrapped in its own <ruby> is one short text node, and
      // a caret recovered from an element boundary (Chromium hands those back
      // over <ruby> -- see zdClosestTextNode) carries no offset within it. A
      // drag that stays inside one such word means that whole word.
      range = document.createRange();
      range.selectNodeContents(start.node);
    }
    if (!range || range.collapsed) return;
    var selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }

  // Null when the two carets are the wrong way round in document order, so
  // the caller can retry them swapped -- a drag runs in both directions and
  // only one order makes a non-empty Range.
  function zooRangeBetween(start, end) {
    var range = document.createRange();
    try {
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset);
    } catch (error) {
      return null;
    }
    return range.collapsed ? null : range;
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

  function zooShowSelectionBar(rect, text) {
    var bar = zooEnsureSelectionBar();
    zooSetHTML(bar, [
      '<button type="button" class="zd-local-btn" data-zd-action="add-nom">+ Add Chữ Nôm</button>',
      '<button type="button" class="zd-local-btn" data-zd-action="set-order">Set order</button>'
    ].join(''));
    Array.prototype.forEach.call(bar.querySelectorAll('[data-zd-action]'), function(button) {
      button.addEventListener('click', function(event) {
        event.preventDefault();
        var action = button.getAttribute('data-zd-action');
        zooHideSelectionBar();
        if (action === 'add-nom') {
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

  var ZOO_SHADOW_SCAN_LIMIT = 5000;

  // Open shadow roots under `node`, nested ones included, bounded so a huge
  // page cannot stall the selection handler.
  function zooCollectOpenShadowRoots(node) {
    var roots = [];
    if (!node) return roots;
    var start = node.nodeType === 1 ? node : node.parentElement;
    if (!start) return roots;
    var queue = [start];
    var scanned = 0;
    while (queue.length && scanned < ZOO_SHADOW_SCAN_LIMIT) {
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

  // Bounding rect and annotation-free text of a selection that lives inside a
  // shadow root, or null when there is none or the browser lacks
  // Selection.getComposedRanges.
  function zooComposedSelection(selection, container) {
    if (typeof selection.getComposedRanges !== 'function') return null;
    try {
      var roots = zooCollectOpenShadowRoots(container);
      if (!roots.length) return null;
      var composed = selection.getComposedRanges({shadowRoots: roots});
      if (!composed || !composed.length) return null;
      var range = document.createRange();
      range.setStart(composed[0].startContainer, composed[0].startOffset);
      range.setEnd(composed[0].endContainer, composed[0].endOffset);
      var rect = range.getBoundingClientRect();
      if (!rect || (!rect.width && !rect.height)) return null;
      var holder = document.createElement('div');
      holder.appendChild(range.cloneContents());
      Array.prototype.forEach.call(holder.querySelectorAll('rt, rp'), function(node) {
        node.parentNode.removeChild(node);
      });
      return {rect: rect, text: holder.textContent};
    } catch (error) {
      return null;
    }
  }

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
      var text = zooTrimSelectionPunctuation(selection.toString());
      if (!text || text.length > ZOO_SELECTION_MAX_CHARS) {
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
        if (!text || text.length > ZOO_SELECTION_MAX_CHARS) {
          zooHideSelectionBar();
          return;
        }
      }
      zooSelectionAnchorNode = anchorContainer;
      zooShowSelectionBar(rect, text);
    } catch (error) {
      zooHideSelectionBar();
    }
  }

  function zooWireSelectionBar() {
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

  function zooWireNomForm() {
    var ids = ZOO_MODAL_IDS.nom;
    var guard = zooCreateRaceGuard();
    var nomInput = document.getElementById(ids.nom);
    var explainInput = document.getElementById(ids.explain);
    var nomEdits = zooTrackEdits(nomInput);
    var explainEdits = zooTrackEdits(explainInput);
    var stateFlags = { isUpdate: false, nextOrder: '' };

    zooWireDatalistAutoClear(nomInput, function() { return nomEdits.edited; });
    zooWireContainingDatalist(nomInput, document.getElementById(ids.suggestions));

    function resetPreview() {
      document.getElementById(ids.diffPreview).hidden = true;
      document.getElementById(ids.diffPreview).textContent = '';
      document.getElementById(ids.confirmBtn).hidden = true;
      document.getElementById(ids.saveBtn).hidden = false;
      document.getElementById(ids.saveBtn).textContent = stateFlags.isUpdate ? 'Preview update' : 'Save';
      // Only meaningful once there is a stored entry to replace -- a
      // brand-new vi term has nothing for the checkbox to act on.
      document.getElementById(ids.replaceRow).hidden = !stateFlags.isUpdate;
      if (!stateFlags.isUpdate) document.getElementById(ids.replace).checked = false;
    }

    [nomInput, explainInput].forEach(function(input) {
      input.addEventListener('input', resetPreview);
    });
    document.getElementById(ids.replace).addEventListener('change', resetPreview);

    document.getElementById(ids.viSearch).addEventListener('click', function() {
      var term = document.getElementById(ids.vi).value.trim();
      if (term) window.open('https://www.google.com/search?q=' + encodeURIComponent(term), '_blank', 'noopener');
    });

    document.getElementById(ids.nomRefresh).addEventListener('click', function() {
      var vi = document.getElementById(ids.vi).value.trim();
      if (!vi) return;
      // Toggle: the server names the order to ask for next (first click zoopdog, then default, ...).
      var isCurrent = guard.begin();
      zooFetchNomForm(vi, stateFlags.nextOrder || 'zoopdog').then(function(form) {
        if (!isCurrent() || !form.candidates.length) return;
        applyNomForm(form);
        resetPreview();
      }, function() {
        zooSetModalStatus(ids.status, zooLocalRequestRecoveryMessage(), true);
      });
    });

    var nextNotesEngine = zooCreateEngineRotator();
    document.getElementById(ids.notesRefresh).addEventListener('click', function() {
      var vi = document.getElementById(ids.vi).value.trim();
      if (!vi) return;
      var button = document.getElementById(ids.notesRefresh);
      button.disabled = true;
      zooFetchNotesRefresh('nom-notes', vi, nextNotesEngine()).then(function(result) {
        if (result.candidates.length) {
          explainInput.value = result.candidates[0];
          explainEdits.mark();
          resetPreview();
          zooSetModalStatus(ids.status, zooNotesEngineMessage(result.engine, true), false);
        } else {
          zooSetModalStatus(ids.status, zooNotesEngineMessage(result.engine, false), true);
        }
      }, function() {
        zooSetModalStatus(ids.status, zooLocalRequestRecoveryMessage(), true);
      }).then(function() {
        button.disabled = false;
      });
    });

    document.getElementById(ids.notesStrip).addEventListener('click', function() {
      explainInput.value = zooStripPunctuation(explainInput.value);
      explainEdits.mark();
      resetPreview();
      explainInput.focus();
    });

    var notesAll = zooWireNotesAll(
      document.getElementById(ids.notesAll),
      document.getElementById(ids.notesAllList),
      'nom-notes',
      function() { return document.getElementById(ids.vi).value.trim(); },
      ids.status
    );

    document.getElementById(ids.notesClear).addEventListener('click', function() {
      explainInput.value = '';
      explainEdits.mark();
      resetPreview();
      explainInput.focus();
    });

    // Renders one /v1/nom/form answer: the datalist, the untouched Ch\u1EEF N\u00F4m field's
    // default, and the title / "already recorded" line the server wrote.
    function applyNomForm(form) {
      zooFillDatalist(ids.suggestions, form.candidates);
      if (!nomEdits.edited) {
        zooSetAutofillDefaultLive(nomInput, form.candidates.length ? form.candidates[0] : '', function() { return nomEdits.edited; });
      }
      stateFlags.nextOrder = form.next_order;
      stateFlags.isUpdate = Boolean(form.is_update);
      document.getElementById(ids.title).textContent = form.title;
      document.getElementById(ids.existingInfo).textContent = form.existing_info;
      document.getElementById(ids.existingInfo).hidden = !form.existing_info;
    }

    function refreshSuggestions(vi) {
      var isCurrent = guard.begin();
      stateFlags.nextOrder = ''; // a new term starts in the default ranking
      document.getElementById(ids.title).textContent = 'Add Ch\u1EEF N\u00F4m entry';
      document.getElementById(ids.existingInfo).hidden = true;
      stateFlags.isUpdate = false;
      if (!vi) {
        zooFillDatalist(ids.suggestions, []);
        resetPreview();
        return;
      }
      // The candidates and the entry-exists check are both cheap and answered
      // from data the server already has loaded, so one `/v1/nom/form` request
      // carries them and fills the form in immediately below.
      // `nom-notes`, by contrast, is a *live* machine-translation call out to
      // a third-party API (routes_suggest.py's `_notes_translation`, now
      // edge-first -- see `NOTES_DRAFT_PROVIDERS` -- since edge answered
      // fastest in practice), so it is kicked off in parallel rather than
      // awaited: the term/nom fields never wait on it, and the Notes field
      // fills in on its own whenever the translation lands. Still
      // auto-fetched (not only on the \u21BB click) -- with the fast fields no
      // longer held hostage to it, there is no reason to make the reader ask
      // for a draft note by hand every time.
      zooFetchNomForm(vi, '').then(function(form) {
        if (!isCurrent()) return;
        applyNomForm(form);
        resetPreview();
      }, function() {
        if (!isCurrent()) return;
        zooClearNomGeneratedState(ids);
        zooSetModalStatus(ids.status, zooLocalRequestRecoveryMessage(), true);
      });
      zooFetchSuggestions('nom-notes', vi).then(function(notesCandidates) {
        if (!isCurrent()) return;
        if (!explainEdits.edited && notesCandidates.length) {
          explainInput.value = notesCandidates[0];
        }
      }, function() {
        if (!isCurrent()) return;
        zooSetModalStatus(ids.status, zooLocalRequestRecoveryMessage(), true);
      });
    }

    var refreshDebounced = zooDebounce(function(vi) { refreshSuggestions(vi); }, 400);

    document.getElementById(ids.vi).addEventListener('input', function() {
      resetPreview();
      nomEdits.reset();
      explainEdits.reset();
      stateFlags.isUpdate = false;
      zooClearNomGeneratedState(ids);
      refreshDebounced(document.getElementById(ids.vi).value.trim());
    });

    function formQuery() {
      var vi = document.getElementById(ids.vi).value.trim();
      var nom = nomInput.value.trim();
      var query = { vi: vi, nom: nom };
      var explain = explainInput.value.trim();
      if (explain) query.explain = explain;
      if (stateFlags.isUpdate && document.getElementById(ids.replace).checked) query.replace = '1';
      return { vi: vi, nom: nom, query: query };
    }

    document.getElementById(ids.form).addEventListener('submit', function(event) {
      event.preventDefault();
      var parsed = formQuery();
      if (!parsed.vi || !parsed.nom) {
        zooSetModalStatus(ids.status, 'Vietnamese term and Ch\u1EEF N\u00F4m are both required.', true);
        return;
      }
      if (!stateFlags.isUpdate) {
        zooPost('/v1/nom/entries', parsed.query).then(function(payload) {
          zooCloseModal(ids.backdrop);
          zooShowToast(payload.note || 'Added.');
        }, function(error) {
          zooSetModalStatus(ids.status, error.message, true);
        });
        return;
      }
      var previewQuery = {};
      Object.keys(parsed.query).forEach(function(key) { previewQuery[key] = parsed.query[key]; });
      previewQuery.preview = '1';
      zooPost('/v1/nom/entries', previewQuery).then(function(payload) {
        var changed = zooRenderEntryDiff(document.getElementById(ids.diffPreview), payload.diff);
        if (!changed) {
          zooSetModalStatus(ids.status, 'Nothing new -- already recorded exactly this.', true);
          document.getElementById(ids.confirmBtn).hidden = true;
          return;
        }
        document.getElementById(ids.saveBtn).hidden = true;
        document.getElementById(ids.confirmBtn).hidden = false;
        zooSetModalStatus(ids.status, '', false);
      }, function(error) {
        zooSetModalStatus(ids.status, error.message, true);
      });
    });

    document.getElementById(ids.confirmBtn).addEventListener('click', function() {
      var parsed = formQuery();
      if (!parsed.vi || !parsed.nom) return;
      zooPost('/v1/nom/entries', parsed.query).then(function(payload) {
        zooCloseModal(ids.backdrop);
        zooShowToast(payload.note || 'Updated.');
      }, function(error) {
        zooSetModalStatus(ids.status, error.message, true);
      });
    });

    zooNomFormState = {
      refresh: refreshSuggestions,
      notesAll: notesAll,
      reset: function() {
        nomEdits.reset();
        explainEdits.reset();
        stateFlags.isUpdate = false;
        document.getElementById(ids.title).textContent = 'Add Ch\u1EEF N\u00F4m entry';
        document.getElementById(ids.existingInfo).hidden = true;
      }
    };
  }

  function zooOpenNomModal(vi) {
    zooBuildModals();
    var ids = ZOO_MODAL_IDS.nom;
    var term = zooTrimSelectionPunctuation(vi);
    zooNomFormState.reset();
    document.getElementById(ids.vi).value = term;
    zooClearNomGeneratedState(ids);
    document.getElementById(ids.explain).value = '';
    document.getElementById(ids.title).textContent = 'Add Ch\u1EEF N\u00F4m entry';
    document.getElementById(ids.existingInfo).hidden = true;
    document.getElementById(ids.replaceRow).hidden = true;
    document.getElementById(ids.replace).checked = false;
    zooSetModalStatus(ids.status, '', false);
    document.getElementById(ids.diffPreview).hidden = true;
    document.getElementById(ids.diffPreview).textContent = '';
    document.getElementById(ids.confirmBtn).hidden = true;
    document.getElementById(ids.saveBtn).hidden = false;
    document.getElementById(ids.saveBtn).textContent = 'Save';
    zooOpenModal(ids.backdrop);
    // Fired off, not awaited: the modal is already showing, and the "Refresh
    // all" list fills in on its own without holding up anything else here.
    zooNomFormState.notesAll.run();
    zooNomFormState.refresh(term);
  }

  function zooWireNomOrderForm() {
    var ids = ZOO_MODAL_IDS.order;
    var nomInput = document.getElementById(ids.nom);
    var viInput = document.getElementById(ids.vi);
    var order = { vi: '', words: [], variants: [], stored: null, hint: '' };
    var token = 0;

    zooWirePickerAutoClear(nomInput);

    function term() { return viInput.value.trim(); }
    // Names which of the two on-file rows for this term (see
    // reader/nom_order.py's caseSensitive option) the modal is viewing or
    // editing -- mirrors book-translator's reader_nom_order.js.
    function isCaseSensitive() { return document.getElementById(ids.caseSensitive).checked; }

    function resetPreview() {
      document.getElementById(ids.diffPreview).hidden = true;
      document.getElementById(ids.diffPreview).textContent = '';
      document.getElementById(ids.confirmBtn).hidden = true;
      document.getElementById(ids.saveBtn).hidden = false;
    }

    function renderWords() {
      var box = document.getElementById(ids.words);
      box.textContent = '';
      if (order.words.length < 2) { box.hidden = true; return; }
      var label = document.createElement('span');
      label.textContent = 'Ordering applies to one word:';
      box.appendChild(label);
      var current = term();
      order.words.forEach(function(word) {
        var chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'zd-nom-order-word';
        chip.textContent = word;
        chip.setAttribute('aria-pressed', String(word === current));
        chip.addEventListener('click', function() {
          viInput.value = word;
          refresh();
        });
        box.appendChild(chip);
      });
      box.hidden = false;
    }

    function renderOptions() {
      var list = document.getElementById(ids.suggestions);
      list.textContent = '';
      order.variants.forEach(function(variant) {
        var option = document.createElement('option');
        option.value = variant;
        list.appendChild(option);
      });
      // Wording comes from the server (`current_hint`), like the title and default pick below.
      var hint = document.getElementById(ids.current);
      hint.textContent = order.hint;
      hint.hidden = !hint.textContent;
    }

    function refresh() {
      var vi = term();
      var myToken = (token += 1);

      order.vi = vi;
      order.variants = [];
      order.stored = null;
      order.hint = '';
      nomInput.value = '';
      document.getElementById(ids.suggestions).textContent = '';
      document.getElementById(ids.existingInfo).hidden = true;
      document.getElementById(ids.title).textContent = 'Set Ch\u1EEF N\u00F4m order';
      document.getElementById(ids.current).hidden = true;
      zooSetModalStatus(ids.status, '', false);
      resetPreview();
      renderWords();

      if (!vi) return;

      var lookupQuery = { vi: vi, scope: 'global' };
      if (isCaseSensitive()) lookupQuery.caseSensitive = '1';
      zooGetJSON('/v1/nom/order', lookupQuery).then(function(payload) {
        if (myToken !== token) return;
        order.variants = payload.variants || [];
        order.stored = payload.exists ? (payload.order || []) : null;
        order.hint = payload.current_hint || '';
        renderOptions();
        document.getElementById(ids.title).textContent = payload.title;
        document.getElementById(ids.existingInfo).textContent = payload.existing_info;
        document.getElementById(ids.existingInfo).hidden = !payload.existing_info;
        // The server's default pick: the recorded first choice, else the *second* rendering --
        // variants[0] is already what is on screen, so offering it back would be a no-op.
        nomInput.value = payload.pick || '';
        resetPreview();
      }, function(error) {
        if (myToken !== token) return;
        zooSetModalStatus(ids.status, error.message, true);
      });
    }

    var refreshDebounced = zooDebounce(function() { refresh(); }, 400);

    viInput.addEventListener('input', function() {
      renderWords();
      resetPreview();
      refreshDebounced();
    });

    nomInput.addEventListener('input', function() {
      resetPreview();
      zooSetModalStatus(ids.status, '', false);
    });

    document.getElementById(ids.caseSensitive).addEventListener('change', function() {
      refresh();
    });

    function query() {
      var q = { vi: term(), nom: nomInput.value.trim(), scope: 'global' };
      if (isCaseSensitive()) q.caseSensitive = '1';
      return q;
    }

    document.getElementById(ids.form).addEventListener('submit', function(event) {
      event.preventDefault();
      var q = query();
      if (!q.vi || !q.nom) return;
      var previewQuery = { vi: q.vi, nom: q.nom, scope: q.scope, preview: '1' };
      zooPost('/v1/nom/order', previewQuery).then(function(payload) {
        var changed = zooRenderEntryDiff(document.getElementById(ids.diffPreview), payload.diff);
        if (!changed) {
          zooSetModalStatus(ids.status, 'Nothing to change -- already the preferred rendering.', true);
          document.getElementById(ids.confirmBtn).hidden = true;
          return;
        }
        document.getElementById(ids.saveBtn).hidden = true;
        document.getElementById(ids.confirmBtn).hidden = false;
        zooSetModalStatus(ids.status, '', false);
      }, function(error) {
        zooSetModalStatus(ids.status, error.message, true);
      });
    });

    document.getElementById(ids.confirmBtn).addEventListener('click', function() {
      var q = query();
      if (!q.vi || !q.nom) return;
      zooPost('/v1/nom/order', q).then(function(payload) {
        zooCloseModal(ids.backdrop);
        zooShowToast(payload.note || 'Saved.');
      }, function(error) {
        zooSetModalStatus(ids.status, error.message, true);
      });
    });

    zooOrderState = {
      setWords: function(words) { order.words = words; },
      refresh: refresh
    };
  }

  function zooOpenNomOrderModal(vi) {
    zooBuildModals();
    var ids = ZOO_MODAL_IDS.order;
    var selection = zooTrimSelectionPunctuation(vi);
    zooOrderState.setWords(selection.split(/\s+/).filter(Boolean));
    document.getElementById(ids.vi).value = selection;
    // Always starts unchecked -- a deliberate per-save choice, not something
    // remembered from an earlier one (mirrors reader_nom_order.js).
    document.getElementById(ids.caseSensitive).checked = false;
    zooOpenModal(ids.backdrop);
    zooOrderState.refresh();
  }

  function zooBuildModals() {
    if (document.getElementById(ZOO_MODAL_IDS.nom.backdrop)) return;

    var nomIds = ZOO_MODAL_IDS.nom;
    var nomHtml = [
      '<div id="', nomIds.backdrop, '" class="zd-modal-backdrop" hidden>',
      '<form id="', nomIds.form, '" class="zd-modal">',
      '<h2 id="', nomIds.title, '">Add Ch\u1EEF N\u00F4m entry</h2>',
      '<p id="', nomIds.existingInfo, '" class="zd-modal-hint" hidden></p>',
      '<label>Vietnamese term',
      '<span class="zd-field-row">',
      '<input id="', nomIds.vi, '" type="text" required>',
      '<button type="button" id="', nomIds.viSearch, '" class="zd-field-button" title="Search this term on Google (new tab)" aria-label="Search on Google">\uD83D\uDD0D</button>',
      '</span>',
      '</label>',
      '<label>Ch\u1EEF N\u00F4m',
      '<span class="zd-field-row">',
      '<input id="', nomIds.nom, '" type="text" required list="', nomIds.suggestions, '">',
      '<button type="button" id="', nomIds.nomRefresh, '" class="zd-field-button" title="Suggest in zoopdog dictionary order">\u21BB</button>',
      '</span>',
      '<datalist id="', nomIds.suggestions, '"></datalist>',
      '</label>',
      '<label id="', nomIds.replaceRow, '" class="zd-modal-checkbox-row" hidden>',
      '<input id="', nomIds.replace, '" type="checkbox">',
      'Replace the stored spelling instead of adding a variant',
      '</label>',
      '<label>Notes',
      '<span class="zd-field-row">',
      '<input id="', nomIds.explain, '" type="text">',
      '<button type="button" id="', nomIds.notesRefresh, '" class="zd-field-button" title="Re-translate -- each click asks the next engine in turn">\u21BB</button>',
      '<button type="button" id="', nomIds.notesClear, '" class="zd-field-button" title="Clear notes">\u2715</button>',
      '<button type="button" id="', nomIds.notesStrip, '" class="zd-field-button" title="Remove punctuation from notes">!?</button>',
      '</span>',
      '</label>',
      '<button type="button" id="', nomIds.notesAll, '" class="zd-field-button zd-notes-all-button" title="Ask every engine at once, for reference">Refresh all</button>',
      '<ul id="', nomIds.notesAllList, '" class="zd-notes-all-list" hidden></ul>',
      '<ul id="', nomIds.diffPreview, '" class="zd-entry-diff-list" hidden></ul>',
      '<p id="', nomIds.status, '" class="zd-modal-status" hidden></p>',
      '<div class="zd-modal-actions">',
      '<button type="button" data-zd-modal-cancel>Cancel</button>',
      '<button type="submit" id="', nomIds.saveBtn, '">Save</button>',
      '<button type="button" id="', nomIds.confirmBtn, '" hidden>Confirm update</button>',
      '</div>',
      '</form>',
      '</div>'
    ].join('');

    var orderIds = ZOO_MODAL_IDS.order;
    var orderHtml = [
      '<div id="', orderIds.backdrop, '" class="zd-modal-backdrop" hidden>',
      '<form id="', orderIds.form, '" class="zd-modal">',
      '<h2 id="', orderIds.title, '">Set Ch\u1EEF N\u00F4m order</h2>',
      '<p class="zd-modal-hint">The rendering picked here leads the list, so it is the one shown as ruby.</p>',
      '<p id="', orderIds.existingInfo, '" class="zd-modal-hint" hidden></p>',
      '<label>Vietnamese term<input id="', orderIds.vi, '" type="text" required autocomplete="off"></label>',
      '<p id="', orderIds.words, '" class="zd-nom-order-words" hidden></p>',
      '<label>Preferred rendering',
      '<input id="', orderIds.nom, '" type="text" class="zd-nom-order-pick" required list="', orderIds.suggestions, '" autocomplete="off">',
      '<datalist id="', orderIds.suggestions, '"></datalist>',
      '</label>',
      '<p id="', orderIds.current, '" class="zd-modal-hint" hidden></p>',
      '<label class="zd-modal-checkbox-row">',
      '<input id="', orderIds.caseSensitive, '" type="checkbox">',
      'Only for this exact capitalization (e.g. a name)',
      '</label>',
      '<ul id="', orderIds.diffPreview, '" class="zd-entry-diff-list" hidden></ul>',
      '<p id="', orderIds.status, '" class="zd-modal-status" hidden></p>',
      '<div class="zd-modal-actions">',
      '<button type="button" data-zd-modal-cancel>Cancel</button>',
      '<button type="submit" id="', orderIds.saveBtn, '">Preview</button>',
      '<button type="button" id="', orderIds.confirmBtn, '" hidden>Confirm update</button>',
      '</div>',
      '</form>',
      '</div>'
    ].join('');

    var toastHtml = '<div id="zoopdog-toast" class="zd-toast" hidden></div>';

    var container = document.createElement('div');
    container.id = 'zoopdog-userscript-modals';
    zooSetHTML(container, nomHtml + orderHtml + toastHtml);
    document.body.appendChild(container);
    container.addEventListener('mousedown', function(event) { event.stopPropagation(); });

    zooBindModalDismiss();
    zooMakeModalDraggable(ZOO_MODAL_IDS.nom.backdrop);
    zooMakeModalDraggable(ZOO_MODAL_IDS.order.backdrop);
    zooWireNomForm();
    zooWireNomOrderForm();
  }
