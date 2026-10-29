'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {chooseReleaseVersion, stampReleaseAssets} = require('../scripts/release-userscripts');
const {readUserscriptVersion, compareVersions} = require('../scripts/lib/userscript');

const template = '// ==UserScript==\n// @name test\n// @version 2020.01.01\n// ==/UserScript==\nconsole.log(1);\n';

test('release versions advance from published metadata on clean builds', () => {
  const day = '2026.10.28';
  const first = chooseReleaseVersion(['2026.10.27', '2026.10.27.3'], day);
  const second = chooseReleaseVersion([first, first], day);
  assert.equal(first, '2026.10.28');
  assert.equal(second, '2026.10.28.1');
  assert.ok(compareVersions(second, first) > 0);
  assert.equal(chooseReleaseVersion([first, first], day), second);
  assert.throws(() => chooseReleaseVersion([second], day, first), /newer/);
  assert.throws(() => chooseReleaseVersion([second], day, second), /newer/);
  assert.throws(() => chooseReleaseVersion([], day), /published/i);
  assert.throws(() => chooseReleaseVersion(['bad'], day), /version/i);
});

test('release stamping is deterministic and preserves script content', () => {
  const assets = [{name: 'a.user.js', source: template}, {name: 'b.user.js', source: template}];
  const first = stampReleaseAssets(assets, '2026.10.28.1');
  assert.deepEqual(first, stampReleaseAssets(assets, '2026.10.28.1'));
  assert.equal(readUserscriptVersion(first[0].source), '2026.10.28.1');
  assert.ok(first[0].source.endsWith('console.log(1);\n'));
});

test('published versions come from assets of one selected latest release', () => {
  const {readPublishedRelease} = require('../scripts/release-userscripts');
  const calls = [];
  const fakeGh = args => {
    calls.push(args);
    if (args[0] === 'view') return JSON.stringify({tagName: 'release-42'});
    return template.replace('2020.01.01', args.includes('a.user.js') ? '2026.10.28.1' : '2026.10.28.2');
  };
  const result = readPublishedRelease(['a.user.js', 'b.user.js'], fakeGh);
  assert.deepEqual(result, {tag: 'release-42', versions: ['2026.10.28.1', '2026.10.28.2']});
  assert.ok(calls.slice(1).every(args => args[1] === 'release-42'));
  assert.throws(() => readPublishedRelease(['a.user.js'], () => { throw new Error('offline'); }), /offline/);
});

test('release preflight rejects mismatched dictionary generations and invalid metadata', () => {
  const crypto = require('node:crypto');
  const {validateDictionaryPair} = require('../scripts/release-userscripts');
  const payload = '[{"key":"bạn","headwords":["bạn"],"en":[]}]';
  const {METADATA_SCHEMA_VERSION} = require('../scripts/build-extension-vnedict-json');
  const metadata = {schemaVersion: METADATA_SCHEMA_VERSION, revision: crypto.createHash('sha256').update(payload).digest('hex'), entryCount: 1};
  assert.doesNotThrow(() => validateDictionaryPair(payload, JSON.stringify(metadata)));
  assert.throws(() => validateDictionaryPair(payload + ' ', JSON.stringify(metadata)), /revision/i);
  assert.throws(() => validateDictionaryPair(payload, JSON.stringify({...metadata, entryCount: 2})), /count/i);
  assert.throws(() => validateDictionaryPair(payload, JSON.stringify({...metadata, schemaVersion: 99})), /schema/i);
});

test('release preflight validates revision-specific payload name', () => {
  const {buildMetadata} = require('../scripts/build-extension-vnedict-json');
  const {validateDictionaryPair} = require('../scripts/release-userscripts');
  const payload = '[{"key":"bạn","headwords":["bạn"],"en":[]}]';
  const metadata = buildMetadata(payload);
  assert.doesNotThrow(() => validateDictionaryPair(payload, JSON.stringify(metadata)));
  assert.throws(() => validateDictionaryPair(payload, JSON.stringify({...metadata, payload: '../other.json'})), /payload/i);
});

test('dry-run preflights and stamps a complete release using mocked GitHub metadata', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const {spawnSync} = require('node:child_process');
  const {buildMetadata} = require('../scripts/build-extension-vnedict-json');
  const {verifyReleaseManifest} = require('../scripts/lib/release-manifest');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zoopdog-release-dry-'));
  try {
    fs.cpSync(path.join(__dirname, '../scripts'), path.join(root, 'scripts'), {recursive: true});
    fs.symlinkSync(path.join(__dirname, '../node_modules'), path.join(root, 'node_modules'), 'dir');
    for (const dir of ['dist', 'bin', 'zd-extension/js', 'zd-extension/db_src']) fs.mkdirSync(path.join(root, dir), {recursive: true});
    fs.writeFileSync(path.join(root, 'package-lock.json'), '{}');
    fs.writeFileSync(path.join(root, 'zd-extension/js/zd-words.js'), '');
    fs.writeFileSync(path.join(root, 'zd-extension/js/zd-nom-match.js'), '');
    for (const name of ['zoopdog-nom-ruby.user.js', 'zoopdog-popupdict.user.js']) fs.writeFileSync(path.join(root, 'dist', name), template);
    const payload = '[{"key":"bạn","headwords":["bạn"],"en":[]}]';
    const metadata = buildMetadata(payload);
    fs.writeFileSync(path.join(root, 'zd-extension/js/vnedict.json'), payload);
    fs.writeFileSync(path.join(root, 'zd-extension/js', metadata.payload), payload);
    fs.writeFileSync(path.join(root, 'zd-extension/js/vnedict.meta.json'), JSON.stringify(metadata));
    const gh = path.join(root, 'bin/gh');
    fs.writeFileSync(gh, '#!/bin/sh\nprintf "%s\\n" "$*" >> "$EVENTS"\ncase "$2" in\nview) printf \'{"tagName":"published"}\';;\ndownload) printf \'// ==UserScript==\\n// @version 2026.10.27\\n// ==/UserScript==\\n\';;\n*) exit 2;;\nesac\n');
    fs.chmodSync(gh, 0o755);
    const git = path.join(root, 'bin/git');
    fs.writeFileSync(git, '#!/bin/sh\nprintf "abcdef\\n"\n'); fs.chmodSync(git, 0o755);
    const events = path.join(root, 'events');
    const env = {...process.env, PATH: `${path.join(root, 'bin')}${path.delimiter}${process.env.PATH}`,
      EVENTS: events, RELEASE_VERSION: '2026.10.28.2'};
    const capture = spawnSync(process.execPath, ['scripts/release-inputs.js'], {cwd: root, env, encoding: 'utf8'});
    assert.equal(capture.status, 0, capture.stdout + capture.stderr);
    const result = spawnSync(process.execPath, ['scripts/release-userscripts.js', '--dry-run'], {cwd: root, env, encoding: 'utf8'});
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.doesNotMatch(fs.readFileSync(events, 'utf8'), /release create/);
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'dist/zoopdog-release-manifest.json'), 'utf8'));
    assert.equal(manifest.commit, 'abcdef');
    assert.equal(manifest.assets['dist/zoopdog-nom-ruby.user.js'].version, '2026.10.28.2');
    assert.ok(manifest.assets[`zd-extension/js/${metadata.payload}`]);
    assert.doesNotThrow(() => verifyReleaseManifest(root, manifest));
    fs.writeFileSync(path.join(root, 'zd-extension/db_src', 'changed.json'), '{}');
    const changed = spawnSync(process.execPath, ['scripts/release-userscripts.js', '--dry-run'], {cwd: root, env, encoding: 'utf8'});
    assert.notEqual(changed.status, 0);
    assert.match(changed.stderr, /inputs changed/i);
  } finally { fs.rmSync(root, {recursive: true, force: true}); }
});

test('release rejects a version outside a complete userscript metadata header', () => {
  const {validateUserscriptHeader} = require('../scripts/release-userscripts');
  assert.equal(validateUserscriptHeader(template), '2020.01.01');
  assert.throws(() => validateUserscriptHeader('// @version 2020.01.01\nconsole.log(1)'), /header/i);
  assert.throws(() => validateUserscriptHeader('// ==UserScript==\n// ==/UserScript==\n// @version 2020.01.01\n'), /version/i);
  assert.throws(() => validateUserscriptHeader('// ==UserScript==\n// @version 2020.01.01\n'), /header/i);
});
