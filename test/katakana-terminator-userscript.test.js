'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const repoPaths = require('../scripts/lib/paths');
const {buildUserscript, VARIANTS} = require('../scripts/build-katakana-terminator-userscript');
const {readUserscriptVersion, PENDING_VERSION} = require('../scripts/lib/userscript');

test('release and (Local) Katakana Terminator builds differ only in name and update location', () => {
  const [release, local] = VARIANTS.map((variant) => buildUserscript(variant));
  const releaseUrl = repoPaths.releaseUrl('katakanaUserscript');
  const localUrl = repoPaths.localFileUrl('katakanaLocalUserscript');

  assert.match(release, /^\/\/ @name\s+Katakana Terminator$/m);
  assert.match(local, /^\/\/ @name\s+Katakana Terminator \(Local\)$/m);
  assert.match(release, new RegExp(`^// @updateURL\\s+${releaseUrl}$`, 'm'));
  assert.match(release, new RegExp(`^// @downloadURL\\s+${releaseUrl}$`, 'm'));
  assert.match(local, new RegExp(`^// @updateURL\\s+${localUrl}$`, 'm'));
  assert.match(local, new RegExp(`^// @downloadURL\\s+${localUrl}$`, 'm'));
  assert.equal(readUserscriptVersion(release), PENDING_VERSION);
  for (const source of [release, local]) {
    assert.doesNotMatch(source, /__ZOOPDOG_/);
    assert.doesNotThrow(() => new vm.Script(source));
  }
  const body = (source) => source.split('// ==/UserScript==')[1];
  assert.equal(body(release), body(local));
});

test('the Katakana Terminator runtime is fault tolerant and covers kanji readings', () => {
  const source = buildUserscript(VARIANTS[0]);
  assert.match(source, /ENDPOINT_COOLDOWN_MS/, 'a failing endpoint cools down instead of being dropped for good');
  assert.match(source, /RETRY_DELAYS_MS/, 'failed phrases are retried with back-off');
  assert.match(source, /REQUEST_TIMEOUT_MS/, 'every request has a deadline');
  assert.match(source, /cannot align/, 'unalignable batches are split');
  assert.match(source, /dt: 'rm'/, 'kanji readings come from the public transliteration block');
  assert.match(source, /fetch\(url\)/, 'works without GM_xmlhttpRequest');
  assert.match(source, /characterData: true/, 'observes edited text');
  assert.match(source, /shadowRoot/, 'reaches open shadow roots');
  assert.match(source, /textMode/, 'falls back to real text when ::before cannot be used');
});
