'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {createReleaseManifest} = require('../scripts/lib/release-manifest');

test('release manifest captures input hashes, absent optional data and stamped assets', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zoopdog-manifest-'));
  try {
    for (const dir of ['scripts', 'zd-extension/db_src', 'dist']) fs.mkdirSync(path.join(root, dir), {recursive: true});
    fs.writeFileSync(path.join(root, 'scripts', 'build.js'), 'first');
    fs.writeFileSync(path.join(root, 'zd-extension/db_src', 'dictionary.json'), '[]');
    fs.writeFileSync(path.join(root, 'dist', 'a.user.js'), '// ==UserScript==\n// @version 2026.10.28\n// ==/UserScript==\n');
    const args = {root, inputs: ['scripts', 'zd-extension/db_src'], optional: ['zd-extension/db_src/chunom_standard.json'],
      assets: ['dist/a.user.js'], commit: 'abc', nodeVersion: 'v24.1.0', toolVersions: {esbuild: '1.0'}};
    const first = createReleaseManifest(args);
    assert.deepEqual(first, createReleaseManifest(args));
    assert.equal(first.commit, 'abc');
    assert.equal(first.optional['zd-extension/db_src/chunom_standard.json'], null);
    assert.equal(first.assets['dist/a.user.js'].version, '2026.10.28');
    assert.match(first.inputs['scripts/build.js'].sha256, /^[a-f\d]{64}$/);
    fs.writeFileSync(path.join(root, 'scripts', 'build.js'), 'second');
    const after = createReleaseManifest(args);
    assert.notEqual(after.inputs['scripts/build.js'].sha256, first.inputs['scripts/build.js'].sha256);
  } finally { fs.rmSync(root, {recursive: true, force: true}); }
});

test('manifest verification detects changed, added or removed inputs and assets', () => {
  const {verifyReleaseManifest} = require('../scripts/lib/release-manifest');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zd-manifest-verify-'));
  try {
    fs.mkdirSync(path.join(root, 'scripts'));
    fs.writeFileSync(path.join(root, 'scripts/input'), 'first');
    fs.writeFileSync(path.join(root, 'output'), 'result');
    const manifest = createReleaseManifest({root, inputs: ['scripts'], optional: ['optional'], assets: ['output'],
      commit: 'abc', nodeVersion: 'v24', toolVersions: {}});
    assert.doesNotThrow(() => verifyReleaseManifest(root, manifest));
    fs.writeFileSync(path.join(root, 'scripts/new'), 'new');
    assert.throws(() => verifyReleaseManifest(root, manifest), /manifest/i);
    fs.unlinkSync(path.join(root, 'scripts/new'));
    fs.writeFileSync(path.join(root, 'output'), 'changed');
    assert.throws(() => verifyReleaseManifest(root, manifest), /manifest/i);
    fs.unlinkSync(path.join(root, 'output'));
    assert.throws(() => verifyReleaseManifest(root, manifest), /manifest/i);
  } finally { fs.rmSync(root, {recursive: true, force: true}); }
});

test('release refuses inputs changed between build preparation and preflight', () => {
  const {assertReleaseInputsUnchanged} = require('../scripts/lib/release-manifest');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zd-release-inputs-'));
  try {
    fs.mkdirSync(path.join(root, 'scripts'));
    fs.writeFileSync(path.join(root, 'scripts/a'), 'first');
    const options = {root, inputs: ['scripts'], optional: ['optional'], assets: [],
      commit: 'abc', nodeVersion: 'v24', toolVersions: {}};
    const before = createReleaseManifest(options);
    assert.doesNotThrow(() => assertReleaseInputsUnchanged(before, createReleaseManifest(options)));
    fs.writeFileSync(path.join(root, 'scripts/a'), 'new');
    assert.throws(() => assertReleaseInputsUnchanged(before, createReleaseManifest(options)), /inputs changed/i);
    fs.writeFileSync(path.join(root, 'scripts/a'), 'first');
    assert.throws(() => assertReleaseInputsUnchanged(before, {...createReleaseManifest(options), commit: 'changed'}), /inputs changed/i);
  } finally { fs.rmSync(root, {recursive: true, force: true}); }
});
