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
