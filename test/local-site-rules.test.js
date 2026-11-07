'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {readLocalSiteRules} = require('../scripts/lib/userscript');

function withFile(content, run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zd-rules-'));
  const file = path.join(dir, 'rules.json');
  fs.writeFileSync(file, content);
  try { return run({ZOOPDOG_LOCAL_SITE_RULES: file}); } finally { fs.rmSync(dir, {recursive: true, force: true}); }
}

test('the published build never receives site rules', () => {
  const rules = JSON.stringify({rules: [{host: 'example\\.com', perWord: true}]});
  withFile(rules, (env) => assert.deepEqual(readLocalSiteRules('nom-ruby', false, env), []));
});

test('the local build gets the rules naming its script, without the scripts key', () => {
  const rules = JSON.stringify({rules: [
    {host: 'a\\.test', scripts: ['nom-ruby'], perWord: true},
    {host: 'b\\.test', scripts: ['cjk-ruby'], maxRun: 3},
    {host: 'c\\.test', mode: 'overlay'}
  ]});
  withFile(rules, (env) => {
    assert.deepEqual(readLocalSiteRules('nom-ruby', true, env), [{host: 'a\\.test', perWord: true}, {host: 'c\\.test', mode: 'overlay'}]);
    assert.deepEqual(readLocalSiteRules('cjk-ruby', true, env), [{host: 'b\\.test', maxRun: 3}, {host: 'c\\.test', mode: 'overlay'}]);
  });
});

test('a missing file means no rules and a malformed rule fails the build', () => {
  assert.deepEqual(readLocalSiteRules('nom-ruby', true, {ZOOPDOG_LOCAL_SITE_RULES: '/nonexistent/rules.json'}), []);
  withFile('{"rules":[{"css":"x"}]}', (env) => assert.throws(() => readLocalSiteRules('nom-ruby', true, env), /host/));
});

test('no private host name is hardcoded in the runtimes', () => {
  for (const name of ['nom-ruby.runtime.js', 'cjk-ruby.runtime.js']) {
    const source = fs.readFileSync(path.join(__dirname, '../scripts/userscript', name), 'utf8');
    assert.match(source, /__ZOOPDOG_LOCAL_SITE_RULES__/);
  }
});
