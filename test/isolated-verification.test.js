'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('verification prepares a fresh isolated snapshot and propagates the first failure', () => {
  const {runIsolatedTests} = require('../scripts/test-isolated');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zd-isolate-source-'));
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'zd-isolate-work-'));
  try {
    for (const dir of ['scripts', 'test', 'zd-extension/db_src']) fs.mkdirSync(path.join(root, dir), {recursive: true});
    fs.writeFileSync(path.join(root, 'test', 'example.test.js'), 'fixture');
    fs.writeFileSync(path.join(root, 'zd-extension/db_src', 'input'), 'current');
    fs.writeFileSync(path.join(root, 'zoopdog-nom-ruby.user.js'), 'stale');
    const seen = [];
    const run = (command, args, options) => {
      seen.push({command, args, cwd: options.cwd});
      assert.equal(fs.existsSync(path.join(options.cwd, 'zoopdog-nom-ruby.user.js')), false);
      if (args[0] === '--test') throw new Error('intentional regression');
    };
    assert.throws(() => runIsolatedTests({root, tempRoot: work, run}), /intentional regression/);
    assert.equal(seen.length, 4);
    assert.ok(seen.every(entry => entry.cwd === seen[0].cwd && entry.cwd !== root));
    assert.equal(fs.readFileSync(path.join(root, 'zoopdog-nom-ruby.user.js'), 'utf8'), 'stale');
    assert.equal(fs.readdirSync(work).length, 0);
    const other = [];
    assert.throws(() => runIsolatedTests({root, tempRoot: work, run: (cmd, args, opts) => {
      other.push(opts.cwd); throw new Error('build failed');
    }}), /build failed/);
    assert.notEqual(other[0], seen[0].cwd);
  } finally { fs.rmSync(root, {recursive: true, force: true}); fs.rmSync(work, {recursive: true, force: true}); }
});

test('verification checks generated site files and minifies only inside the isolated snapshot', () => {
  const {runIsolatedTests} = require('../scripts/test-isolated');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zd-isolate-ci-source-'));
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'zd-isolate-ci-work-'));
  try {
    for (const dir of ['scripts', 'test']) fs.mkdirSync(path.join(root, dir), {recursive: true});
    fs.writeFileSync(path.join(root, 'test', 'example.test.js'), 'fixture');
    const calls = [];
    runIsolatedTests({root, tempRoot: work, run: (command, args, options) => {
      calls.push({command, args, cwd: options.cwd});
    }});
    assert.deepEqual(calls.slice(-2).map(call => call.args), [
      ['scripts/minify-userscripts.js'], ['scripts/build-site.js', '--check']
    ]);
    assert.ok(calls.every(call => call.cwd === calls[0].cwd && call.cwd !== root));
    assert.equal(fs.readdirSync(work).length, 0);
    assert.equal(fs.existsSync(path.join(root, 'dist')), false);
  } finally { fs.rmSync(root, {recursive: true, force: true}); fs.rmSync(work, {recursive: true, force: true}); }
});
