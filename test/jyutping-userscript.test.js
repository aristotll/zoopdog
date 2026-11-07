'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const repoPaths = require('../scripts/lib/paths');
const {buildUserscript, VARIANTS} = require('../scripts/build-jyutping-userscript');
const {readUserscriptVersion, PENDING_VERSION} = require('../scripts/lib/userscript');

test('release and (Local) Jyutping builds differ only in name and update location', () => {
  const [release, local] = VARIANTS.map((variant) => buildUserscript(variant));
  const releaseUrl = repoPaths.releaseUrl('jyutpingUserscript');
  const localUrl = repoPaths.localFileUrl('jyutpingLocalUserscript');

  assert.match(release, /^\/\/ @name\s+Inject Jyutping$/m);
  assert.match(local, /^\/\/ @name\s+Inject Jyutping \(Local\)$/m);
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

test('the Jyutping runtime is fault tolerant', () => {
  const source = buildUserscript(VARIANTS[0]);
  assert.match(source, /new Worker\(/, 'uses a worker');
  assert.match(source, /startMainThreadConverter/, 'falls back to the main thread');
  assert.match(source, /RETRY_DELAYS_MS/, 'retries a failed converter load');
  assert.match(source, /withDeadline/, 'bounds every request');
  assert.match(source, /verifyStyle/, 'checks the stylesheet really applied');
  assert.match(source, /shadowRoot/, 'reaches open shadow roots');
  assert.match(source, /characterData: true/, 'observes edited text');
  assert.match(source, /observe\(document\.documentElement\)/, 'survives a swapped <body>');
});
