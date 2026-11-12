// MetaSo renders source cards as clickable divs, not anchors. Its page keeps the
// original source URL in the card's React props; expose only that URL in the DOM
// so the sandboxed local highlighter can use its usual server matching/controls.
function zooMetaSoPageBridge() {
  function expose() {
    var cards = document.querySelectorAll('.search-origin-box');
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      var key = Object.keys(card).filter(function(name) { return name.indexOf('__reactFiber$') === 0; })[0];
      var fiber = key && card[key];
      for (var depth = 0; fiber && depth < 16; depth++, fiber = fiber.return) {
        var props = fiber.memoizedProps;
        var url = props && props.item && props.item.titleLinkUrl;
        if (typeof url !== 'string') continue;
        try {
          var parsed = new URL(url);
          if ((parsed.protocol === 'http:' || parsed.protocol === 'https:') && card.getAttribute('data-zoo-result-url') !== parsed.href) {
            card.setAttribute('data-zoo-result-url', parsed.href);
          }
        } catch (error) { /* ignore invalid or non-HTTP sources */ }
        break;
      }
    }
  }
  expose();
  if (document.documentElement && typeof MutationObserver === 'function') {
    new MutationObserver(expose).observe(document.documentElement, {childList: true, subtree: true});
  }
  setInterval(expose, 2500);
}

function zooInstallMetaSoSourceBridge() {
  if (window.location.hostname !== 'metaso.cn') return;
  var script = document.createElement('script');
  script.textContent = '(' + zooMetaSoPageBridge.toString() + ')();';
  (document.head || document.documentElement).appendChild(script);
  script.remove();
}
