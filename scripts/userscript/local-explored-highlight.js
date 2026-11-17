// A fragment of the -local popup build, moved out of popupdict-local.runtime.js verbatim.
// scripts/build-popupdict-userscript.js concatenates it (LOCAL_RUNTIME_SOURCES) inside the one IIFE of
// popupdict.runtime.js, so it shares that scope; nothing here is exported or imported.
// Holds: reading result links off a search page (hosts, hints, keys), asking the server which are
// explored, painting them, and zooStartExploredHighlight, which keeps them painted.
// Relies on shared-IIFE globals declared elsewhere:
// the engine table and helpers (local-explored-engines.js), zooGetJSON (local-server.js),
// zooDebounce (local-requests.js), zooExploredToolsCreate (local-explored-tools.js), zooShowToast
// (local-modal.js) and zooOpenBlacklistModal / zooBuildModals (local-modal-build.js).

  // A result href is direct (https://site/...) or, on some layouts, google.com/url?q=<target>.
  function zooResultHost(href) {
    try {
      var url = new URL(href);
      if (/(^|\.)google\./.test(url.hostname) && url.pathname === '/url') url = new URL(url.searchParams.get('q') || url.searchParams.get('url'));
      if (/(^|\.)bing\.com$/.test(url.hostname)) { var target = zooBingTarget(url); if (target) url = new URL(target); }
      if (/(^|\.)search\.yahoo\.com$/.test(url.hostname)) {
        var match = url.pathname.match(/\/RU=([^/]+)/i);
        if (match) url = new URL(decodeURIComponent(match[1]));
      }
      return url.hostname;
    } catch (error) {
      return '';
    }
  }

  // Google serves some sessions opaque google.com/goto?url=<token> links (AI overview references, source cards, even the
  // organic results of a signed-out profile): the href names no site, so read it off the page. Hints, in order: the
  // link's aria-label, its short text, and the first lines of the card/result around it (the site-name line, or the
  // visible "https://host › path" line). A hint is a site name or a host; the server decides what it is.
  function zooGotoHints(anchor) {
    var hints = [anchor.getAttribute && anchor.getAttribute('aria-label')];
    var own = String(anchor.textContent || '').trim();
    if (own.length <= 40) hints.push(own);
    var box = anchor.closest && anchor.closest('li, ' + ZOO_EXPLORED_BLOCK);
    var lines = String(box ? (box.innerText || box.textContent || '') : '').split('\n');
    for (var i = 0, taken = 0; i < lines.length && taken < 4; i++) {
      var line = lines[i].trim();
      if (!line) continue;
      taken++;
      if (line.length <= 40) hints.push(line);
      var host = line.match(/(?:https?:\/\/)?((?:[a-z0-9-]+\.)+[a-z]{2,})(?:[\s\/\u203a]|$)/i);
      if (host) hints.push(host[1]);
    }
    return hints;
  }

  // The keys of one link, most specific first: its direct host (not Google's own), then, for an opaque /goto link,
  // the hints read off the page.
  // Within one paint pass (zooKeysPass set) each anchor's keys are worked out once: paint, decorate and pending-keys all ask.
  var zooKeysPass = null;
  function zooAnchorKeys(anchor) {
    if (!zooKeysPass) return zooAnchorKeysCompute(anchor);
    var kept = zooKeysPass.get(anchor);
    if (!kept) { kept = zooAnchorKeysCompute(anchor); zooKeysPass.set(anchor, kept); }
    return kept.slice();
  }

  function zooAnchorKeysCompute(anchor) {
    if (ZOO_ENGINE.id === 'ecosia' && anchor.closest && anchor.closest('.organic-result-feedback__content__links')) return [];
    if (ZOO_ENGINE.id === 'coccoc' && anchor.closest && anchor.closest('[class*="topNavigationBar-"], [class*="OtherSearchEngines-"]')) return [];
    if (ZOO_ENGINE.generic && anchor.closest && anchor.closest('header, nav, footer, [role="navigation"]')) return [];
    var href = anchor.getAttribute('data-zoo-result-url') || anchor.href || anchor.getAttribute('href') || '';
    var host = zooResultHost(href);
    if (ZOO_ENGINE.id === 'coccoc' && host && ZOO_ENGINE.own.test(host) && anchor.closest) {
      var card = anchor.closest('[class*="card_type_"]');
      var addresses = card && card.querySelectorAll ? card.querySelectorAll('a[class*="url-"] span') : [];
      for (var c = 0; c < addresses.length; c++) {
        var destination = String(addresses[c].textContent || '').trim();
        var resolved = /^https?:\/\//i.test(destination) ? zooResultHost(destination) : '';
        if (resolved && !ZOO_ENGINE.own.test(resolved)) { host = resolved; break; }
      }
    }
    if (ZOO_ENGINE.linkTarget && anchor.getAttribute) {
      var linkTarget = zooResultHost(anchor.getAttribute(ZOO_ENGINE.linkTarget) || '');
      if (linkTarget) host = linkTarget;
    }
    // Baidu links are opaque /link?url= redirects; the result container's `mu` attribute holds the real target.
    if (ZOO_ENGINE.target && anchor.closest) {
      var holder = anchor.closest('[' + ZOO_ENGINE.target + ']');
      var direct = holder ? zooResultHost(holder.getAttribute(ZOO_ENGINE.target)) : '';
      if (direct) host = direct;
    }
    if (ZOO_ENGINE.shown && host && ZOO_ENGINE.own.test(host) && anchor.closest) {
      var box = anchor.closest(ZOO_ENGINE.block);
      var leaves = box && box.querySelectorAll ? box.querySelectorAll('span, cite') : [];
      for (var l = 0; l < leaves.length; l++) {
        var shown = !leaves[l].children.length && String(leaves[l].textContent || '').trim().match(/^https?:\/\/([^\s\/]+)/i);
        if (shown) { host = shown[1]; break; }
      }
    }
    var keys = host && !ZOO_ENGINE.own.test(host) ? [host] : [];
    if (href.indexOf('/goto?url=') !== -1) keys = keys.concat(zooGotoHints(anchor));
    return keys.filter(function(key) { return key && String(key).length <= 200; });
  }


  // Keys of the page's links not asked yet.
  function zooPendingKeys(doc, asked) {
    var anchors = doc.querySelectorAll(ZOO_ENGINE.scope);
    var keys = [];
    for (var i = 0; i < anchors.length; i++) {
      var own = zooAnchorKeys(anchors[i]);
      for (var j = 0; j < own.length; j++) {
        if (!asked[own[j]] && keys.indexOf(own[j]) === -1) keys.push(own[j]);
      }
    }
    return keys.slice(0, ZOO_EXPLORED_MAX_KEYS);
  }

  // What gets painted for a link: the whole result block of an organic result, else the link itself.
  function zooExploredBlock(anchor) {
    if (ZOO_ENGINE.id !== 'google') return (ZOO_ENGINE.block && anchor.closest && anchor.closest(ZOO_ENGINE.block)) || anchor;
    var organic = anchor.querySelector && anchor.querySelector('h3, [role="heading"]');
    return organic ? (anchor.closest(ZOO_EXPLORED_BLOCK) || anchor) : anchor;
  }

  function zooPaintExplored(doc, matches) {
    var anchors = doc.querySelectorAll(ZOO_ENGINE.scope);
    var painted = 0;
    // A result block holds several links (title, favicon, site line): one without an answer must not wipe the colour
    // another one of the same block earned, so a block is only cleared when none of its links has an answer.
    var live = [];
    for (var j = 0; j < anchors.length; j++) {
      try {
        var own = zooAnchorKeys(anchors[j]);
        for (var m = 0; m < own.length; m++) {
          if (matches[own[m]]) { live.push(zooExploredBlock(anchors[j])); break; }
        }
      } catch (error) { /* one odd result must not stop the rest */ }
    }
    for (var i = 0; i < anchors.length; i++) {
      try {
        var anchor = anchors[i];
        var ai = ZOO_ENGINE.id === 'google'
          ? !anchor.querySelector || !anchor.querySelector('h3, [role="heading"]')
          : !(ZOO_ENGINE.block && anchor.closest && anchor.closest(ZOO_ENGINE.block));
        var entry = null;
        var keys = zooAnchorKeys(anchor);
        for (var k = 0; k < keys.length && !entry; k++) entry = matches[keys[k]] || null;
        // An AI-panel reference is a small chip/inline link: outline the link itself instead of a whole block.
        var block = zooExploredBlock(anchor);
        if (ai && !entry && !block.dataset.zooExplored) continue;
        if (!entry) {
          if (block.dataset.zooExplored && live.indexOf(block) === -1) { block.style.background = ''; block.style.mixBlendMode = ''; block.style.outline = ''; block.title = ''; delete block.dataset.zooExplored; }
          continue;
        }
        // Organic results get a plain background (it lies under the text). A headingless link is often a transparent overlay
        // above a chip or card: a plain fill hid what is under it (measured: an empty green block).
        // `multiply` tints what lies under the overlay instead of covering it, so chip text stays readable.
        if (ai) { block.style.background = entry.color; block.style.mixBlendMode = 'multiply'; block.style.outline = '2px solid ' + entry.color; block.style.outlineOffset = '-1px'; block.style.borderRadius = '6px'; }
        else block.style.background = entry.color;
        // These sites force citation backgrounds and outlines with !important.
        if ((ZOO_ENGINE.id === 'gibiru' || ZOO_ENGINE.id === 'brave-ai' || ZOO_ENGINE.id === 'brave') && block.style.setProperty) {
          block.style.setProperty('background', entry.color, 'important');
          block.style.setProperty('outline', '2px solid ' + entry.color, 'important');
        }
        block.title = entry.label;
        block.dataset.zooExplored = '1';
        painted++;
      } catch (error) { /* one odd result must not stop the rest */ }
    }
    return painted;
  }

  // Tolerance: the page is painted from the last good copy at once (localStorage), the first fetch is retried with
  // growing delays instead of waiting a minute, results are repainted on mutations, on a timer (Google swaps its
  // result block without a reload), and when the tab is shown again; the /search check is made at paint time, not
  // once, and any failure is swallowed so the next tick tries again.
  var ZOO_EXPLORED_CACHE_KEY = 'zooExploredMatches';
  var ZOO_EXPLORED_RETRY_MS = [1500, 3000, 6000, 12000, 24000];
  var ZOO_EXPLORED_REPAINT_MS = 2500;

  function zooExploredCacheRead() {
    try { return JSON.parse(localStorage.getItem(ZOO_EXPLORED_CACHE_KEY)) || null; } catch (error) { return null; }
  }

  function zooExploredCacheWrite(state) {
    try { localStorage.setItem(ZOO_EXPLORED_CACHE_KEY, JSON.stringify({version: state.version, matches: state.matches})); } catch (error) { /* quota/private mode */ }
  }

  function zooStartExploredHighlight(doc, loc) {
    doc = doc || document;
    loc = loc || (typeof location === 'undefined' ? null : location);
    var engine = loc ? zooSearchEngineFor({hostname: loc.hostname, pathname: loc.pathname || '/search', search: loc.search || ''}) || (/(^|\.)google\.[a-z.]+$/.test(loc.hostname) ? ZOO_SEARCH_ENGINES[0] : null) : null;
    if (!engine) return Promise.resolve(false);
    ZOO_ENGINE = engine;
    var cached = zooExploredCacheRead();
    var state = {version: cached && cached.version || '', matches: cached && cached.matches ? cached.matches : {}, asked: {}, loaded: false};
    Object.keys(state.matches).forEach(function(key) { state.asked[key] = true; });
    var ask = function() {
      // Nothing is asked before the server has answered once: then the version is known and failures need no retry here.
      var keys = state.loaded ? zooPendingKeys(doc, state.asked) : [];
      if (!keys.length) return;
      keys.forEach(function(key) { state.asked[key] = true; });
      zooGetJSON('/v1/explored-sites/match', {keys: JSON.stringify(keys)}).then(function(data) {
        Object.keys(data.matches || {}).forEach(function(key) { state.matches[key] = data.matches[key]; });
        zooExploredCacheWrite(state);
        zooPaintExplored(doc, state.matches);
      }, function() {});
    };
    var paintNow = function() {
      if (doc.hidden) return; // a background tab repaints when it is shown again (visibilitychange)
      zooKeysPass = typeof WeakMap === 'function' ? new WeakMap() : null;
      try {
        if (!zooIsSearchPage(loc)) return;
        zooPaintExplored(doc, state.matches);
        decorateAll();
        ask();
      } catch (error) { /* retry on next tick */ } finally { zooKeysPass = null; }
    };
    var paint = zooDebounce(paintNow, 150);
    // Ask again for these keys only, ignoring what was asked or answered before (the refresh button, and after a blacklist).
    var requery = function(keys) {
      keys.forEach(function(key) { delete state.asked[key]; delete state.matches[key]; });
      return zooGetJSON('/v1/explored-sites/match', {keys: JSON.stringify(keys)}).then(function(data) {
        keys.forEach(function(key) { state.asked[key] = true; });
        Object.keys(data.matches || {}).forEach(function(key) { state.matches[key] = data.matches[key]; });
        zooExploredCacheWrite(state);
        zooPaintExplored(doc, state.matches);
        return keys.filter(function(key) { return state.matches[key]; }).length;
      });
    };
    var tools = zooExploredToolsCreate({
      doc: doc,
      headingOf: function(anchor) {
        return ZOO_ENGINE.id === 'google' || !anchor.closest ? null : anchor.closest('h1, h2, h3, h4, [role="heading"]');
      },
      eligible: function(anchor) {
        return zooIsSearchPage(loc) && zooAnchorKeys(anchor).length > 0;
      },
      // Refresh is a manual retry for the whole page: every link still without colour is asked again, not only the one clicked.
      refresh: function(anchor) {
        var keys = zooAnchorKeys(anchor);
        var anchors = doc.querySelectorAll(ZOO_ENGINE.scope);
        for (var i = 0; i < anchors.length && keys.length < ZOO_EXPLORED_MAX_KEYS; i++) {
          if (zooExploredBlock(anchors[i]).dataset.zooExplored) continue;
          zooAnchorKeys(anchors[i]).forEach(function(key) { if (keys.indexOf(key) === -1 && keys.length < ZOO_EXPLORED_MAX_KEYS) keys.push(key); });
        }
        return requery(keys).then(function(found) {
          zooBuildModals();
          zooShowToast(found ? 'Refreshed ' + keys.length + ' site(s): ' + found + ' now coloured' : 'Refreshed ' + keys.length + ' site(s): none explored yet');
        }, function(error) {
          zooBuildModals();
          zooShowToast(error.message || 'Could not reach the reader server');
        });
      },
      blacklist: function(anchor) {
        var keys = zooAnchorKeys(anchor);
        // The link's own host first; a name hint ("Tuổi Trẻ") is no host, so then the field starts empty.
        var host = keys.filter(function(key) { return /^[^\s]+\.[a-z]{2,}$/i.test(key); })[0] || '';
        tools.hide();
        zooOpenBlacklistModal(host, function() { requery(keys).catch(function() {}); });
      }
    });
    // The inline buttons of every organic result that has keys (the hover pill covers the other links); idempotent, so it runs with every repaint.
    var decorateAll = function() {
      var anchors = doc.querySelectorAll(ZOO_ENGINE.scope);
      for (var i = 0; i < anchors.length; i++) {
        try { if (zooAnchorKeys(anchors[i]).length) tools.decorate(anchors[i]); } catch (error) { /* one odd result must not stop the rest */ }
      }
    };
    var attempt = function(n) {
      return zooGetJSON('/v1/explored-sites/match', {keys: '[]'}).then(function(data) {
        state.loaded = true;
        if (data.version === state.version) { paintNow(); return; }
        state.version = data.version;
        state.matches = {}; state.asked = {};
        zooExploredCacheWrite(state);
        paintNow();
      }, function() {
        if (n < ZOO_EXPLORED_RETRY_MS.length) setTimeout(function() { attempt(n + 1); }, ZOO_EXPLORED_RETRY_MS[n]);
      });
    };
    var refresh = function() { return attempt(ZOO_EXPLORED_RETRY_MS.length); };
    var root = doc.body || doc.documentElement;
    if (doc.body) tools.attach();
    if (typeof MutationObserver === 'function' && root) new MutationObserver(paint).observe(root, {childList: true, subtree: true});
    if (doc.addEventListener) {
      doc.addEventListener('visibilitychange', function() { if (!doc.hidden) { refresh(); paint(); } });
    }
    setInterval(refresh, ZOO_EXPLORED_REFRESH_MS);
    setInterval(paintNow, ZOO_EXPLORED_REPAINT_MS);
    paintNow();
    return attempt(0).then(function() { return true; });
  }
