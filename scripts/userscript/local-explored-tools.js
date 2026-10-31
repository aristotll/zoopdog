  // Tools for Google links, in two forms that share the same two buttons. (1) A hover pill for a link that stayed uncoloured:
  // one floating pill (built once, never inside Google's DOM layout). (2) Always-present inline buttons after the title of
  // every search result, coloured or not (`decorate`). The buttons are "refresh" (ask the server again whether the site is explored) and "blacklist" (open the modal that
  // appends it to book-translator's docs/explored_sites_blacklist.json). It only draws and routes clicks; what a
  // link's keys are, whether it is already coloured and what the buttons do are injected:
  //   deps = {doc, eligible(anchor) -> bool, refresh(anchor), blacklist(anchor)}
  // Returns {attach, hide, decorate}. `attach` listens on the document, so links Google adds later work without rewiring.
  // `decorate(anchor)` is idempotent: the runtime calls it on every repaint, so a result Google re-renders gets its inline
  // buttons back and one that still has them is left alone.
  var ZOO_EXPLORED_TOOLS_HIDE_MS = 450;
  var ZOO_EXPLORED_INLINE_CLASS = 'zd-explored-inline';

  function zooExploredToolsCreate(deps) {
    var doc = deps.doc;
    var pill = null;
    var current = null;
    var hideTimer = null;

    var REFRESH_LABEL = '↻';
    var REFRESH_TITLE = 'Ask the server again: is this site explored? Colours the link when it is.';
    var BLACKLIST_LABEL = '⛔';
    var BLACKLIST_TITLE = 'Blacklist this site: no need to explore it';

    function cancelHide() { clearTimeout(hideTimer); }

    function hide() {
      cancelHide();
      current = null;
      if (pill) pill.hidden = true;
    }

    function scheduleHide() {
      cancelHide();
      hideTimer = setTimeout(hide, ZOO_EXPLORED_TOOLS_HIDE_MS);
    }

    function button(label, title, action, anchorOf) {
      var node = doc.createElement('button');
      node.type = 'button';
      node.className = 'zd-explored-tools-button';
      node.title = title;
      node.textContent = label;
      node.addEventListener('mousedown', function(event) { event.stopPropagation(); });
      node.addEventListener('click', function(event) {
        event.preventDefault();
        event.stopPropagation();
        var anchor = anchorOf();
        if (anchor) action(anchor);
      });
      return node;
    }

    function build() {
      pill = doc.createElement('div');
      pill.className = 'zd-explored-tools';
      pill.hidden = true;
      pill.appendChild(button(REFRESH_LABEL, REFRESH_TITLE, function(anchor) { deps.refresh(anchor); }, function() { return current; }));
      pill.appendChild(button(BLACKLIST_LABEL, BLACKLIST_TITLE, function(anchor) { deps.blacklist(anchor); }, function() { return current; }));
      pill.addEventListener('mouseenter', cancelHide);
      pill.addEventListener('mouseleave', scheduleHide);
      doc.body.appendChild(pill);
    }

    function show(anchor) {
      if (!pill) build();
      var rect = anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : {top: 0, right: 0, left: 0};
      var view = doc.defaultView || {};
      var width = view.innerWidth || 1200;
      pill.style.top = Math.max(0, rect.top) + 'px';
      pill.style.left = Math.max(0, Math.min(rect.right, width) - 64) + 'px';
      pill.hidden = false;
    }

    function onOver(event) {
      var anchor = event.target && event.target.closest && event.target.closest('a[href]');
      if (!anchor) { if (current) scheduleHide(); return; }
      cancelHide();
      if (anchor === current) return;
      if (!deps.eligible(anchor)) { if (current) scheduleHide(); return; }
      current = anchor;
      show(anchor);
    }

    function decorate(anchor) {
      var heading = anchor.querySelector && anchor.querySelector('h3, [role="heading"]');
      if (!heading || heading.querySelector('.' + ZOO_EXPLORED_INLINE_CLASS)) return false;
      var box = doc.createElement('span');
      box.className = ZOO_EXPLORED_INLINE_CLASS;
      box.appendChild(button(REFRESH_LABEL, REFRESH_TITLE, function(a) { deps.refresh(a); }, function() { return anchor; }));
      box.appendChild(button(BLACKLIST_LABEL, BLACKLIST_TITLE, function(a) { deps.blacklist(a); }, function() { return anchor; }));
      heading.appendChild(box);
      return true;
    }

    return {
      decorate: decorate,
      attach: function() {
        doc.addEventListener('mouseover', onOver);
        // A scroll moves the link away from the pill; the next hover shows it again.
        doc.addEventListener('scroll', hide, true);
      },
      hide: hide
    };
  }
