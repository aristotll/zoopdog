// A fragment of the -local popup build, moved out of popupdict-local.runtime.js verbatim.
// scripts/build-popupdict-userscript.js concatenates it (LOCAL_RUNTIME_SOURCES) inside the one IIFE of
// popupdict.runtime.js, so it shares that scope; nothing here is exported or imported.
// Holds: zooWireNomForm (the "Add Chu Nom entry" form: suggestions, notes, preview, confirm) and
// zooOpenNomModal.
// Relies on shared-IIFE globals declared elsewhere:
// modal mechanics, ZOO_MODAL_IDS and the form state (local-modal.js), the request helpers
// (local-requests.js), the datalist / notes helpers (local-form-helpers.js), zooPost (local-server.js),
// zooBuildModals (local-modal-build.js) and zooGuard (local-modal-guard.js).

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
      zooOpenGoogleSearch(term);
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

    document.getElementById(ids.form).addEventListener('submit', zooGuard(function(event) {
      event.preventDefault();
      var parsed = formQuery();
      if (!parsed.vi || !parsed.nom) {
        zooSetModalStatus(ids.status, 'Vietnamese term and Ch\u1EEF N\u00F4m are both required.', true);
        return;
      }
      if (!stateFlags.isUpdate) {
        return zooPost('/v1/nom/entries', parsed.query).then(function(payload) {
          zooCloseModal(ids.backdrop);
          zooShowToast(payload.note || 'Added.');
        }, function(error) {
          zooSetModalStatus(ids.status, error.message, true);
        });
      }
      var previewQuery = {};
      Object.keys(parsed.query).forEach(function(key) { previewQuery[key] = parsed.query[key]; });
      previewQuery.preview = '1';
      return zooPost('/v1/nom/entries', previewQuery).then(function(payload) {
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
    }));

    document.getElementById(ids.confirmBtn).addEventListener('click', zooGuard(function() {
      var parsed = formQuery();
      if (!parsed.vi || !parsed.nom) return;
      return zooPost('/v1/nom/entries', parsed.query).then(function(payload) {
        zooCloseModal(ids.backdrop);
        zooShowToast(payload.note || 'Updated.');
      }, function(error) {
        zooSetModalStatus(ids.status, error.message, true);
      });
    }));

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
