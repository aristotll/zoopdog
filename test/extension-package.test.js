'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const {crc32, writeZip, readZip} = require('../scripts/lib/extension-package/zip');
const {buildPlan} = require('../scripts/lib/extension-package/plan');
const {buildArchiveBuffer, publishArchive, verifyArchive} = require('../scripts/lib/extension-package/archive');
const {PackageError} = require('../scripts/lib/extension-package/errors');
const cli = require('../scripts/build-extension-package');
const repoPaths = require('../scripts/lib/paths');
const realInventory = require('../scripts/lib/extension-package/inventory');
const {ensureRuntimeDictionaryBuilt} = require('./helpers/ensure-built');

// --- fixture extension tree --------------------------------------------------------------

const FIXTURE_INVENTORY = Object.freeze({
  STATIC_ENTRIES: Object.freeze([
    'manifest.json',
    'popup.html',
    'css/app.css',
    'js/app.js',
    'icon/icon16.png'
  ]),
  DYNAMIC_ENTRIES: Object.freeze(['js/data.json']),
  DIRECTORY_GLOBS: Object.freeze({})
});

function makeFixtureExtension(t, {version = '1.0', includeDynamic = true} = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zoopdog-extpkg-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));

  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({
    manifest_version: 3,
    name: 'Fixture',
    version,
    action: {default_popup: 'popup.html', default_icon: {16: 'icon/icon16.png'}}
  }, null, 2));
  fs.writeFileSync(path.join(dir, 'popup.html'),
    '<html><head><link rel="stylesheet" href="css/app.css"></head>'
    + '<body><script src="js/app.js"></script></body></html>');
  fs.mkdirSync(path.join(dir, 'css'));
  fs.writeFileSync(path.join(dir, 'css/app.css'), 'body { color: red; }\n');
  fs.mkdirSync(path.join(dir, 'js'));
  fs.writeFileSync(path.join(dir, 'js/app.js'), 'console.log("fixture");\n');
  fs.mkdirSync(path.join(dir, 'icon'));
  fs.writeFileSync(path.join(dir, 'icon/icon16.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02]));
  if (includeDynamic) {
    fs.writeFileSync(path.join(dir, 'js/data.json'), '{"a":1}\n');
  }

  return dir;
}

// --- zip codec ---------------------------------------------------------------------------

test('zip: crc32 matches a known vector', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
});

test('zip: write/read round-trips entries and reports no issues', () => {
  const buffer = writeZip([
    {path: 'b.txt', data: Buffer.from('second')},
    {path: 'a.txt', data: Buffer.from('first')}
  ]);
  const {entries, issues} = readZip(buffer);
  assert.deepEqual(issues, []);
  assert.deepEqual(entries.map((e) => e.path), ['a.txt', 'b.txt']); // sorted
  assert.equal(entries[0].data.toString(), 'first');
  assert.equal(entries[1].data.toString(), 'second');
});

test('zip: writeZip rejects duplicate paths', () => {
  assert.throws(() => writeZip([
    {path: 'a.txt', data: Buffer.from('x')},
    {path: 'a.txt', data: Buffer.from('y')}
  ]), (error) => error instanceof PackageError && error.code === 'duplicate_path');
});

test('zip: writeZip rejects unsafe/traversal paths', () => {
  for (const badPath of ['../evil.txt', '/etc/passwd', 'a/../../b.txt', 'a\\b.txt', 'a//b.txt']) {
    assert.throws(() => writeZip([{path: badPath, data: Buffer.from('x')}]),
      (error) => error instanceof PackageError && error.code === 'unsafe_path',
      `expected unsafe_path for ${badPath}`);
  }
});

test('zip: two builds of identical input bytes produce byte-identical output', () => {
  const entries = [
    {path: 'zd-extension/a.txt', data: Buffer.from('alpha')},
    {path: 'zd-extension/b.txt', data: Buffer.from('beta')}
  ];
  const first = writeZip(entries);
  const second = writeZip([...entries].reverse());
  assert.equal(first.equals(second), true);
});

// --- crafted (possibly malformed) archives -------------------------------------------------
// These bypass writeZip's own validation to build fixture bytes for archive-level failure
// modes: readZip must classify each condition as a structured issue rather than throwing
// (except for a structurally unreadable archive), and verifyArchive must surface it.

function craftZip(rawEntries) {
  const localChunks = [];
  const centralChunks = [];
  let offset = 0;
  for (const entry of rawEntries) {
    const nameBytes = Buffer.from(entry.path, 'utf8');
    const data = entry.data;
    const crc = Object.hasOwn(entry, 'crcOverride') ? entry.crcOverride : crc32(data);
    const uncompressedSize = Object.hasOwn(entry, 'uncompressedSizeOverride') ? entry.uncompressedSizeOverride : data.length;
    const compressedSize = Object.hasOwn(entry, 'compressedSizeOverride') ? entry.compressedSizeOverride : data.length;
    const method = entry.method ?? 0;
    const time = entry.time ?? 0x0000;
    const date = entry.date ?? 0x0021;
    const versionMadeBy = entry.versionMadeBy ?? ((3 << 8) | 20);
    const externalAttributes = entry.externalAttributes ?? ((0o100644 << 16) >>> 0);
    const extraLength = entry.extraLength ?? 0;

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(time, 10);
    localHeader.writeUInt16LE(date, 12);
    localHeader.writeUInt32LE(crc >>> 0, 14);
    localHeader.writeUInt32LE(compressedSize, 18);
    localHeader.writeUInt32LE(uncompressedSize, 22);
    localHeader.writeUInt16LE(nameBytes.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localChunks.push(localHeader, nameBytes, data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(versionMadeBy, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(time, 12);
    centralHeader.writeUInt16LE(date, 14);
    centralHeader.writeUInt32LE(crc >>> 0, 16);
    centralHeader.writeUInt32LE(compressedSize, 20);
    centralHeader.writeUInt32LE(uncompressedSize, 24);
    centralHeader.writeUInt16LE(nameBytes.length, 28);
    centralHeader.writeUInt16LE(extraLength, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(externalAttributes, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralChunks.push(centralHeader, nameBytes, Buffer.alloc(extraLength));

    offset += localHeader.length + nameBytes.length + data.length;
  }
  const centralDirectoryStart = offset;
  const centralDirectory = Buffer.concat(centralChunks);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(rawEntries.length, 8);
  end.writeUInt16LE(rawEntries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(centralDirectoryStart, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localChunks, centralDirectory, end]);
}

test('zip: readZip flags duplicate paths without throwing', () => {
  const buffer = craftZip([
    {path: 'a.txt', data: Buffer.from('x')},
    {path: 'a.txt', data: Buffer.from('y')}
  ]);
  const {issues} = readZip(buffer);
  assert.ok(issues.some((i) => i.code === 'duplicate_path'));
});

test('zip: readZip flags path traversal without throwing', () => {
  const buffer = craftZip([{path: '../evil.txt', data: Buffer.from('x')}]);
  const {issues} = readZip(buffer);
  assert.ok(issues.some((i) => i.code === 'path_traversal'));
});

test('zip: readZip flags a symlink entry', () => {
  const symlinkAttrs = ((0o120777 << 16) >>> 0);
  const buffer = craftZip([{path: 'a.txt', data: Buffer.from('x'), externalAttributes: symlinkAttrs}]);
  const {issues} = readZip(buffer);
  assert.ok(issues.some((i) => i.code === 'symlink_entry'));
});

test('zip: readZip flags a corrupt CRC-32', () => {
  const buffer = craftZip([{path: 'a.txt', data: Buffer.from('x'), crcOverride: 0x12345678}]);
  const {issues} = readZip(buffer);
  assert.ok(issues.some((i) => i.code === 'corrupt_entry'));
});

test('zip: readZip flags a corrupt uncompressed size', () => {
  const buffer = craftZip([{path: 'a.txt', data: Buffer.from('hello'), uncompressedSizeOverride: 999}]);
  const {issues} = readZip(buffer);
  assert.ok(issues.some((i) => i.code === 'corrupt_entry'));
});

test('zip: readZip flags non-reproducible metadata (deflate method)', () => {
  const buffer = craftZip([{path: 'a.txt', data: Buffer.from('x'), method: 8}]);
  const {issues} = readZip(buffer);
  assert.ok(issues.some((i) => i.code === 'nonreproducible_metadata'));
});

test('zip: readZip flags non-reproducible metadata (non-fixed timestamp)', () => {
  const buffer = craftZip([{path: 'a.txt', data: Buffer.from('x'), time: 0x1234, date: 0x5678}]);
  const {issues} = readZip(buffer);
  assert.ok(issues.some((i) => i.code === 'nonreproducible_metadata'));
});

test('zip: readZip flags non-reproducible metadata (extra field present)', () => {
  const buffer = craftZip([{path: 'a.txt', data: Buffer.from('x'), extraLength: 4}]);
  const {issues} = readZip(buffer);
  assert.ok(issues.some((i) => i.code === 'nonreproducible_metadata'));
});

// --- planning / reference validation -------------------------------------------------------

test('plan: builds the sorted file list for a fixture tree', (t) => {
  const dir = makeFixtureExtension(t);
  const plan = buildPlan(dir, FIXTURE_INVENTORY);
  assert.deepEqual(plan.entries.map((e) => e.path), [
    'css/app.css', 'icon/icon16.png', 'js/app.js', 'js/data.json', 'manifest.json', 'popup.html'
  ]);
  assert.equal(plan.manifest.version, '1.0');
});

test('plan: rejects a manifest_version other than 3', (t) => {
  const dir = makeFixtureExtension(t);
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({manifest_version: 2, version: '1.0'}));
  assert.throws(() => buildPlan(dir, FIXTURE_INVENTORY),
    (error) => error instanceof PackageError && error.code === 'manifest_version_unsupported');
});

test('plan: rejects a manifest reference to a missing file', (t) => {
  const dir = makeFixtureExtension(t);
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({
    manifest_version: 3, version: '1.0',
    action: {default_popup: 'missing.html'}
  }));
  assert.throws(() => buildPlan(dir, FIXTURE_INVENTORY),
    (error) => error instanceof PackageError && error.code === 'missing_reference');
});

test('plan: rejects a missing dynamic resource', (t) => {
  const dir = makeFixtureExtension(t, {includeDynamic: false});
  assert.throws(() => buildPlan(dir, FIXTURE_INVENTORY),
    (error) => error instanceof PackageError && error.code === 'missing_dynamic_resource');
});

test('plan: rejects inventory drift when a new file is referenced', (t) => {
  const dir = makeFixtureExtension(t);
  fs.writeFileSync(path.join(dir, 'js/extra.js'), 'console.log("extra");\n');
  fs.writeFileSync(path.join(dir, 'popup.html'),
    '<html><head><link rel="stylesheet" href="css/app.css"></head>'
    + '<body><script src="js/app.js"></script><script src="js/extra.js"></script></body></html>');
  assert.throws(() => buildPlan(dir, FIXTURE_INVENTORY),
    (error) => error instanceof PackageError && error.code === 'inventory_drift');
});

test('plan: rejects inventory drift when an inventoried file is no longer referenced', (t) => {
  const dir = makeFixtureExtension(t);
  fs.writeFileSync(path.join(dir, 'popup.html'), '<html><body>no references</body></html>');
  assert.throws(() => buildPlan(dir, FIXTURE_INVENTORY),
    (error) => error instanceof PackageError && error.code === 'inventory_drift');
});

// --- archive build / verify -----------------------------------------------------------------

test('archive: build is deterministic across two isolated builds', (t) => {
  const dirA = makeFixtureExtension(t);
  const dirB = makeFixtureExtension(t);
  const a = buildArchiveBuffer(dirA, FIXTURE_INVENTORY);
  const b = buildArchiveBuffer(dirB, FIXTURE_INVENTORY);
  assert.equal(a.buffer.equals(b.buffer), true);
  assert.equal(a.summary.sha256, b.summary.sha256);
  assert.equal(a.summary.entryCount, b.summary.entryCount);
  assert.equal(a.summary.byteCount, b.summary.byteCount);
});

test('archive: entries are stored under a zd-extension/ prefix', (t) => {
  const dir = makeFixtureExtension(t);
  const {buffer} = buildArchiveBuffer(dir, FIXTURE_INVENTORY);
  const {entries} = readZip(buffer);
  assert.ok(entries.every((e) => e.path.startsWith('zd-extension/')));
  assert.ok(entries.some((e) => e.path === 'zd-extension/manifest.json'));
});

test('archive: verify succeeds against a freshly built archive', (t) => {
  const dir = makeFixtureExtension(t);
  const archivePath = path.join(dir, '..', `pkg-${path.basename(dir)}.zip`);
  t.after(() => fs.rmSync(archivePath, {force: true}));
  publishArchive(dir, archivePath, FIXTURE_INVENTORY);
  const result = verifyArchive(dir, archivePath, FIXTURE_INVENTORY);
  assert.equal(result.ok, true);
  assert.deepEqual(result.problems, []);
});

test('archive: verify never mutates the tracked archive', (t) => {
  const dir = makeFixtureExtension(t);
  const archivePath = path.join(dir, '..', `pkg-mutate-${path.basename(dir)}.zip`);
  t.after(() => fs.rmSync(archivePath, {force: true}));
  publishArchive(dir, archivePath, FIXTURE_INVENTORY);
  const before = fs.readFileSync(archivePath);
  const beforeStat = fs.statSync(archivePath);
  verifyArchive(dir, archivePath, FIXTURE_INVENTORY);
  const after = fs.readFileSync(archivePath);
  assert.equal(before.equals(after), true);
  assert.equal(fs.statSync(archivePath).mtimeMs, beforeStat.mtimeMs);
});

test('archive: verify detects a stale manifest version', (t) => {
  const dir = makeFixtureExtension(t, {version: '1.0'});
  const archivePath = path.join(dir, '..', `pkg-stale-${path.basename(dir)}.zip`);
  t.after(() => fs.rmSync(archivePath, {force: true}));
  publishArchive(dir, archivePath, FIXTURE_INVENTORY);

  // Bump the source version after the archive was published, without rebuilding.
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  manifest.version = '2.0';
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  const result = verifyArchive(dir, archivePath, FIXTURE_INVENTORY);
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.code === 'stale_manifest'));
});

test('archive: verify detects an archive missing an expected entry', (t) => {
  const dir = makeFixtureExtension(t);
  const {plan} = buildArchiveBuffer(dir, FIXTURE_INVENTORY);
  const incomplete = writeZip(plan.entries
    .filter((e) => e.path !== 'js/app.js')
    .map((e) => ({path: `zd-extension/${e.path}`, data: fs.readFileSync(e.absolutePath)})));
  const archivePath = path.join(dir, '..', `pkg-missing-${path.basename(dir)}.zip`);
  fs.writeFileSync(archivePath, incomplete);
  t.after(() => fs.rmSync(archivePath, {force: true}));

  const result = verifyArchive(dir, archivePath, FIXTURE_INVENTORY);
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.code === 'missing_reference' && p.path === 'zd-extension/js/app.js'));
});

test('archive: verify detects an unexpected extra entry (e.g. OS junk file)', (t) => {
  const dir = makeFixtureExtension(t);
  const {plan} = buildArchiveBuffer(dir, FIXTURE_INVENTORY);
  const entries = plan.entries.map((e) => ({path: `zd-extension/${e.path}`, data: fs.readFileSync(e.absolutePath)}));
  entries.push({path: 'zd-extension/.DS_Store', data: Buffer.from('junk')});
  const archivePath = path.join(dir, '..', `pkg-junk-${path.basename(dir)}.zip`);
  fs.writeFileSync(archivePath, writeZip(entries));
  t.after(() => fs.rmSync(archivePath, {force: true}));

  const result = verifyArchive(dir, archivePath, FIXTURE_INVENTORY);
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.code === 'unexpected_path' && p.path === 'zd-extension/.DS_Store'));
});

test('archive: verify detects duplicate/traversal/symlink/corrupt/metadata issues in the tracked file', (t) => {
  const dir = makeFixtureExtension(t);
  const buffer = craftZip([
    {path: 'zd-extension/manifest.json', data: fs.readFileSync(path.join(dir, 'manifest.json'))},
    {path: 'zd-extension/dup.txt', data: Buffer.from('x')},
    {path: 'zd-extension/dup.txt', data: Buffer.from('y')},
    {path: '../escape.txt', data: Buffer.from('z')}
  ]);
  const archivePath = path.join(dir, '..', `pkg-crafted-${path.basename(dir)}.zip`);
  fs.writeFileSync(archivePath, buffer);
  t.after(() => fs.rmSync(archivePath, {force: true}));

  const result = verifyArchive(dir, archivePath, FIXTURE_INVENTORY);
  assert.equal(result.ok, false);
  const codes = result.problems.map((p) => p.code);
  assert.ok(codes.includes('duplicate_path'));
  assert.ok(codes.includes('path_traversal'));
  assert.ok(codes.includes('unexpected_path'));
});

test('archive: publish is atomic -- a failed build leaves an existing archive untouched', (t) => {
  const dir = makeFixtureExtension(t);
  const archivePath = path.join(dir, '..', `pkg-atomic-${path.basename(dir)}.zip`);
  t.after(() => fs.rmSync(archivePath, {force: true}));
  publishArchive(dir, archivePath, FIXTURE_INVENTORY);
  const before = fs.readFileSync(archivePath);

  // Break the source tree so the next build fails during planning.
  fs.rmSync(path.join(dir, 'js/data.json'));
  assert.throws(() => publishArchive(dir, archivePath, FIXTURE_INVENTORY),
    (error) => error instanceof PackageError && error.code === 'missing_dynamic_resource');

  const after = fs.readFileSync(archivePath);
  assert.equal(before.equals(after), true);

  // No leftover temp file either.
  const leftovers = fs.readdirSync(path.dirname(archivePath)).filter((name) => name.includes('.tmp-'));
  assert.deepEqual(leftovers, []);
});

// --- CLI ---------------------------------------------------------------------------------

function makeStreams() {
  const out = [];
  const err = [];
  return {
    stdout: {write: (s) => out.push(s)},
    stderr: {write: (s) => err.push(s)},
    out,
    err
  };
}

test('cli: build then verify round-trip against a fixture tree with key=value output', (t) => {
  const dir = makeFixtureExtension(t);
  const archivePath = path.join(dir, '..', `cli-${path.basename(dir)}.zip`);
  t.after(() => fs.rmSync(archivePath, {force: true}));

  // The CLI always uses the reviewed repository inventory, which this small fixture tree does
  // not satisfy -- so building against it deterministically hits inventory_drift. Assert that
  // specific, well-formed failure rather than the real repo round trip (covered below).
  const io = makeStreams();
  const code = cli.run(['build', '--extension', dir, '--archive', archivePath, '--json'], io);
  assert.equal(code, 3);
  const payload = JSON.parse(io.err.join(''));
  assert.equal(payload.error.code, 'inventory_drift');
});

test('cli: build/verify round-trip against the real repository extension', (t) => {
  ensureRuntimeDictionaryBuilt();
  const archivePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'zoopdog-extpkg-cli-')), 'zd-extension.zip');
  t.after(() => fs.rmSync(path.dirname(archivePath), {recursive: true, force: true}));

  const io1 = makeStreams();
  const code1 = cli.run(['build', '--extension', path.join(repoPaths.rootDir, 'zd-extension'), '--archive', archivePath], io1);
  assert.equal(code1, 0, io1.err.join(''));
  assert.match(io1.out.join(''), /^action=build /);

  const io2 = makeStreams();
  const code2 = cli.run(['verify', '--extension', path.join(repoPaths.rootDir, 'zd-extension'), '--archive', archivePath], io2);
  assert.equal(code2, 0, io2.err.join(''));
  assert.match(io2.out.join(''), /^action=verify /);
});

test('cli: --json emits a versioned JSON object', (t) => {
  ensureRuntimeDictionaryBuilt();
  const archivePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'zoopdog-extpkg-json-')), 'zd-extension.zip');
  t.after(() => fs.rmSync(path.dirname(archivePath), {recursive: true, force: true}));

  const io = makeStreams();
  const code = cli.run(['build', '--extension', path.join(repoPaths.rootDir, 'zd-extension'), '--archive', archivePath, '--json'], io);
  assert.equal(code, 0, io.err.join(''));
  const payload = JSON.parse(io.out.join(''));
  assert.equal(payload.ok, true);
  assert.equal(payload.schema, 'zoopdog.extension-package/1');
  assert.equal(payload.summary.manifestVersion, 3);
});

test('cli: unknown command exits with the usage code', () => {
  const io = makeStreams();
  const code = cli.run(['bogus'], io);
  assert.equal(code, 2);
  assert.match(io.err.join(''), /unknown_command/);
});

test('cli: verify against a tampered archive exits with the integrity code', (t) => {
  ensureRuntimeDictionaryBuilt();
  const archivePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'zoopdog-extpkg-tamper-')), 'zd-extension.zip');
  t.after(() => fs.rmSync(path.dirname(archivePath), {recursive: true, force: true}));
  cli.run(['build', '--extension', path.join(repoPaths.rootDir, 'zd-extension'), '--archive', archivePath], makeStreams());

  const buffer = fs.readFileSync(archivePath);
  buffer[buffer.length - 30] ^= 0xff; // flip a byte inside the central directory region
  fs.writeFileSync(archivePath, buffer);

  const io = makeStreams();
  const code = cli.run(['verify', '--extension', path.join(repoPaths.rootDir, 'zd-extension'), '--archive', archivePath, '--json'], io);
  assert.equal(code, 4);
  const payload = JSON.parse(io.err.join(''));
  assert.equal(payload.ok, false);
});

// --- real repository inventory --------------------------------------------------------------

test('inventory: the reviewed inventory matches what the current manifest/HTML/CSS reference', () => {
  ensureRuntimeDictionaryBuilt();
  const plan = buildPlan(path.join(repoPaths.rootDir, 'zd-extension'));
  assert.equal(plan.entries.length, realInventory.ALL_ENTRIES.length);
});
