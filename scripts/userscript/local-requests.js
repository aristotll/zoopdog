// A fragment of the -local popup build, moved out of popupdict-local.runtime.js verbatim.
// scripts/build-popupdict-userscript.js concatenates it (LOCAL_RUNTIME_SOURCES) inside the one IIFE of
// popupdict.runtime.js, so it shares that scope; nothing here is exported or imported.
// Holds: debounce and race-guard helpers, the suggestion / form / notes-refresh fetchers, the Google
// search opener and the "Refresh all" notes streaming requests.
// Relies on shared-IIFE globals declared elsewhere:
// ZOO_LOCAL_BASE, ZOO_NOTES_ALL_TIMEOUT, zooGetJSON and zooPost (local-server.js).

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
  // finished `rows` ({engines, label, text[, skipped][, unsupported]}), already grouped and folded; an
  // engine with no answer is in a trailing row with empty text, and engines that do not offer the pair
  // are one `unsupported` row whose `label` already says "pair not supported: ...".
  // The search icon opens every engine enabled on the server's /control page. The SERVER opens the tabs
  // through CDP in the Chrome profile of this page (`from`), so no popup blocker is involved; only when it
  // could not (`opened` 0) does the userscript open the server's finished `urls` itself.
  // Idempotent: a click on the same term while its open is in flight (or a double click) shares that one request;
  // the guard lets go after 15 s whatever the server does, so the button is never stuck.
  var zooSearchInFlight = {};
  function zooOpenGoogleSearch(term) {
    if (!term) return Promise.resolve();
    var key = term + '\n' + window.location.href;
    if (zooSearchInFlight[key]) return zooSearchInFlight[key];
    var release = function() { delete zooSearchInFlight[key]; };
    var run = zooPost('/v1/web-search/open', { q: term, from: window.location.href }).then(function(data) {
      return data && data.opened ? [] : ((data && data.urls) || []);
    }, function() { return []; }).then(function(urls) {
      urls.forEach(function(row) { window.open(row.url, '_blank', 'noopener'); });
    });
    run.then(release, release);
    setTimeout(release, 15000);
    zooSearchInFlight[key] = run;
    return run;
  }

  // Each channel is asked in its own request, so a failing channel is retried alone
  // (ZOO_NOTES_ALL_RETRIES times, sleeping 1 s, 2 s, 4 s) and the channels that answered still show. The
  // server keeps the answers per `session` and returns the finished `rows` over all channels with every
  // reply; a channel that failed every retry is reported to the server (`error=1`) and becomes an "error"
  // row of its own. `onRows(rows)`, if given, sees each reply, so the list shows answers as they arrive. If not even the channel list can be had,
  // one row says the server was unreachable.
  var ZOO_NOTES_ALL_RETRIES = 3;
  var ZOO_NOTES_ALL_BASE_DELAY_MS = 1000;
  var ZOO_NOTES_ALL_CONCURRENCY = 5;
  var ZOO_NOTES_ALL_REDRAW_MS = 2000;
  function zooNotesAllWaiting(rows) {
    return rows.reduce(function(n, row) { return n + (row.pending ? row.engines.length : 0); }, 0);
  }
  // One connection for every channel (`GET /v1/suggest/stream`, NDJSON: a line per finished channel, then
  // `{"done": true}`; book-translator scripts/reader/notes_stream.py). Resolves true when the stream ended with `done`;
  // false (no GM_xmlhttpRequest, HTTP error, cut connection) sends the caller to the per-channel requests below.
  // `onprogress` shows lines as they arrive; `onload` carries the whole text, so a manager that never reports progress
  // still gets every line, just at the end.
  // `control` ({cancelled, abort}) is how the box that shows the answers cancels the ask when it is closed: `abort()` drops the
  // connection (the server sees the closed socket and stops asking the channels it has not started) and the stream resolves
  // true so the caller does not fall back to per-channel requests. An abort nobody asked for resolves false (a cut connection).
  function zooStreamNotesAll(kind, text, take, control) {
    return new Promise(function(resolve) {
      if (typeof GM_xmlhttpRequest !== 'function') { resolve(false); return; }
      var seen = 0;
      var finished = false;
      function consume(responseText) {
        var end = responseText.lastIndexOf('\n');
        if (end < seen) return;
        responseText.slice(seen, end).split('\n').forEach(function(line) {
          if (!line) return;
          var data = JSON.parse(line);
          if (data.done) finished = true; else take(data);
        });
        seen = end + 1;
      }
      try {
        var request = GM_xmlhttpRequest({
          method: 'GET',
          url: ZOO_LOCAL_BASE + '/v1/suggest/stream?kind=' + encodeURIComponent(kind) + '&text=' + encodeURIComponent(text),
          timeout: ZOO_NOTES_ALL_TIMEOUT,
          onprogress: function(response) { try { consume(response.responseText || ''); } catch (e) { /* the final onload re-reads */ } },
          onload: function(response) {
            try {
              if (response.status !== 200) { resolve(false); return; }
              consume(response.responseText || '');
              resolve(finished);
            } catch (e) { resolve(false); }
          },
          onerror: function() { resolve(control && control.cancelled ? true : false); },
          ontimeout: function() { resolve(false); },
          // Only the user's cancel ends the ask; an abort by the manager (page unload, its own cut-off) is a cut
          // connection, so the caller falls back to the per-channel requests (review 2026-11-25, finding 14).
          onabort: function() { resolve(Boolean(control && control.cancelled)); }
        });
        if (control) {
          control.abort = function() { if (request && typeof request.abort === 'function') request.abort(); resolve(true); };
          if (control.cancelled) control.abort();
        }
      } catch (e) { resolve(false); }
    });
  }

  function zooFetchNotesAll(kind, text, onRows, control) {
    if (!text) return Promise.resolve([]);
    var streamedRows = [];
    function takeStreamed(reply) {
      if (!reply || !reply.rows || (streamedRows.length && zooNotesAllWaiting(reply.rows) > zooNotesAllWaiting(streamedRows))) return;
      streamedRows = reply.rows;
      if (onRows) onRows(streamedRows);
    }
    return zooStreamNotesAll(kind, text, takeStreamed, control).then(function(done) {
      return done || (control && control.cancelled) ? streamedRows : zooFetchNotesAllPerChannel(kind, text, onRows, control);
    });
  }

  function zooFetchNotesAllPerChannel(kind, text, onRows, control) {
    function cancelled() { return Boolean(control && control.cancelled); }
    function withRetry(params, n) {
      return zooGetJSON('/v1/suggest', params, params.engine === undefined ? undefined : ZOO_NOTES_ALL_TIMEOUT).catch(function(error) {
        if (cancelled() || n >= ZOO_NOTES_ALL_RETRIES) throw error;
        return new Promise(function(resolve) {
          setTimeout(resolve, ZOO_NOTES_ALL_BASE_DELAY_MS * Math.pow(2, n));
        }).then(function() { return withRetry(params, n + 1); });
      });
    }
    function base() { return { kind: kind, text: text, refresh: 'all' }; }
    var listParams = base();
    listParams.engines = '1';
    return withRetry(listParams, 0).then(function(data) {
      var engines = data.engines || [];
      var session = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      var rows = [];
      function take(reply) {
        // A reply of a channel that was already in flight when the box closed is not drawn.
        if (cancelled()) return;
        // Replies can arrive out of order; each is cumulative, so the one with fewest channels waiting is newest.
        if (!reply || !reply.rows || (rows.length && zooNotesAllWaiting(reply.rows) > zooNotesAllWaiting(rows))) return;
        rows = reply.rows;
        if (onRows) onRows(rows);
      }
      // Fallback only (no stream): at most ZOO_NOTES_ALL_CONCURRENCY channels in flight: a browser keeps 6 connections per host, and all of
      // them busy for 27 s (70 channels, measured 2026-11-07) made the quick fields of the modal show last.
      var nextChannel = 0;
      function askNext() {
        if (nextChannel >= engines.length || cancelled()) return Promise.resolve();
        var index = nextChannel++;
        var params = base();
        params.engine = String(index);
        params.session = session;
        return withRetry(params, 0).then(take, function() {
          if (cancelled()) return;
          var report = base();
          report.engine = String(index);
          report.session = session;
          report.error = '1';
          // the server is unreachable: this channel simply stays in the waiting row
          return zooGetJSON('/v1/suggest', report).then(take, function() {});
        }).then(askNext);
      }
      var workers = [];
      for (var w = 0; w < Math.min(ZOO_NOTES_ALL_CONCURRENCY, engines.length); w++) workers.push(askNext());
      return Promise.all(workers).then(function() { return rows; });
    }, function() {
      return [{ engines: [], text: '', message: '(server unreachable after 3 retries)' }];
    });
  }
