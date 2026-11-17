// Popup userscript: rendering a dictionary entry to HTML -- renderDefinition*, the CJK token
// helpers, escapeHtml, and zooSetHTML with its Trusted Types policy.
// A fragment, not a standalone script: scripts/build-popupdict-userscript.js concatenates it into
// the popup userscript's single IIFE (PUBLIC_RUNTIME_SOURCES), so it shares that scope. It relies
// on ZOO_SETTINGS (popupdict.runtime.js), zooBuildSafeFragment (safe-html.js),
// zooRenderNomReviewAction (popup-nom-review.js) and zooLocal (popupdict.runtime.js: the local
// runtime's extension object, null in the public build). Moved out of popupdict.runtime.js;
// see docs/runtime-boundaries.md.

  var ZOO_CJK_RE = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u{20000}-\u{323AF}]/u;
  var ZOO_CJK_SEQUENCE_RE = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u{20000}-\u{323AF}]+/gu;

  // Sites that opt into a Trusted Types CSP (YouTube among them) throw
  // "Failed to set the 'innerHTML' property ... requires 'TrustedHTML'
  // assignment" on a plain string assignment, which aborted mainListener
  // before popup.show() ever ran -- the popup looked "impossible to show"
  // on those sites when the actual failure was this uncaught exception.
  // Every caller here already builds its HTML through escapeHtml, so the
  // policy is a pass-through, not a sanitizer.
  var zooTrustedTypesPolicy;

  function zooSetHTML(el, html) {
    if (typeof zooTrustedTypesPolicy === 'undefined') {
      zooTrustedTypesPolicy = null;
      if (typeof window.trustedTypes !== 'undefined' && window.trustedTypes.createPolicy) {
        try {
          zooTrustedTypesPolicy = window.trustedTypes.createPolicy('zoopdog-userscript', {
            createHTML: function(value) { return value; }
          });
        } catch (error) {
          zooTrustedTypesPolicy = null;
        }
      }
    }

    try {
      el.innerHTML = zooTrustedTypesPolicy ? zooTrustedTypesPolicy.createHTML(html) : html;
    } catch (error) {
      // Some sites forbid all named policies. Build the known, escaped templates with DOM
      // methods instead of assigning a string to a Trusted Types sink.
      if (zooTrustedTypesPolicy || !window.trustedTypes || error.name !== 'TypeError') throw error;
      var fragment = zooBuildSafeFragment(el.ownerDocument || document, html);
      while (el.firstChild) el.removeChild(el.firstChild);
      el.appendChild(fragment);
    }
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function renderDefinition(entry) {
    // `entry` is `[headwords, senses]` -- see scripts/build-popupdict-userscript.js and the
    // shared grouping transform in scripts/lib/dictionary-identity.js. `headwords` is every
    // display variant a normalized key collided on (`Ba Lê` / `ba lê`), ordered by first
    // source occurrence; `vn` (the primary headword) is `headwords[0]` and is what a local
    // "add Chu Nom"/"set order" action still keys on.
    var headwords = entry[0];
    var definitions = entry[1];
    var vn = headwords[0];

    return [
      '<div class="zd-definition">',
      '<h1>', headwords.map(escapeHtml).join(' / '), '</h1>',
      '<ul>',
      renderDefinitionItems(definitions),
      '</ul>',
      zooLocal ? zooLocal.renderActions(vn) : zooRenderNomReviewAction(vn),
      '</div>'
    ].join('');
  }

  function renderDefinitionItems(definitions) {
    var html = [];
    var pendingCjkTokens = [];

    function flushCjkTokens() {
      if (!pendingCjkTokens.length) {
        return;
      }

      chunkCjkTokens(pendingCjkTokens).forEach(function(chunk) {
        html.push('<li class="zoopdog-cjk-def">' + chunk.map(escapeHtml).join(' | ') + '</li>');
      });
      pendingCjkTokens = [];
    }

    definitions.forEach(function(item) {
      if (isCjkDefinition(item)) {
        pendingCjkTokens = pendingCjkTokens.concat(extractCjkTokens(item[0]));
        pendingCjkTokens = [...new Set(pendingCjkTokens)];
        return;
      }

      flushCjkTokens();
      html.push(renderDefinitionItem(item));
    });

    flushCjkTokens();
    return html.join('');
  }

  function isCjkDefinition(item) {
    return !item[1] && ZOO_CJK_RE.test(item[0]) && !/[A-Za-z]/.test(item[0]);
  }

  function extractCjkTokens(value) {
    return [...new Set(String(value || '').match(ZOO_CJK_SEQUENCE_RE) || [])];
  }

  function chunkCjkTokens(tokens) {
    var chunks = [];
    var current = [];
    var currentLength = 0;

    tokens.forEach(function(token) {
      var tokenLength = [...token].length;
      var extraLength = current.length ? tokenLength + 3 : tokenLength;

      if (current.length && currentLength + extraLength > ZOO_SETTINGS.cjkDefinitionLineLength) {
        chunks.push(current);
        current = [];
        currentLength = 0;
        extraLength = tokenLength;
      }

      current.push(token);
      currentLength += extraLength;
    });

    if (current.length) {
      chunks.push(current);
    }

    return chunks;
  }

  function renderDefinitionItem(item) {
    var definition = escapeHtml(item[0]);
    var pos = escapeHtml(item[1]);
    var headword = item[2] ? escapeHtml(item[2]) : '';
    var prefix = headword ? '<span class="zoopdog-headword">' + headword + '</span>' : '';
    if (pos) {
      prefix += '<span class="zoopdog-pos">' + pos + '</span> ';
    }
    return '<li>' + prefix + definition + '</li>';
  }
