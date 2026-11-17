  // A fragment of nom-ruby.runtime.js, moved out of it verbatim (no renames, no body changes).
  // scripts/build-nom-userscript.js inlines it where it used to sit, inside the one IIFE of
  // nom-ruby.runtime.js, so it shares that scope; nothing is exported.
  // Holds: removing, hiding, showing, disabling and re-rendering the annotations, and the toggle button.
  // Relies on shared-IIFE names declared elsewhere:
  // doc, newNodes, changedNodes, injections, enabled, observer, overlay, rescanNow, shadowRootList
  // (nom-ruby.runtime.js), cancelScan and poll (nom-ruby-scan.js).

  // Replaces every ruby this script made with its plain base text.
  function removeAnnotations() {
    cancelScan();
    if (overlay) overlay.clear();
    var roots = [doc].concat(shadowRootList);
    roots.forEach(function(root) {
      var rubies = root.querySelectorAll('ruby.zoopdog-nom-ruby');
      var parents = new Set();
      Array.prototype.forEach.call(rubies, function(ruby) {
        var parent = ruby.parentNode;
        if (!parent) {
          return;
        }
        parent.replaceChild(doc.createTextNode(ruby.firstChild ? ruby.firstChild.nodeValue : ''), ruby);
        parents.add(parent);
      });
      parents.forEach(function(parent) { parent.normalize(); });
    });
    injections = new WeakMap();
    newNodes.clear();
    changedNodes.clear();
  }

  function observeAll() {
    observer.observe(doc.body, {characterData: true, childList: true, subtree: true});
    shadowRootList.forEach(function(root) {
      observer.observe(root, {characterData: true, childList: true, subtree: true});
    });
  }

  // Turning off must feel instant, but unwrapping thousands of rubies does not: so the
  // annotations are first hidden with one tiny <style> per root (a single style recalc), and
  // the real unwrapping runs right after, off the click's critical path.
  var hideStyles = [];
  var removalTimer = null;

  function hideAnnotations() {
    if (overlay) overlay.setHidden(true);
    [doc.documentElement].concat(shadowRootList).forEach(function(root) {
      var style = doc.createElement('style');
      style.textContent = 'ruby.zoopdog-nom-ruby > rt.zoopdog-nom-rt { display: none !important; }';
      root.appendChild(style);
      hideStyles.push(style);
    });
  }

  function showAnnotations() {
    if (overlay) overlay.setHidden(false);
    hideStyles.forEach(function(style) { style.remove(); });
    hideStyles = [];
  }

  function disableAnnotations() {
    enabled = false;
    cancelScan();
    observer.disconnect();
    poll.stop();
    hideAnnotations();
    removalTimer = window.setTimeout(function() {
      removalTimer = null;
      removeAnnotations();
    }, 0);
  }

  // Single click: annotate the page again from scratch (turning it back on if it was off).
  function renderAnnotations() {
    if (enabled) {
      observer.disconnect();
    }
    window.clearTimeout(removalTimer);
    removalTimer = null;
    removeAnnotations();
    showAnnotations();
    enabled = true;
    observeAll();
    newNodes.add(doc.body);
    shadowRootList.forEach(function(root) { newNodes.add(root); });
    rescanNow();
    poll.start();
  }

  // A small fixed button in a closed shadow root (page CSS cannot restyle it, and the
  // attachShadow watcher only follows open roots). Click re-renders, double-click turns off.
  function createToggleButton() {
    var host = doc.createElement('div');
    host.style.cssText = 'all:initial;position:fixed;right:12px;bottom:12px;z-index:2147483647;';
    var root = host.attachShadow({mode: 'closed'});
    var style = doc.createElement('style');
    style.textContent = [
      'button { font: 600 14px/1 sans-serif; width: 36px; height: 36px; border-radius: 50%;',
      '  border: 0; background: #B6638F; color: #fff; cursor: pointer; opacity: .55;',
      '  box-shadow: 0 1px 4px rgba(0,0,0,.35); }',
      'button:hover { opacity: 1; }',
      'button.off { background: #888; }'
    ].join('\n');
    var button = doc.createElement('button');
    button.type = 'button';
    button.textContent = '喃';
    function sync() {
      button.className = enabled ? '' : 'off';
      button.title = 'Zoopdog Nom: ' + (enabled ? 'on' : 'off') +
        ' \u2014 click: render again, double-click: turn off';
    }
    var clickTimer = null;
    button.addEventListener('click', function(event) {
      event.stopPropagation();
      if (clickTimer !== null) {
        return;
      }
      clickTimer = window.setTimeout(function() {
        clickTimer = null;
        renderAnnotations();
        sync();
      }, 250);
    });
    button.addEventListener('dblclick', function(event) {
      event.stopPropagation();
      window.clearTimeout(clickTimer);
      clickTimer = null;
      disableAnnotations();
      sync();
    });
    sync();
    root.appendChild(style);
    root.appendChild(button);
    doc.documentElement.appendChild(host);
  }
