// A fragment of the -local popup build, moved out of popupdict-local.runtime.js verbatim.
// scripts/build-popupdict-userscript.js concatenates it (LOCAL_RUNTIME_SOURCES) inside the one IIFE of
// popupdict.runtime.js, so it shares that scope; nothing here is exported or imported.
// Holds: the clipboard helper, the "Refresh all" button wiring, the datalist / autofill helpers shared by
// the two modal forms and the engine rotator.
// Relies on shared-IIFE globals declared elsewhere:
// zooGetJSON (local-server.js), zooFetchNotesAll and ZOO_NOTES_ALL_REDRAW_MS (local-requests.js)
// and zooSetModalStatus (local-modal.js).

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
      function renderRows(rows) {
        if (!rows.length) rows = [{ engines: [], text: '' }];
        list.textContent = '';
        rows.forEach(function(row) {
          var li = document.createElement('li');
          var label = document.createElement('strong');
          label.textContent = row.label ? row.label + (row.unsupported ? '' : ': ') : '';
          li.appendChild(label);
          li.appendChild(document.createTextNode(row.text || row.message || (row.unsupported ? '' : row.skipped ? '(skipped: limited quota)' : row.engines.length ? '(no answer)' : 'No engine answered.')));
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
          (row.actions || []).forEach(function(action) {
            // A failing channel's row: the server finished the buttons (label, GET); we only send them.
            var toggle = document.createElement('button');
            toggle.type = 'button';
            toggle.className = 'zd-notes-all-copy';
            toggle.textContent = action.label;
            toggle.addEventListener('click', function() {
              toggle.disabled = true;
              zooGetJSON(action.path, action.params).then(function() { toggle.textContent = 'Done'; }, function() {
                toggle.textContent = 'Failed';
                toggle.disabled = false;
              });
            });
            li.appendChild(document.createTextNode(' '));
            li.appendChild(toggle);
          });
          list.appendChild(li);
        });
      }
      // Streamed replies can arrive dozens of times a second; redrawing on each one made the list flicker. Drawn at most once
      // per ZOO_NOTES_ALL_REDRAW_MS (first reply at once, the latest rows after the pause); the final rows always replace it.
      var lastDraw = 0;
      var latest = null;
      var timer = null;
      function drawLatest() { timer = null; lastDraw = Date.now(); renderRows(latest); }
      function onRows(shown) {
        latest = shown;
        var wait = lastDraw + ZOO_NOTES_ALL_REDRAW_MS - Date.now();
        if (wait <= 0) drawLatest();
        else if (timer === null) timer = setTimeout(drawLatest, wait);
      }
      zooFetchNotesAll(kind, text, onRows).then(function(finalRows) { clearTimeout(timer); renderRows(finalRows); }, function() {
        clearTimeout(timer);
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
    if (document.activeElement === input && !isEdited() && !input._zooPointerFocus) input.value = '';
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

  // The default is blanked only for keyboard focus. A mouse press means the reader is
  // pointing at its characters to select or edit them: blanking the text under the caret
  // (and again when a late suggestion refills it) left the browser's selection offsets on
  // the wrong character, so "select 糖, delete" removed 蜜. Pointer focus keeps the text.
  function zooWireDatalistAutoClear(input, isEdited) {
    input.addEventListener('mousedown', function() { input._zooPointerFocus = true; });
    input.addEventListener('focus', function() {
      if (input._zooPointerFocus) return;
      if (!isEdited() && input.value && input.value === input.dataset.autofillDefault) input.value = '';
    });
    input.addEventListener('blur', function() {
      input._zooPointerFocus = false;
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
