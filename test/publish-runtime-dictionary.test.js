'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {buildMetadata} = require('../scripts/build-extension-vnedict-json');
const {atomicWrite} = require('../scripts/lib/fsutil');

function makeGeneration(dir, value) {
  const bytes = JSON.stringify([{key: value, headwords: [value], en: []}]);
  const meta = buildMetadata(bytes);
  fs.writeFileSync(path.join(dir, 'vnedict.json'), bytes);
  fs.writeFileSync(path.join(dir, meta.payload), bytes);
  fs.writeFileSync(path.join(dir, 'vnedict.meta.json'), JSON.stringify(meta));
  return {bytes, meta};
}

test('static deployment switches metadata last and retains the previous immutable payload', () => {
  const {publishRuntimeDictionary} = require('../scripts/publish-runtime-dictionary');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zd-deploy-'));
  const source = path.join(root, 'source'), target = path.join(root, 'target');
  fs.mkdirSync(source); fs.mkdirSync(target);
  try {
    const old = makeGeneration(target, 'old'), next = makeGeneration(source, 'new');
    const seen = [];
    publishRuntimeDictionary(source, target, {write(file, content) {
      atomicWrite(file, content);
      const meta = JSON.parse(fs.readFileSync(path.join(target, 'vnedict.meta.json'), 'utf8'));
      const payload = fs.readFileSync(path.join(target, meta.payload), 'utf8');
      assert.equal(payload, meta.revision === old.meta.revision ? old.bytes : next.bytes);
      seen.push(path.basename(file));
    }});
    assert.equal(seen.at(-1), 'vnedict.meta.json');
    assert.equal(fs.readFileSync(path.join(target, old.meta.payload), 'utf8'), old.bytes);
    assert.equal(fs.readFileSync(path.join(target, next.meta.payload), 'utf8'), next.bytes);
  } finally { fs.rmSync(root, {recursive: true, force: true}); }
});

test('static deployment rejects invalid source and preserves prior generation on failure', () => {
  const {publishRuntimeDictionary} = require('../scripts/publish-runtime-dictionary');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zd-deploy-failure-'));
  const source = path.join(root, 'source'), target = path.join(root, 'target');
  fs.mkdirSync(source); fs.mkdirSync(target);
  try {
    const old = makeGeneration(target, 'old'), next = makeGeneration(source, 'new');
    fs.writeFileSync(path.join(source, next.meta.payload), 'incorrect');
    assert.throws(() => publishRuntimeDictionary(source, target), /payload/i);
    assert.equal(fs.readFileSync(path.join(target, 'vnedict.meta.json'), 'utf8'), JSON.stringify(old.meta));
    fs.writeFileSync(path.join(source, next.meta.payload), next.bytes);
    assert.throws(() => publishRuntimeDictionary(source, target, {write(file, content) {
      if (file === path.join(target, 'vnedict.meta.json')) throw new Error('failure before pointer switch');
      atomicWrite(file, content);
    }}), /failure before pointer switch/);
    assert.equal(fs.readFileSync(path.join(target, old.meta.payload), 'utf8'), old.bytes);
    assert.equal(fs.readFileSync(path.join(target, 'vnedict.json'), 'utf8'), old.bytes);
    assert.equal(JSON.parse(fs.readFileSync(path.join(target, 'vnedict.meta.json'))).revision, old.meta.revision);
  } finally { fs.rmSync(root, {recursive: true, force: true}); }
});

test('static HTTP clients can finish reading the previous generation after publication', async () => {
  const http = require('node:http');
  const {publishRuntimeDictionary} = require('../scripts/publish-runtime-dictionary');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zd-deploy-http-'));
  const source = path.join(root, 'source'), target = path.join(root, 'target');
  fs.mkdirSync(source); fs.mkdirSync(target);
  const old = makeGeneration(target, 'old'), next = makeGeneration(source, 'new');
  const server = http.createServer((request, response) => {
    const name = request.url.slice(1);
    if (!/^vnedict(?:\.[a-f0-9]{64}|\.meta)?\.json$/.test(name)) { response.writeHead(404).end(); return; }
    try { response.end(fs.readFileSync(path.join(target, name))); }
    catch { response.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}/`;
    const held = await (await fetch(base + 'vnedict.meta.json')).json();
    publishRuntimeDictionary(source, target);
    assert.equal(await (await fetch(base + held.payload)).text(), old.bytes);
    const latest = await (await fetch(base + 'vnedict.meta.json')).json();
    assert.equal(latest.revision, next.meta.revision);
    assert.equal(await (await fetch(base + latest.payload)).text(), next.bytes);
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, {recursive: true, force: true});
  }
});

test('static publisher rejects an invalid existing pointer before writing', () => {
  const {publishRuntimeDictionary} = require('../scripts/publish-runtime-dictionary');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zd-deploy-bad-pointer-'));
  const source = path.join(root, 'source'), target = path.join(root, 'target');
  fs.mkdirSync(source); fs.mkdirSync(target);
  try {
    makeGeneration(source, 'new');
    const bad = JSON.stringify({schemaVersion: 2, revision: '../outside', entryCount: 1, payload: '../secret'});
    fs.writeFileSync(path.join(target, 'vnedict.meta.json'), bad);
    assert.throws(() => publishRuntimeDictionary(source, target), /metadata/i);
    assert.equal(fs.readFileSync(path.join(target, 'vnedict.meta.json'), 'utf8'), bad);
    assert.deepEqual(fs.readdirSync(target), ['vnedict.meta.json']);
  } finally { fs.rmSync(root, {recursive: true, force: true}); }
});

test('publishes over legacy metadata while preserving its prior dictionary on failure', () => {
  const {publishRuntimeDictionary} = require('../scripts/publish-runtime-dictionary');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zd-deploy-legacy-'));
  const source = path.join(root, 'source'), target = path.join(root, 'target');
  fs.mkdirSync(source); fs.mkdirSync(target);
  try {
    const old = makeGeneration(target, 'old');
    const legacy = {...old.meta}; delete legacy.payload;
    fs.writeFileSync(path.join(target, 'vnedict.meta.json'), JSON.stringify(legacy));
    const next = makeGeneration(source, 'new');
    assert.throws(() => publishRuntimeDictionary(source, target, {write(file, content) {
      if (file === path.join(target, 'vnedict.meta.json')) throw new Error('metadata failed');
      atomicWrite(file, content);
    }}), /metadata failed/);
    assert.equal(fs.readFileSync(path.join(target, 'vnedict.json'), 'utf8'), old.bytes);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(target, 'vnedict.meta.json'))), legacy);
    publishRuntimeDictionary(source, target);
    assert.equal(JSON.parse(fs.readFileSync(path.join(target, 'vnedict.meta.json'))).payload, next.meta.payload);
    assert.equal(fs.readFileSync(path.join(target, next.meta.payload), 'utf8'), next.bytes);
  } finally { fs.rmSync(root, {recursive: true, force: true}); }
});

test('a killed publisher leaves the previous immutable generation readable and permits retry', () => {
  const {spawnSync} = require('node:child_process');
  const {publishRuntimeDictionary} = require('../scripts/publish-runtime-dictionary');
  const publisherPath = require.resolve('../scripts/publish-runtime-dictionary');
  const fsutilPath = require.resolve('../scripts/lib/fsutil');
  for (const stage of ['immutable', 'legacy']) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zd-deploy-killed-'));
    const source = path.join(root, 'source'), target = path.join(root, 'target');
    fs.mkdirSync(source); fs.mkdirSync(target);
    try {
      const old = makeGeneration(target, 'old'), next = makeGeneration(source, 'new');
      const code = `
        const path = require('node:path');
        const {publishRuntimeDictionary} = require(process.argv[4]);
        const {atomicWrite} = require(process.argv[5]);
        publishRuntimeDictionary(process.argv[1], process.argv[2], {write(file, data) {
          atomicWrite(file, data);
          const name = path.basename(file);
          const hit = process.argv[3] === 'immutable'
            ? /^vnedict\\.[a-f0-9]{64}\\.json$/.test(name) : name === 'vnedict.json';
          if (hit) process.kill(process.pid, 'SIGKILL');
        }});
      `;
      const child = spawnSync(process.execPath, ['-e', code, source, target, stage, publisherPath, fsutilPath], {encoding: 'utf8'});
      assert.equal(child.signal, 'SIGKILL', `${stage}: ${child.stdout} ${child.stderr}`);
      const pointer = JSON.parse(fs.readFileSync(path.join(target, 'vnedict.meta.json'), 'utf8'));
      assert.equal(pointer.revision, old.meta.revision);
      assert.equal(fs.readFileSync(path.join(target, pointer.payload), 'utf8'), old.bytes);
      publishRuntimeDictionary(source, target);
      const after = JSON.parse(fs.readFileSync(path.join(target, 'vnedict.meta.json'), 'utf8'));
      assert.equal(after.revision, next.meta.revision);
      assert.equal(fs.readFileSync(path.join(target, after.payload), 'utf8'), next.bytes);
      assert.equal(fs.readFileSync(path.join(target, old.meta.payload), 'utf8'), old.bytes);
    } finally { fs.rmSync(root, {recursive: true, force: true}); }
  }
});
