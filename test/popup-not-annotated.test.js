'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', 'scripts', 'userscript', file), 'utf8');

test('overlay labels sit below the popup dictionary, never over it', () => {
  const overlayZ = Number(/z-index:(\d+)/.exec(read('overlay-labels.js'))[1]);
  const popupZ = Number(/#zoopdog-userscript-popup \{[^}]*?z-index: (\d+)/s.exec(read('popupdict.css'))[1]);
  assert.ok(overlayZ < popupZ, 'overlay z-index ' + overlayZ + ' must be below popup ' + popupZ);
});

test('both annotators leave zoopdog UI (the popup) alone', () => {
  assert.match(read('nom-ruby-scan.js'), /id\.indexOf\('zoopdog-'\) === 0/);
  assert.match(read('cjk-ruby.runtime.js'), /\[id\^="zoopdog-userscript-"\]/);
});
