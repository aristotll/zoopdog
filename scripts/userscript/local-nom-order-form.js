// A fragment of the -local popup build, moved out of popupdict-local.runtime.js verbatim.
// scripts/build-popupdict-userscript.js concatenates it (LOCAL_RUNTIME_SOURCES) inside the one IIFE of
// popupdict.runtime.js, so it shares that scope; nothing here is exported or imported.
// Holds: zooWireNomOrderForm (the "Set order" form) and zooOpenNomOrderModal.
// Relies on shared-IIFE globals declared elsewhere:
// modal mechanics, ZOO_MODAL_IDS and the form state (local-modal.js), zooDebounce (local-requests.js),
// zooWirePickerAutoClear (local-form-helpers.js), zooGetJSON / zooPost (local-server.js), zooBuildModals
// (local-modal-build.js) and zooGuard (local-modal-guard.js).

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
        // The server's default pick: never variants[0] (already what is on screen, so offering it back would be a
        // no-op): the recorded first choice when it is not shown, else the *second* rendering.
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

    document.getElementById(ids.form).addEventListener('submit', zooGuard(function(event) {
      event.preventDefault();
      var q = query();
      if (!q.vi || !q.nom) return;
      var previewQuery = Object.assign({}, q, {preview: '1'});
      return zooPost('/v1/nom/order', previewQuery).then(function(payload) {
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
    }));

    document.getElementById(ids.confirmBtn).addEventListener('click', zooGuard(function() {
      var q = query();
      if (!q.vi || !q.nom) return;
      return zooPost('/v1/nom/order', q).then(function(payload) {
        zooCloseModal(ids.backdrop);
        zooShowToast(payload.note || 'Saved.');
      }, function(error) {
        zooSetModalStatus(ids.status, error.message, true);
      });
    }));

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
