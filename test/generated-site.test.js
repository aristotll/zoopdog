'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('generated-site check detects drift without modifying tracked output', async () => {
  const {buildSite} = require('../scripts/build-site');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zoopdog-site-'));
  try {
    fs.mkdirSync(path.join(root, 'css'));
    fs.writeFileSync(path.join(root, 'page.jade'), 'doctype html\nhtml\n  body Hello\n');
    fs.writeFileSync(path.join(root, 'css', 'page.styl'), 'body\n  color red\n');
    const inputs = [{source: 'page.jade', output: 'page.html', type: 'pug'},
      {source: 'css/page.styl', output: 'css/page.css', type: 'stylus'}];
    await buildSite({root, inputs});
    assert.deepEqual(await buildSite({root, inputs, check: true}), []);
    const target = path.join(root, 'page.html');
    fs.writeFileSync(target, 'stale');
    assert.deepEqual(await buildSite({root, inputs, check: true}), ['page.html']);
    assert.equal(fs.readFileSync(target, 'utf8'), 'stale');
    fs.unlinkSync(path.join(root, 'css/page.css'));
    assert.deepEqual(await buildSite({root, inputs, check: true}), ['page.html', 'css/page.css']);
  } finally { fs.rmSync(root, {recursive: true, force: true}); }
});
