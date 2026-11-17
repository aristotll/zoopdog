// A fragment of the -local popup build, moved out of popupdict-local.runtime.js verbatim.
// scripts/build-popupdict-userscript.js concatenates it (LOCAL_RUNTIME_SOURCES) inside the one IIFE of
// popupdict.runtime.js, so it shares that scope; nothing here is exported or imported.
// Holds: the explored-link constants, the ZOO_SEARCH_ENGINES layout table (plus the generic engine rows
// added to it), ZOO_ENGINE for the page shown, and the helpers that pick the engine for a location.
// Relies on shared-IIFE globals declared elsewhere:
// nothing outside this file; it only declares data and functions that local-explored-highlight.js
// reads later.

  // -- Google results: colour links to sites book-translator has already explored --
  // This code only READS the page and PAINTS. What counts as explored (exact domain, alias, same-brand guess, site
  // name) is decided by the server: every link is turned into keys (its host; for opaque /goto links also the hints
  // read off the page) and sent to `GET /v1/explored-sites/match?keys=<json list>` (scripts/explored_sites.py
  // `match_keys`), which answers the finished {label, color} per key. Each key is asked once; a new index version
  // (polled every minute) drops the answers and asks again, so a new plugin/alias/blacklist entry shows without a reload.

  var ZOO_EXPLORED_REFRESH_MS = 60000;
  var ZOO_EXPLORED_BLOCK = 'div.g, div.MjjYud, div[data-hveid], li';
  var ZOO_EXPLORED_MAX_KEYS = 100;

  // The search engines whose result pages are coloured, measured on the live pages (docs/research/search_engines_explored/).
  // Only LAYOUT is described here (where the results are, what one result block is, how to read the real target
  // off a redirect link); what counts as explored stays on the server. `own`: the engine's own hosts, never a key.
  // `block` null = no stable wrapper (hashed class names): the link itself is painted. Yandex and Sogou show a bot check
  // to a profile that never passed it and Kagi needs a login: a profile that did both is read like the others.
  var ZOO_SEARCH_ENGINES = [
    {id: 'google', host: /(^|\.)google\.[a-z.]+$/, path: /^\/search$/, own: /(^|\.)(google\.[a-z.]+|gstatic\.com)$/,
      scope: '#search a[href], #rso a[href], [role="main"] a[href], #main a[href]', block: 'div.g, div.MjjYud, div[data-hveid], li'},
    {id: 'bing', host: /(^|\.)bing\.com$/, path: /^\/search$/, own: /(^|\.)(bing\.com|microsoft\.com)$/,
      scope: '#b_results a[href]', block: 'li.b_algo, li.b_ans'},
    {id: 'duckduckgo', host: /(^|\.)duckduckgo\.com$/, path: /^\/$/, own: /(^|\.)duckduckgo\.com$/,
      scope: '#web_content_wrapper a[href]', block: '[data-testid="result"]'},
    {id: 'yahoo', host: /^(?:(?:tw|hk)\.)?search\.yahoo\.com$/, path: /^\/search/, own: /(^|\.)yahoo\.com$/,
      scope: '#web a[href]', block: '#web ol > li'},
    {id: 'yahoo-jp', host: /^search\.yahoo\.co\.jp$/, path: /^\/search/, own: /(^|\.)yahoo\.co\.jp$/,
      scope: '.Contents__inner a[href]', block: '.sw-Card.Algo'},
    {id: 'baidu', host: /(^|\.)baidu\.com$/, path: /^\/s$/, own: /(^|\.)baidu\.com$/,
      scope: '#content_left a[href]', block: '#content_left .c-container', target: 'mu'},
    {id: 'brave', host: /^search\.brave\.com$/, path: /^\/search$/, own: /(^|\.)brave\.com$/,
      scope: '#mixed-main a[href]', block: '#mixed-main .snippet'},
    {id: 'ecosia', host: /(^|\.)ecosia\.org$/, path: /^\/search$/, own: /(^|\.)ecosia\.org$/,
      scope: 'article.result a[href]', block: 'article.result'},
    {id: 'startpage', host: /(^|\.)startpage\.com$/, path: /^\/do\/search|^\/sp\/search/, own: /(^|\.)startpage\.com$/,
      scope: '.w-gl a[href]', block: '.w-gl .result'},
    {id: 'qwant', host: /(^|\.)qwant\.com$/, path: /^\/$/, own: /(^|\.)qwant\.com$/,
      scope: '[data-testid="webResult"] a[href]', block: '[data-testid="webResult"]'},
    {id: 'yandex', host: /(^|\.)yandex\.[a-z.]+$/, path: /^\/search\/?$/, own: /(^|\.)(yandex\.[a-z.]+|ya\.ru|yastatic\.net)$/,
      scope: 'main a[href], #inter-search-additional-content a[href]', block: 'li:has(> .Organic)'},
    // Sogou's links are sogou.com/link?url= redirects; the result shows its real address in a leaf span (`shown`).
    {id: 'sogou', host: /(^|\.)sogou\.com$/, path: /^\/web/, own: /(^|\.)(sogou\.com|sogoucdn\.com)$/,
      scope: '.results a[href]', block: '.vrwrap, .rb', shown: true},
    {id: 'kagi', host: /(^|\.)kagi\.com$/, path: /^\/search/, own: /(^|\.)kagi\.com$/,
      scope: '#main a[href]', block: '._0_SRI, .__srgi'},
    {id: 'naver', host: /^search\.naver\.com$/, path: /^\/search\.naver$/, own: /(^|\.)naver\.(com|net)$/,
      scope: '#main_pack a[href]', block: null},
    {id: 'seznam', host: /^search\.seznam\.cz$/, path: /^\/$/, own: /(^|\.)(seznam\.cz|zbozi\.cz|mapy\.com|firmy\.cz)$/,
      scope: '[data-e-b-z="main"] a[href]', block: null},
    {id: 'so360', host: /^www\.so\.com$/, path: /^\/s$/, own: /(^|\.)(so\.com|360\.cn|360\.com)$/,
      scope: '#main .res-list a[href]', block: 'li.res-list', linkTarget: 'data-mdurl'}
  ];
  // Additional search and answer pages: keep the match local to known hosts and paths.
  // Generic layouts paint citations individually; exclude navigation/footer links in zooAnchorKeys.
  [
    ['daum', 'search.daum.net', /^\/(search|nate)/], ['nate', 'search.nate.com', /^\/search/],
    ['toutiao', 'so.toutiao.com', /^\/search/], ['coccoc', 'coccoc.com', /^\/search/],
    ['onet', 'szukaj.onet.pl', /^\/wyniki/], ['mojeek', 'www.mojeek.com', /^\/search/],
    ['swisscows', 'swisscows.com', /^\/(?:[a-z]{2}\/)?web/], ['lilo', 'search.lilo.org', /^\/$/],
    ['metager', 'metager.org', /^\/(?:meta|$)/], ['searxng', 'searx.rhscz.eu', /^\/search/],
    ['marginalia', 'marginalia-search.com', /^\/search/], ['marginalia-old', 'search.marginalia.nu', /^\/search/],
    ['oceanhero', 'oceanhero.today', /^\/web/], ['searchch', 'search.ch', /^\/$/],
    ['najdi', 'www.najdi.si', /^\/(?:search|$)/], ['wiby', 'wiby.me', /^\/$/],
    ['yep', 'yep.com', /^\/web/], ['you', 'you.com', /^\/search/], ['presearch', 'presearch.com', /^\/search/],
    ['metacrawler', 'www.metacrawler.com', /^\/search/], ['gibiru', 'gibiru.com', /^\/results/],
    ['privacywall', 'www.privacywall.org', /^\/search/], ['sapo', 'pesquisa.sapo.pt', /^\//],
    ['rambler', 'nova.rambler.ru', /^\/search/], ['mailru', 'go.mail.ru', /^\/search/],
    ['gerdoo', 'gerdoo.me', /^\/search/], ['zum', 'search.zum.com', /^\/search/],
    ['uol', 'busca.uol.com.br', /^\/web/], ['terra-br', 'buscador.terra.com.br', /^\//],
    ['terra-cl', 'buscador.terra.cl', /^\//], ['tiscali', 'search.tiscali.it', /^\//],
    ['bing-ai', 'www.bing.com', /^\/copilotsearch/], ['so360-ai', 'ai.so.com', /^\/search/],
    ['yahoo-jp-ai', 'search.yahoo.co.jp', /^\/chat(?:\/|$)/],
    ['brave-ai', 'search.brave.com', /^\/ask/], ['duck-ai', 'duck.ai', /^\/chat/],
    ['felo', 'felo.ai', /^\/search/], ['perplexity', 'www.perplexity.ai', /^\/search/],
    ['grok', 'grok.com', /^\//], ['aihay', 'ai-hay.vn', /^\//], ['phind', 'www.phind.com', /^\/search/],
    ['doubao', 'www.doubao.com', /^\/chat/], ['metaso', 'metaso.cn', /^\/(?:search|chat|$)/],
    ['kimi', 'kimi.moonshot.cn', /^\//], ['kimi-current', 'www.kimi.com', /^\//],
    ['baidu-ai', 'chat.baidu.com', /^\/search/], ['wenxin', 'wenxin.baidu.com', /^\/search/],
    ['zhida', 'zhida.zhihu.com', /^\//], ['deepseek', 'chat.deepseek.com', /^\//],
    ['qwen', 'chat.qwen.ai', /^\//], ['yuanbao', 'yuanbao.tencent.com', /^\/chat/]
  ].forEach(function(row) {
    var host = row[1].replace(/^www\./, '');
    var escaped = host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    var related = {'so360-ai': /(^|\.)(so\.com|360\.cn|360\.com)$/,
      'bing-ai': /(^|\.)(bing\.com|microsoft\.com)$/,
      'brave-ai': /(^|\.)brave\.com$/, 'baidu-ai': /(^|\.)baidu\.com$/,
      'yahoo-jp-ai': /(^|\.)yahoo\.co\.jp$/,
      wenxin: /(^|\.)baidu\.com$/, zhida: /(^|\.)zhihu\.com$/};
    ZOO_SEARCH_ENGINES.push({id: row[0], host: new RegExp('^(?:www\\.)?' + escaped + '$'), path: row[2],
      own: related[row[0]] || new RegExp('(^|\\.)' + escaped + '$'),
      scope: row[0] === 'metaso' ? 'a[href], .search-origin-box[data-zoo-result-url]' : 'a[href]', block: null, generic: true});
  });
  // The engine of the page shown (null = not a search page we colour); tests and the Google-only helpers default to Google.
  var ZOO_ENGINE = ZOO_SEARCH_ENGINES[0];

  var ZOO_BING_COPILOT_FRAME = {id: 'bing-copilot-frame', own: /(^|\.)(bing\.com|microsoft\.com)$/,
    scope: 'a[href]', block: null, generic: true};

  function zooSearchEngineFor(loc) {
    if (/(^|\.)bing\.com$/.test(loc.hostname) && loc.pathname === '/search' &&
        /(?:^|[?&])cpltsrchif=1(?:&|$)/.test(loc.search || '')) return ZOO_BING_COPILOT_FRAME;
    for (var i = 0; i < ZOO_SEARCH_ENGINES.length; i++) {
      var engine = ZOO_SEARCH_ENGINES[i];
      if (engine.host.test(loc.hostname) && engine.path.test(loc.pathname)) return engine;
    }
    return null;
  }

  function zooIsSearchPage(loc) {
    var engine = zooSearchEngineFor(loc);
    return !!engine && engine === ZOO_ENGINE;
  }

  // Bing's result links are bing.com/ck/a?...&u=a1<base64url of the target>: decode the target.
  function zooBingTarget(url) {
    var u = url.searchParams.get('u') || '';
    if (url.pathname !== '/ck/a' || u.indexOf('a1') !== 0) return '';
    try { return atob(u.slice(2).replace(/-/g, '+').replace(/_/g, '/')); } catch (error) { return ''; }
  }
