// A fragment of the -local popup build, moved out of popupdict-local.runtime.js verbatim.
// scripts/build-popupdict-userscript.js concatenates it (LOCAL_RUNTIME_SOURCES) inside the one IIFE of
// popupdict.runtime.js, so it shares that scope; nothing here is exported or imported.
// Holds: the blacklist modal (zooOpenBlacklistModal, zooWireBlacklistForm) and zooBuildModals, which
// creates the three modals and the toast once and wires their forms.
// Relies on shared-IIFE globals declared elsewhere:
// modal mechanics and ZOO_MODAL_IDS (local-modal.js), zooPost (local-server.js), zooWireNomForm,
// zooWireNomOrderForm (local-nom-form.js, local-nom-order-form.js), zooGuard (local-modal-guard.js)
// and zooSetHTML (core runtime).

  // The "blacklist" button next to an uncoloured Google link: the modal asks for the site (pre-filled with the link's
  // host, editable) and a reason (default "no search"), POSTs it, and tells the caller which answer to paint.
  var ZOO_BLACKLIST_DEFAULT_REASON = 'no search';
  var zooBlacklistDone = null;

  function zooOpenBlacklistModal(host, done) {
    zooBuildModals();
    var ids = ZOO_MODAL_IDS.blacklist;
    document.getElementById(ids.host).value = host || '';
    document.getElementById(ids.reason).value = ZOO_BLACKLIST_DEFAULT_REASON;
    zooSetModalStatus(ids.status, '');
    zooBlacklistDone = done || null;
    zooOpenModal(ids.backdrop);
    var input = document.getElementById(ids.host);
    if (input.focus) input.focus();
  }

  function zooWireBlacklistForm() {
    var ids = ZOO_MODAL_IDS.blacklist;
    document.getElementById(ids.form).addEventListener('submit', zooGuard(function(event) {
      event.preventDefault();
      var host = document.getElementById(ids.host).value.trim();
      if (!host) {
        zooSetModalStatus(ids.status, 'The site is required.', true);
        return undefined;
      }
      var reason = document.getElementById(ids.reason).value.trim() || ZOO_BLACKLIST_DEFAULT_REASON;
      zooSetModalStatus(ids.status, 'Saving...');
      return zooPost('/v1/explored-sites/blacklist', {host: host, reason: reason}).then(function(data) {
        zooCloseModal(ids.backdrop);
        zooShowToast('Blacklisted ' + data.domain + ': ' + data.reason);
        var done = zooBlacklistDone;
        zooBlacklistDone = null;
        if (done) done(data);
      }, function(error) {
        var payload = error.payload || {};
        zooSetModalStatus(ids.status, payload.error || error.message || 'Could not reach the reader server', true);
      });
    }));
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

    var blIds = ZOO_MODAL_IDS.blacklist;
    var blacklistHtml = [
      '<div id="', blIds.backdrop, '" class="zd-modal-backdrop" hidden>',
      '<form id="', blIds.form, '" class="zd-modal">',
      '<h2 id="', blIds.title, '">Blacklist a site: no need to explore</h2>',
      '<p class="zd-modal-hint">Appended to book-translator\'s docs/explored_sites_blacklist.json; links to it are then shown in grey.</p>',
      '<label>Site (host or link; the registrable domain is stored)',
      '<input id="', blIds.host, '" type="text" required autocomplete="off">',
      '</label>',
      '<label>Reason',
      '<input id="', blIds.reason, '" type="text" autocomplete="off">',
      '</label>',
      '<p id="', blIds.status, '" class="zd-modal-status" hidden></p>',
      '<div class="zd-modal-actions">',
      '<button type="button" data-zd-modal-cancel>Cancel</button>',
      '<button type="submit" id="', blIds.saveBtn, '">Add to blacklist</button>',
      '</div>',
      '</form>',
      '</div>'
    ].join('');

    var toastHtml = '<div id="zoopdog-toast" class="zd-toast" hidden></div>';

    var container = document.createElement('div');
    container.id = 'zoopdog-userscript-modals';
    zooSetHTML(container, nomHtml + orderHtml + blacklistHtml + toastHtml);
    document.body.appendChild(container);
    container.addEventListener('mousedown', function(event) { event.stopPropagation(); });

    zooBindModalDismiss();
    zooMakeModalDraggable(ZOO_MODAL_IDS.nom.backdrop);
    zooMakeModalDraggable(ZOO_MODAL_IDS.order.backdrop);
    zooMakeModalDraggable(ZOO_MODAL_IDS.blacklist.backdrop);
    zooMakeModalResizable(ZOO_MODAL_IDS.nom.backdrop);
    zooMakeModalResizable(ZOO_MODAL_IDS.order.backdrop);
    zooWireNomForm();
    zooWireNomOrderForm();
    zooWireBlacklistForm();
  }
