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
  assert.match(source, /addEventListener\('online', retryNow\)/, 'coming back online skips the retry back-off');
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
  assert.match(source, /var MAX_REWRAPS = 3/, 'an element re-rendered more than three times is not wrapped again');
  assert.match(source, /if \(isFrozen\(node\)\) return;/, 'a frozen element is skipped by the scan');
});

test('the chatgpt.com sidebar is never annotated, so its rows stop jumping while the list loads', () => {
  const source = buildUserscript(VARIANTS[0]);
  assert.match(source, /chatgpt\\\.com\$\/,\s+exclude: 'nav, aside, header/, 'app chrome is excluded on chatgpt.com');
  assert.match(source, /holder\.closest\(siteFix\.exclude\)/, 'the scan honours the site exclusion');
});

test('rewriting a framework-owned text node keeps one ruby (jsdom behaviour)', async (t) => {
  const fs = require('node:fs');
  const jsdomPath = process.env.CDP_JSDOM_DIR || '/Users/cheng/mine/online-dict/node_modules/jsdom';
  if (!fs.existsSync(jsdomPath)) return t.skip('jsdom not available');
  const {JSDOM} = require(jsdomPath);
  const source = buildUserscript(VARIANTS[0]).split('// ==/UserScript==')[1];
  const dom = new JSDOM('<body><span id="fw"></span></body>', {runScripts: 'outside-only', url: 'https://www.youtube.com/'});
  const w = dom.window;
  w.ToJyutping = {getJyutpingList: (text) => [...text].map((c) => [c, 'zik6'])};
  const holder = w.document.createTextNode('直播');
  w.document.getElementById('fw').appendChild(holder);
  w.eval(source);
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const rubies = () => w.document.querySelectorAll('#fw ruby').length;
  await sleep(1200);
  assert.equal(rubies(), 1);
  for (let i = 0; i < 3; i++) {
    holder.nodeValue = '直播';
    await sleep(1200);
  }
  assert.equal(rubies(), 1, 'each render of the page used to add one more');
  w.close();
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
