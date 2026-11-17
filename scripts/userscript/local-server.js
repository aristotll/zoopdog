// A fragment of the -local popup build, moved out of popupdict-local.runtime.js verbatim.
// scripts/build-popupdict-userscript.js concatenates it (LOCAL_RUNTIME_SOURCES) inside the one IIFE of
// popupdict.runtime.js, so it shares that scope; nothing here is exported or imported.
// Holds: the local reader-server settings (ZOO_LOCAL_*), the GM_xmlhttpRequest transport instance
// (zooHttpRequest, zooGetJSON, zooPost) and zooProbeLocalMode, which turns local mode on.
// Relies on shared-IIFE globals declared elsewhere:
// createZooLocalTransport (local-transport.js), zooStartAiSearchHandoff, zooInstallMetaSoSourceBridge
// (local-ai-search.js, local-metaso-sources.js) and zooStartExploredHighlight (local-explored-highlight.js).

  // ---------------------------------------------------------------------
  // Local mode
  //
  // Talks to the book-translator reader server (scripts/reader/tts_server.py
  // in the book-translator repo) running on the user's own machine, so
  // "Add Ch\u1EEF N\u00F4m entry" / "Set Ch\u1EEF N\u00F4m order" write to the very same
  // user_nom_entries/ shards / user_nom_order.jsonc the reader itself edits.
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
  // One "Refresh all" channel can legitimately take far longer than 8 s (tab-driven engines, slow web
  // engines); the server cuts a channel off at 60 s (`_NOTES_ALL_DEADLINE_SECONDS` in routes_suggest.py),
  // so a channel request waits that long plus a margin before the client calls it failed.
  var ZOO_NOTES_ALL_TIMEOUT = 75000;

  var zooHttpRequest = createZooLocalTransport({
    baseUrl: ZOO_LOCAL_BASE,
    getTimeout: function() { return ZOO_LOCAL_REQUEST_TIMEOUT; },
    send: function(details) {
      if (typeof GM_xmlhttpRequest !== 'function') throw new Error('GM_xmlhttpRequest unavailable');
      GM_xmlhttpRequest(details);
    }
  });

  function zooGetJSON(path, params, timeout) { return zooHttpRequest('GET', path, params, undefined, timeout); }
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
    zooStartAiSearchHandoff();
    zooInstallMetaSoSourceBridge();
    ZOO_LOCAL_AVAILABLE = true;
    zooStartExploredHighlight();
  }
