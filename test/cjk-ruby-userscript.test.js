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
  assert.match(source, /new Worker\(/, 'Jyutping converter runs in a worker');
  assert.match(source, /startMainThreadConverter/, '... with a main-thread fallback');
  assert.match(source, /ENDPOINT_COOLDOWN_MS/, 'a failing endpoint cools down');
  assert.match(source, /cannot align/, 'unalignable batches are split');
  assert.match(source, /textMode/, 'text fallback when ::before cannot be used');
  assert.match(source, /characterData: true/);
  assert.match(source, /shadowRoot/);
});
