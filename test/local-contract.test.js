'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

test('local userscript calls the versioned reader contract routes', () => {
  const contract = require('./fixtures/local-mode-contract.json');
  const source = fs.readFileSync(path.join(__dirname, '../scripts/userscript/popupdict-local.runtime.js'), 'utf8');
  const seen = new Set();
  for (const match of source.matchAll(/zoo(GetJSON|Post)\(\s*'([^']+)'|zooHttpRequest\(\s*'(GET|POST)'\s*,\s*'([^']+)'/g)) {
    const method = match[1] === 'GetJSON' ? 'GET' : match[1] === 'Post' ? 'POST' : match[3];
    const route = match[2] || match[4];
    if (route.startsWith('/v1/')) seen.add(`${method} ${route}`);
  }
  assert.equal(contract.version, 1);
  const expected = new Set(contract.routes.map(route => `${route.method} ${route.path}`));
  assert.deepEqual([...seen].sort(), [...expected].sort());
  for (const route of contract.routes) assert.ok(route.request && route.response, route.path);
});

test('reader and userscript contract fixtures agree when both checkouts are available', () => {
  const peer = path.join(os.homedir(), 'mine/book-translator/tests/fixtures/zoopdog-local-contract.json');
  if (!fs.existsSync(peer)) return;
  const local = require('./fixtures/local-mode-contract.json');
  assert.deepEqual(JSON.parse(fs.readFileSync(peer, 'utf8')), local);
});
