'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('modal geometry uses injected storage and clamps restored position and size', () => {
  const context = vm.createContext({JSON, Math});
  vm.runInContext(fs.readFileSync(require.resolve('../scripts/userscript/local-modal-geometry.js'), 'utf8'), context);
  const values = new Map();
  const geometry = context.createZooModalGeometry({domain: () => 'example.com',
    viewport: () => ({width: 800, height: 600}),
    readPosition: key => values.get(key), writePosition: (key, value) => values.set(key, value),
    readSize: key => values.get(key), writeSize: (key, value) => values.set(key, value)});
  geometry.savePosition('entry', 1000, -10);
  geometry.saveSize('entry', 1000, 900);
  const panel = {offsetWidth: 200, offsetHeight: 100, style: {}};
  geometry.restorePosition('entry', panel);
  geometry.restoreSize('entry', panel);
  assert.equal(panel.style.left, '600px');
  assert.equal(panel.style.top, '0px');
  assert.equal(panel.style.width, '800px');
  assert.equal(panel.style.height, '600px');
});
