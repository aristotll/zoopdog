'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const repoPaths = require('../scripts/lib/paths');
const {buildUserscript, VARIANTS} = require('../scripts/build-cjk-ruby-userscript');
const {readUserscriptVersion, PENDING_VERSION} = require('../scripts/lib/userscript');

test('release and (Local) CJK Ruby builds differ only in name and update location', () => {
  const [release, local] = VARIANTS.map((variant) => buildUserscript(variant));
  const releaseUrl = repoPaths.releaseUrl('cjkRubyUserscript');
  const localUrl = repoPaths.localFileUrl('cjkRubyLocalUserscript');

  assert.match(release, /^\/\/ @name\s+Zoopdog CJK Ruby$/m);
  assert.match(local, /^\/\/ @name\s+Zoopdog CJK Ruby \(Local\)$/m);
  for (const key of ['updateURL', 'downloadURL']) {
    assert.match(release, new RegExp(`^// @${key}\\s+${releaseUrl}$`, 'm'));
    assert.match(local, new RegExp(`^// @${key}\\s+${localUrl}$`, 'm'));
  }
  assert.equal(readUserscriptVersion(release), PENDING_VERSION);
  for (const source of [release, local]) {
    assert.doesNotMatch(source, /__ZOOPDOG_/);
    assert.doesNotThrow(() => new vm.Script(source));
  }
  const body = (source) => source.split('// ==/UserScript==')[1];
  assert.equal(body(release), body(local));
});

test('the CJK Ruby runtime is one fault-tolerant pass that never touches other rubies', () => {
  const source = buildUserscript(VARIANTS[0]);
  assert.match(source, /EXCLUDED_SELECTOR/, 'skips text inside other <ruby>/<rt>, at any depth');
  assert.match(source, /zd-cjk-stacked/, 'katakana reading over, Jyutping under');
  assert.match(source, /ruby-align: space-around/, 'base characters spread to line up with their syllables');
  assert.match(source, /not\(wbr\):not\(ruby\)/, 'the nested reading ruby is ours, never hoisted');
  assert.match(source, /hoistForeign/, 'translations a translator appends inside a ruby are moved out');
  assert.match(source, /zoopdogCjkError/, 'failures are readable from the page');
  assert.match(source, /createScriptURL/, 'Trusted Types pages get a policy for the worker and the library');
  assert.match(source, /@require\s+https:\/\/cdn\.jsdelivr\.net\/npm\/to-jyutping@3\.1\.1/, 'the library is loaded by the manager, outside the page CSP');
  assert.match(source, /requiredLibrary\(\)/, 'the required library is preferred over a worker or eval');
  assert.match(source, /viaFetch/, 'a failing userscript-manager request falls back to fetch');
  assert.match(source, /if \(first === child\) return;/, 'a translator wrapper around the word itself is never hoisted out');
  assert.match(source, /MODE_RULES/, 'the renderer is chosen per site');
  assert.match(source, /hupu\\\.com/, 'hupu uses the overlay renderer');
  assert.match(source, /SITE_FIXES/, 'per-site css and run limits live in one table');
  assert.doesNotMatch(source, /installTapHandlers/, 'the tap mode was removed');
  assert.match(source, /overlayNewRecord/, 'overlay records close over their own record');
  assert.match(source, /GM_registerMenuCommand/, 'the mode can be switched from the userscript menu');
  assert.match(source, /new Worker\(/, 'Jyutping converter runs in a worker');
  assert.match(source, /startMainThreadConverter/, '... with a main-thread fallback');
  assert.match(source, /ENDPOINT_COOLDOWN_MS/, 'a failing endpoint cools down');
  assert.match(source, /cannot align/, 'unalignable batches are split');
  assert.match(source, /textMode/, 'text fallback when ::before cannot be used');
  assert.match(source, /characterData: true/);
  assert.match(source, /shadowRoot/);
});

test('the CJK Ruby runtime caches network labels between pages and falls back when English fails', () => {
  const source = buildUserscript(VARIANTS[0]);
  assert.match(source, /@grant\s+GM_getValue/);
  assert.match(source, /@grant\s+GM_setValue/);
  assert.match(source, /zoopdogCjkLabels:v1/, 'readings and English persist across pages');
  assert.match(source, /function remember\(/, 'only non-empty network labels are stored');
  assert.match(source, /function showFallback\(/, 'local romaji shows while English is unavailable');
  assert.match(source, /solo\.has\(key\)/, 'an empty English batch answer is retried one by one');
  assert.match(source, /function limited\(/, 'requests are capped so a phone is not flooded');
  assert.match(source, /addEventListener\('online', function \(\) \{ interrupt\(\); retryNow\(\); \}\)/, 'coming back online skips the retry back-off');
  assert.match(source, /visibilitychange/, 'returning to the tab skips the retry back-off');

  const start = source.indexOf('    var KANA_ROWS');
  const end = source.indexOf('    var GTX_HOSTS');
  const toRomaji = new Function(source.slice(start, end) + ';return katakanaToRomaji;')();
  assert.equal(toRomaji('アップル'), 'Appuru');
  assert.equal(toRomaji('コーヒー'), 'Kōhī');
  assert.equal(toRomaji('チェック'), 'Chekku');
  assert.equal(toRomaji('abc'), '');
});

test('a page framework that rewrites its text node does not make the ruby wrap pile up', () => {
  const source = buildUserscript(VARIANTS[0]);
  assert.match(source, /var built = new WeakMap\(\)/, 'what was built from a framework-owned text node is remembered');
  assert.match(source, /function dropStale\(node\)/, 'a rewritten node first loses the rubies built from its previous text');
  assert.match(source, /node\.nodeValue === rec\.left/, 'our own split is not mistaken for a rewrite');
});

test('a label-less rt already holds its space and an element rewritten over and over is left alone', () => {
  const source = buildUserscript(VARIANTS[0]);
  assert.match(source, /\.zd-cjk-rt:not\(\[data-rt\]\)::before \{ content: "\\\\00a0"; \}/, 'no second layout jump when the label arrives');
  assert.match(source, /var MAX_REWRAPS = 3/, 'a text node rewritten three times in quick succession is not wrapped again');
  assert.match(source, /var REWRAP_WINDOW_MS = 2000/, 'only rewrites that come quickly one after another count');
  assert.match(source, /if \(isFrozen\(node\)\) return;/, 'a frozen element is skipped by the scan');
});

test('the chatgpt.com sidebar is never annotated, so its rows stop jumping while the list loads', () => {
  const source = buildUserscript(VARIANTS[0]);
  assert.match(source, /chatgpt\\\.com\$\/,\s+exclude: 'nav, aside, header/, 'app chrome is excluded on chatgpt.com');
  assert.match(source, /holder\.closest\(siteFix\.exclude\)/, 'the scan honours the site exclusion');
});

// jsdom is not a dependency of this repository; online-dict (a sibling checkout) has it.
function findJsdom() {
  const fs = require('node:fs');
  const path = require('node:path');
  const candidates = [
    process.env.CDP_JSDOM_DIR,
    path.join(__dirname, '..', '..', 'online-dict', 'node_modules', 'jsdom'),
    '/Users/cheng/mine/online-dict/node_modules/jsdom'
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate));
}

async function withCjkPage(t, html, url, body, variant = VARIANTS[0]) {
  const jsdomPath = findJsdom();
  if (!jsdomPath) return t.skip('jsdom not available');
  const {JSDOM} = require(jsdomPath);
  const source = buildUserscript(variant).split('// ==/UserScript==')[1];
  const dom = new JSDOM(html, {runScripts: 'outside-only', url});
  const w = dom.window;
  w.ToJyutping = {getJyutpingList: (text) => [...text].map((c) => [c, 'zik6'])};
  try {
    await body(w, () => w.eval(source));
  } finally {
    w.close();
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('rewriting a framework-owned text node keeps one ruby (jsdom behaviour)', async (t) => {
  await withCjkPage(t, '<body><span id="fw"></span></body>', 'https://www.youtube.com/', async (w, start) => {
    const holder = w.document.createTextNode('直播');
    w.document.getElementById('fw').appendChild(holder);
    start();
    const rubies = () => w.document.querySelectorAll('#fw ruby').length;
    await sleep(1200);
    assert.equal(rubies(), 1);
    for (let i = 0; i < 3; i++) {
      holder.nodeValue = '直播';
      await sleep(1200);
      assert.ok(rubies() <= 1, 'each render of the page used to add one more');
    }
    await sleep(2600);
    assert.equal(rubies(), 1, 'once the page is quiet the frozen text is annotated again, once');
  });
});

test('a streamed chat answer keeps its ruby: text that only grows is not a rewrite (review finding 1)', async (t) => {
  await withCjkPage(t, '<body><p id="answer"></p></body>', 'https://chatgpt.com/', async (w, start) => {
    const node = w.document.createTextNode('你好');
    w.document.getElementById('answer').appendChild(node);
    start();
    await sleep(1000);
    let text = '你好';
    for (const token of ['，今天', '天气', '很好', '我们', '出去']) {
      text += token;
      node.nodeValue = text;
      await sleep(300);
    }
    await sleep(1200);
    const bases = [...w.document.querySelectorAll('#answer ruby.zd-cjk-ruby')].map((ruby) => ruby.firstChild.textContent);
    assert.deepEqual(bases, ['你好', '今天天气很好我们出去'], 'the finished answer is annotated');
  });
});

test('quick rewrites of the same text freeze it, with one more try once it is quiet (review finding 1)', async (t) => {
  await withCjkPage(t, '<body><p id="msg"></p><p id="other"></p></body>', 'https://example.test/', async (w, start) => {
    const node = w.document.createTextNode('简体');
    w.document.getElementById('msg').appendChild(node);
    start();
    const rubies = (id) => w.document.querySelectorAll('#' + id + ' ruby').length;
    await sleep(800);
    assert.equal(rubies('msg'), 1);
    const flip = async () => {
      for (let i = 0; i < 4; i++) {
        node.nodeValue = i % 2 ? '简体' : '簡體';
        await sleep(600);
      }
    };
    await flip();
    assert.equal(rubies('msg'), 0, 'rewritten again and again: left as the page wants it');
    w.document.getElementById('other').appendChild(w.document.createTextNode('新字'));
    await sleep(800);
    assert.equal(rubies('other'), 1, 'other text is still annotated meanwhile');
    await sleep(2200);
    assert.equal(rubies('msg'), 1, 'quiet for the window: annotated once more');
    await flip();
    await sleep(3000);
    assert.equal(rubies('msg'), 0, 'frozen again after its second chance: stays frozen');
  });
});

async function withFailingEnglish(t, hidden, body) {
  await withCjkPage(t, '<body><p>アップル</p></body>', 'https://example.test/', async (w, start) => {
    const page = {hidden, calls: 0};
    Object.defineProperty(w.document, 'hidden', {get: () => page.hidden});
    w.fetch = () => { page.calls++; return Promise.resolve({ok: false, status: 429, text: () => Promise.resolve('')}); };
    page.returnToTab = () => {
      page.hidden = false;
      w.document.dispatchEvent(new w.Event('visibilitychange'));
    };
    start();
    await sleep(1200);
    await body(page);
  });
}

test('back-off earned by a real refusal is kept when the tab comes back (review finding 7)', async (t) => {
  await withFailingEnglish(t, false, async (page) => {
    const before = page.calls;
    assert.ok(before > 0, 'the word was asked for');
    page.returnToTab();
    await sleep(400);
    page.returnToTab();
    await sleep(400);
    assert.equal(page.calls, before, 'no endpoint is asked again before its back-off ends');
  });
});

test('back-off earned while the tab was hidden is cleared when it comes back (review finding 7)', async (t) => {
  await withFailingEnglish(t, true, async (page) => {
    const before = page.calls;
    assert.ok(before > 0, 'the word was asked for');
    page.returnToTab();
    await sleep(1200);
    assert.ok(page.calls > before, 'the failure in the background is retried at once');
  });
});

function withLocalRules(rules, run) {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zd-cjk-rules-'));
  const file = path.join(dir, 'rules.json');
  fs.writeFileSync(file, JSON.stringify({rules}));
  const saved = process.env.ZOOPDOG_LOCAL_SITE_RULES;
  process.env.ZOOPDOG_LOCAL_SITE_RULES = file;
  return Promise.resolve().then(run).finally(() => {
    if (saved === undefined) delete process.env.ZOOPDOG_LOCAL_SITE_RULES;
    else process.env.ZOOPDOG_LOCAL_SITE_RULES = saved;
    fs.rmSync(dir, {recursive: true, force: true});
  });
}

test('a local rule\'s exclude is honoured, also on a host with a built-in fix (review finding 11)', async (t) => {
  const rules = [
    {host: '(^|\\.)example\\.com$', scripts: ['cjk-ruby'], exclude: 'aside'},
    {host: '(^|\\.)chatgpt\\.com$', scripts: ['cjk-ruby'], exclude: '.sources'}
  ];
  const html = '<body><main><p id="text">中文</p></main><aside><p id="side">侧栏</p></aside>' +
    '<div class="sources"><p id="src">来源</p></div><nav><p id="nav">导航</p></nav></body>';
  const count = (w, id) => w.document.querySelectorAll('#' + id + ' ruby').length;
  await withLocalRules(rules, async () => {
    await withCjkPage(t, html, 'https://www.example.com/', async (w, start) => {
      start();
      await sleep(900);
      assert.equal(count(w, 'text'), 1);
      assert.equal(count(w, 'side'), 0, 'the local exclude reaches the runtime');
      assert.equal(count(w, 'src'), 1, 'another host\'s rule does not apply');
    }, VARIANTS[1]);
    await withCjkPage(t, html, 'https://chatgpt.com/', async (w, start) => {
      start();
      await sleep(900);
      assert.equal(count(w, 'text'), 1);
      assert.equal(count(w, 'src'), 0, 'the local rule extends the built-in chatgpt.com fix');
      assert.equal(count(w, 'nav'), 0, 'the built-in exclusion still applies');
    }, VARIANTS[1]);
  });
});

// Runs the built script in a vm against just enough DOM for its first pass (an empty page), with
// timers that only queue so the rescan timer can be observed.
function runCjkRuntime() {
  const timers = [];
  const listeners = {};
  let nextId = 1;
  const documentStub = {
    body: {},
    documentElement: {dataset: {}},
    head: {appendChild() {}},
    querySelectorAll: () => [],
    createElement: () => ({style: {}, dataset: {}}),
    addEventListener: (type, fn) => { listeners[type] = fn; },
    dispatchEvent() {}
  };
  const state = {observerCallback: null};
  const context = {
    document: documentStub,
    location: {hostname: 'example.test', href: 'https://example.test/'},
    CustomEvent: function CustomEvent() {},
    MutationObserver: class {
      constructor(callback) { state.observerCallback = callback; }
      observe() {}
      takeRecords() { return []; }
    },
    setTimeout: (fn, delay) => { const id = nextId++; timers.push({id, fn, delay}); return id; },
    clearTimeout: (id) => {
      const at = timers.findIndex((timer) => timer.id === id);
      if (at !== -1) timers.splice(at, 1);
    },
    console: {warn() {}, error() {}, log() {}}
  };
  context.window = Object.assign(context, {
    addEventListener: (type, fn) => { listeners['window:' + type] = fn; },
    localStorage: {getItem: () => null}
  });
  vm.createContext(context);
  vm.runInContext(buildUserscript(VARIANTS[0]), context);
  return {
    delays: () => timers.map((timer) => timer.delay),
    // Fires the pending rescan timer once.
    fire: () => { const timer = timers.shift(); timer.fn(); },
    mutate: () => state.observerCallback([]),
    pageshow: () => listeners['window:pageshow'](),
    rescanEvent: () => listeners['zoopdog-cjk-ruby-rescan']()
  };
}

test('the CJK Ruby rescan timer backs off while the page is quiet and wakes on a mutation', () => {
  const run = runCjkRuntime();
  assert.deepEqual(run.delays(), [500]);
  const seen = [];
  for (let i = 0; i < 6; i++) {
    run.fire();
    seen.push(...run.delays());
  }
  assert.deepEqual(seen, [1000, 2000, 4000, 5000, 5000, 5000]);

  run.mutate();
  assert.deepEqual(run.delays(), [500], 'the long wait was replaced by the short one');
  run.mutate();
  assert.deepEqual(run.delays(), [500], 'a mutation at the short interval leaves its timer alone');
  run.fire();
  assert.deepEqual(run.delays(), [1000], 'quiet again, so it backs off again');
});

test('the CJK Ruby rescan timer stays short after a page event that queues work', () => {
  const run = runCjkRuntime();
  for (let i = 0; i < 4; i++) run.fire();
  assert.deepEqual(run.delays(), [5000]);

  run.pageshow();
  assert.deepEqual(run.delays(), [500], 'a restored page is rescanned soon');
  run.fire();
  assert.deepEqual(run.delays(), [500], 'the pass found the queued body, so it keeps the short interval');
  run.fire();
  assert.deepEqual(run.delays(), [1000], 'then nothing is left and it backs off');

  run.fire();
  run.rescanEvent();
  assert.deepEqual(run.delays(), [500]);
});
