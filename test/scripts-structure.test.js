const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');

const {makeRealBuildCopy} = require('./helpers/real-build-copy');
const {ensureUserscriptsBuilt} = require('./helpers/ensure-built');
const repoRoot = path.resolve(__dirname, '..');

ensureUserscriptsBuilt();
const scriptsDir = path.join(repoRoot, 'scripts');

function scriptFiles() {
  return fs.readdirSync(scriptsDir, {recursive: true, withFileTypes: true})
    .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
    .map((entry) => path.relative(scriptsDir, path.join(entry.parentPath, entry.name)));
}

test('shared primitives are defined in exactly one place', () => {
  const forbidden = [
    {name: 'cleanText', pattern: /function\s+cleanText\s*\(|const\s+cleanText\s*=\s*function/},
    {name: 'normalizeTerm', pattern: /function\s+normalizeTerm\s*\(|const\s+normalizeTerm\s*=\s*function/},
    {name: 'stableUnique', pattern: /function\s+stableUnique\s*\(/},
    {name: 'foldAccents', pattern: /function\s+foldAccents\s*\(/},
    {name: 'isEmbeddableTerm', pattern: /function\s+isEmbeddableTerm\s*\(/}
  ];

  const offenders = [];
  for (const relative of scriptFiles()) {
    if (relative.startsWith(`lib${path.sep}`) || relative.startsWith('userscript' + path.sep)) {
      continue;
    }
    const source = fs.readFileSync(path.join(scriptsDir, relative), 'utf8');
    for (const {name, pattern} of forbidden) {
      if (pattern.test(source)) {
        offenders.push(`scripts/${relative} redefines ${name}`);
      }
    }
  }

  assert.deepEqual(offenders, [], 'shared primitives belong in scripts/lib/');
});

test('the CJK code-point range literal appears only in scripts/lib/cjk.js', () => {
  const rangePattern = /\\u3400-\\u4DBF|㐀-䶿/;
  const offenders = scriptFiles()
    .filter((relative) => relative !== `lib${path.sep}cjk.js`)
    .filter((relative) => rangePattern.test(fs.readFileSync(path.join(scriptsDir, relative), 'utf8')))
    // The extracted browser runtime is standalone code shipped to users; it cannot import
    // from scripts/lib, so it legitimately carries its own copy.
    .filter((relative) => !relative.startsWith(`userscript${path.sep}`));

  assert.deepEqual(offenders, []);
});

test('every executable script guards its command-line behaviour', () => {
  // A shebang is what marks a file as runnable; pure library modules have none and need no
  // guard. The import probe below is what proves neither kind acts on require().
  const executables = scriptFiles().filter((relative) =>
    fs.readFileSync(path.join(scriptsDir, relative), 'utf8').startsWith('#!'));

  assert.ok(executables.length >= 5, `expected the CLI scripts, found ${executables.length}`);

  const missing = executables.filter((relative) => !/require\.main === module/.test(
    fs.readFileSync(path.join(scriptsDir, relative), 'utf8')
  ));

  assert.deepEqual(missing, [], 'executable scripts must not act on import');
});

test('importing any script performs no writes and spawns no process', () => {
  const probe = `
    const fs = require('node:fs');
    const cp = require('node:child_process');
    for (const name of ['writeFileSync', 'renameSync', 'unlinkSync', 'rmSync', 'appendFileSync']) {
      fs[name] = () => { throw new Error('import wrote a file via fs.' + name); };
    }
    for (const name of ['spawnSync', 'execSync', 'execFileSync', 'spawn', 'exec']) {
      cp[name] = () => { throw new Error('import spawned a process via child_process.' + name); };
    }
    for (const relative of process.argv.slice(1)) {
      require(relative);
    }
    console.log('clean');
  `;
  const probePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'zoopdog-probe-')), 'probe.js');
  fs.writeFileSync(probePath, probe);

  const targets = scriptFiles()
    .filter((relative) => !relative.startsWith(`userscript${path.sep}`))
    .map((relative) => path.join(scriptsDir, relative));

  const output = execFileSync(process.execPath, [probePath, ...targets], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: 'pipe'
  });
  assert.match(output, /clean/);
});

test('builders assemble the runtime instead of inlining it', () => {
  for (const builder of ['build-nom-userscript.js', 'build-popupdict-userscript.js']) {
    const source = fs.readFileSync(path.join(scriptsDir, builder), 'utf8');
    assert.doesNotMatch(source, /==UserScript==/,
      `${builder} must not inline the userscript header`);
    assert.match(source, /readRuntime\(/, `${builder} reads its runtime from a source file`);
  }

  for (const runtime of ['nom-ruby.runtime.js', 'popupdict.runtime.js']) {
    const source = fs.readFileSync(path.join(scriptsDir, 'userscript', runtime), 'utf8');
    assert.match(source, /==UserScript==/);
    assert.doesNotMatch(source, /\\\\[sn]/,
      `${runtime} stores patterns as the browser sees them, with no doubled backslashes`);
    assert.doesNotThrow(
      () => execFileSync(process.execPath, ['--check', path.join(scriptsDir, 'userscript', runtime)],
        {stdio: 'pipe'}),
      `${runtime} is syntax-checked as code`
    );
  }

  // popupdict-local.runtime.js is a fragment concatenated inside popupdict.runtime.js's IIFE
  // (see __ZOOPDOG_RUNTIME_SOURCES__), so it carries no header of its own -- wrap it in one to
  // check its syntax the same way as any other runtime source.
  const localFragmentPath = path.join(scriptsDir, 'userscript', 'popupdict-local.runtime.js');
  const localFragment = fs.readFileSync(localFragmentPath, 'utf8');
  assert.doesNotMatch(localFragment, /==UserScript==/,
    'popupdict-local.runtime.js is a fragment, not a standalone userscript');
  const probePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'zoopdog-fragment-')), 'probe.js');
  fs.writeFileSync(probePath, `(function() {\n${localFragment}\n})();`);
  assert.doesNotThrow(
    () => execFileSync(process.execPath, ['--check', probePath], {stdio: 'pipe'}),
    'popupdict-local.runtime.js is syntax-checked as code'
  );
});

test('runtime placeholders must be replaced exactly once', () => {
  const {renderRuntime} = require('../scripts/lib/userscript');

  assert.equal(renderRuntime('var A = __X__;', {'__X__': '1'}), 'var A = 1;');
  assert.throws(() => renderRuntime('var A = 1;', {'__X__': '1'}), /exactly once, found 0/);
  assert.throws(() => renderRuntime('__X__ __X__', {'__X__': '1'}), /exactly once, found 2/);
  assert.throws(() => renderRuntime('__ZOOPDOG_LEFTOVER__', {}), /Unreplaced runtime placeholder/);
});

test('an edit to a runtime source reaches the generated userscript', (t) => {
  const originalRuntime = fs.readFileSync(path.join(scriptsDir, 'userscript/nom-ruby.runtime.js'));
  const originalTarget = fs.readFileSync(path.join(repoRoot, 'zoopdog-nom-ruby.user.js'));

  const dir = makeRealBuildCopy(t, repoRoot);
  const runtimePath = path.join(dir, 'scripts/userscript/nom-ruby.runtime.js');
  const targetPath = path.join(dir, 'zoopdog-nom-ruby.user.js');
  // Seeded with the real current file so writeVersionedUserscript's version-continuity check
  // (it reads whatever is already at the target path) behaves exactly as a real in-place
  // rebuild would, without ever touching the original.
  fs.writeFileSync(targetPath, originalTarget);

  const marker = '// zoopdog-runtime-edit-probe';
  fs.writeFileSync(runtimePath, `${marker}\n${originalRuntime.toString('utf8')}`);
  execFileSync(process.execPath, ['scripts/build-nom-userscript.js'], {cwd: dir, stdio: 'pipe'});

  const {readUserscriptVersion, setUserscriptVersion, PENDING_VERSION, compareVersions} =
    require('../scripts/lib/userscript');
  const original = originalTarget.toString('utf8');
  const rebuilt = fs.readFileSync(targetPath, 'utf8');
  assert.match(rebuilt, new RegExp(marker));
  assert.equal(
    setUserscriptVersion(rebuilt.replace(`${marker}\n`, ''), PENDING_VERSION),
    setUserscriptVersion(original, PENDING_VERSION),
    'the probe line and the version stamp are the only differences'
  );
  assert.ok(
    compareVersions(readUserscriptVersion(rebuilt), readUserscriptVersion(original)) > 0,
    'a changed runtime raises the version so installed copies update'
  );
});

test('generated userscripts declare a stamped version and their update location', () => {
  const repoPaths = require('../scripts/lib/paths');
  const {readUserscriptVersion, PENDING_VERSION} = require('../scripts/lib/userscript');

  for (const key of ['nomUserscript', 'popupUserscript']) {
    const source = fs.readFileSync(path.join(repoRoot, repoPaths.relative[key]), 'utf8');
    const url = repoPaths.releaseUrl(key);
    const version = readUserscriptVersion(source);

    assert.ok(version && version !== PENDING_VERSION, `${key} carries a real @version`);
    assert.match(source, new RegExp(`^// @updateURL\\s+${url}$`, 'm'));
    assert.match(source, new RegExp(`^// @downloadURL\\s+${url}$`, 'm'));
  }
});

test('the -local userscripts carry local-mode grants and update from their own file, not github', () => {
  const repoPaths = require('../scripts/lib/paths');
  const {readUserscriptVersion, PENDING_VERSION} = require('../scripts/lib/userscript');

  for (const builder of ['scripts/build-nom-userscript.js', 'scripts/build-popupdict-userscript.js']) {
    execFileSync(process.execPath, [builder], {cwd: repoRoot, stdio: 'pipe'});
  }

  for (const [mainKey, localKey] of [
    ['nomUserscript', 'nomLocalUserscript'],
    ['popupUserscript', 'popupLocalUserscript']
  ]) {
    const mainSource = fs.readFileSync(repoPaths.absolute[mainKey], 'utf8');
    const localSource = fs.readFileSync(repoPaths.absolute[localKey], 'utf8');
    const localUrl = repoPaths.localFileUrl(localKey);
    const localVersion = readUserscriptVersion(localSource);

    assert.ok(localVersion && localVersion !== PENDING_VERSION, `${localKey} carries a real @version`);
    assert.match(localSource, /^\/\/ @name\s+.+\(Local\)$/m, `${localKey} names itself distinctly`);
    assert.doesNotMatch(mainSource, /\(Local\)/, `${mainKey} does not carry the -local suffix`);
    assert.match(localSource, new RegExp(`^// @updateURL\\s+${localUrl.replace(/\//g, '\\/')}$`, 'm'));
    assert.match(localSource, new RegExp(`^// @downloadURL\\s+${localUrl.replace(/\//g, '\\/')}$`, 'm'));
    assert.doesNotMatch(mainSource, new RegExp(localUrl.replace(/\//g, '\\/')),
      `${mainKey} never points at a local file:// URL`);
  }

  const popupLocalSource = fs.readFileSync(repoPaths.absolute.popupLocalUserscript, 'utf8');
  const popupMainSource = fs.readFileSync(repoPaths.absolute.popupUserscript, 'utf8');

  assert.match(popupLocalSource, /@grant\s+GM_xmlhttpRequest/,
    'popupdict-local grants GM_xmlhttpRequest for local mode');
  assert.match(popupLocalSource, /@connect\s+127\.0\.0\.1/);
  assert.match(popupLocalSource, /function zooRenderLocalActions/,
    'popupdict-local inlines the local-mode runtime');
  assert.doesNotMatch(popupMainSource, /GM_xmlhttpRequest/,
    'the github-hosted popupdict never asks for the local-mode grant');
  assert.doesNotMatch(popupMainSource, /function zooRenderLocalActions/,
    'the github-hosted popupdict never inlines the local-mode runtime');
});

test('both generated userscripts rebuild byte-identically', (t) => {
  const relativeTargets = ['zoopdog-nom-ruby.user.js', 'zoopdog-popupdict.user.js'];
  const before = relativeTargets.map((relative) => fs.readFileSync(path.join(repoRoot, relative)));

  const dir = makeRealBuildCopy(t, repoRoot);
  // Seeded with the real current files so writeVersionedUserscript's version-continuity check
  // (it reads whatever is already at the target path) behaves exactly as a real in-place
  // rebuild would, without ever touching the originals.
  relativeTargets.forEach((relative, index) => {
    fs.writeFileSync(path.join(dir, relative), before[index]);
  });

  for (const builder of ['scripts/build-nom-userscript.js', 'scripts/build-popupdict-userscript.js']) {
    execFileSync(process.execPath, [builder], {cwd: dir, stdio: 'pipe'});
  }

  relativeTargets.forEach((relative, index) => {
    assert.ok(fs.readFileSync(path.join(dir, relative)).equals(before[index]),
      `${relative} changed`);
  });
});

// Browser-facing sources: the extension content script, the website page script, and the
// userscript runtime. Third-party bundles under lib/ are excluded — they are not ours to edit.
function browserSources() {
  const roots = [
    {dir: path.join(repoRoot, 'js'), label: 'js'},
    {dir: path.join(repoRoot, 'zd-extension/js'), label: 'zd-extension/js'},
    {dir: path.join(repoRoot, 'scripts/userscript'), label: 'scripts/userscript'}
  ];

  const files = [];
  for (const {dir, label} of roots) {
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
      if (!entry.isFile() || !entry.name.endsWith('.js')) {
        continue;
      }
      files.push({relative: `${label}/${entry.name}`, absolute: path.join(dir, entry.name)});
    }
  }
  return files;
}

test('the Vietnamese word primitives are defined in exactly one browser source', () => {
  const definitions = [
    {name: 'ZD_WORD_CHAR_RE', pattern: /(?:const|var|let)\s+ZD_WORD_CHAR_RE\s*=/},
    {name: 'zdIsWordChar', pattern: /function\s+zdIsWordChar\s*\(|(?:const|var|let)\s+zdIsWordChar\s*=/},
    {name: 'getWordAndContext', pattern: /function\s+getWordAndContext\s*\(|(?:const|var|let)\s+getWordAndContext\s*=/},
    {name: 'generateCandidates', pattern: /function\s+generateCandidates\s*\(|(?:const|var|let)\s+generateCandidates\s*=/},
    {name: 'mouseInRects', pattern: /function\s+mouseInRects\s*\(|(?:const|var|let)\s+mouseInRects\s*=/},
    {name: 'zdNextTextNode', pattern: /function\s+zdNextTextNode\s*\(|(?:const|var|let)\s+zdNextTextNode\s*=/},
    {name: 'zdContainerBoundary', pattern: /function\s+zdContainerBoundary\s*\(|(?:const|var|let)\s+zdContainerBoundary\s*=/},
    {name: 'zdGatherFollowingContext', pattern: /function\s+zdGatherFollowingContext\s*\(|(?:const|var|let)\s+zdGatherFollowingContext\s*=/}
  ];

  const sites = new Map(definitions.map(({name}) => [name, []]));
  for (const {relative, absolute} of browserSources()) {
    const source = fs.readFileSync(absolute, 'utf8');
    for (const {name, pattern} of definitions) {
      if (pattern.test(source)) {
        sites.get(name).push(relative);
      }
    }
  }

  for (const [name, found] of sites) {
    assert.deepEqual(found, ['zd-extension/js/zd-words.js'],
      `${name} must be defined only in the shared source, found in: ${found.join(', ') || '(nowhere)'}`);
  }
});

test('no browser source carries a second copy of the word character class', () => {
  // Compared by code-point set, not by text. Other Vietnamese classes legitimately exist for
  // other jobs — the Nom ruby runtime matches digits and combining marks as well — and this
  // check must flag only a literal that means the same thing as the shared one.
  const expand = (body) => {
    const points = new Set();
    for (let i = 0; i < body.length; i++) {
      if (body[i + 1] === '-' && body[i + 2] && body[i] !== '\\') {
        for (let code = body.codePointAt(i); code <= body.codePointAt(i + 2); code++) {
          points.add(String.fromCodePoint(code));
        }
        i += 2;
        continue;
      }
      points.add(body[i]);
    }
    return points;
  };
  const sameSet = (a, b) => a.size === b.size && [...a].every((ch) => b.has(ch));

  const shared = require('../zd-extension/js/zd-words').ZD_WORD_CHAR_RE;
  const sharedSet = expand(shared.source.replace(/^\[|\]$/g, ''));

  const offenders = [];
  for (const {relative, absolute} of browserSources()) {
    if (relative === 'zd-extension/js/zd-words.js') {
      continue;
    }
    const source = fs.readFileSync(absolute, 'utf8');
    for (const match of source.matchAll(/\/\[([^\]]{40,})\]\/[a-z]*/g)) {
      if (sameSet(expand(match[1]), sharedSet)) {
        offenders.push(relative);
      }
    }
  }

  assert.deepEqual(offenders, [],
    'the word character class lives only in zd-extension/js/zd-words.js');
});

// A file consumes the shared primitives if it calls one of them without declaring it. Load
// order matters for every such file, not just the obvious one: highlighter.js called the old
// global from a script the manifest happens to list last, and nothing caught it.
const SHARED_NAMES = [
  'zdIsWordChar', 'getWordAndContext', 'generateCandidates', 'mouseInRects',
  'zdNextTextNode', 'zdContainerBoundary'
];

function sharedConsumers() {
  return browserSources()
    .filter(({relative}) => relative !== 'zd-extension/js/zd-words.js')
    .filter(({absolute}) => {
      const source = fs.readFileSync(absolute, 'utf8');
      return SHARED_NAMES.some((name) => new RegExp(`\\b${name}\\s*\\(`).test(source));
    })
    .map(({relative}) => relative);
}

test('no browser source calls the retired global word character class', () => {
  const offenders = browserSources().filter(({absolute}) => {
    const source = fs.readFileSync(absolute, 'utf8');
    // `.match(chars)` / `.test(chars)` against a global that no longer exists. A local
    // `var chars = ...` for something unrelated is fine.
    return /\.(?:match|test)\(chars\)/.test(source);
  }).map(({relative}) => relative);

  assert.deepEqual(offenders, [],
    'use zdIsWordChar from zd-extension/js/zd-words.js instead of a global `chars`');
});

test('the website loads the shared primitives before every script that uses them', () => {
  const source = fs.readFileSync(path.join(repoRoot, 'popupdict.jade'), 'utf8');
  const shared = source.indexOf('zd-extension/js/zd-words.js');
  assert.notEqual(shared, -1, 'popupdict.jade loads the shared source');

  for (const relative of sharedConsumers()) {
    if (!relative.startsWith('zd-extension/js/')) {
      continue;
    }
    const position = source.indexOf(relative);
    if (position === -1) {
      continue; // not loaded by this page; nothing to order
    }
    assert.ok(shared < position,
      `zd-words.js must precede ${relative} in popupdict.jade`);
  }
});

test('the website page loads the shared primitives before every script that uses them', () => {
  const consumers = sharedConsumers()
    .map((relative) => relative.replace(/^zd-extension\/js\//, 'zd-extension/js/'));

  for (const file of ['popupdict.jade', 'popupdict.html']) {
    const source = fs.readFileSync(path.join(repoRoot, file), 'utf8');
    const shared = source.indexOf('zd-extension/js/zd-words.js');
    assert.notEqual(shared, -1, `${file} references the shared source`);

    for (const consumer of consumers) {
      const position = source.indexOf(consumer);
      if (position === -1) {
        continue; // this page does not load that consumer
      }
      assert.ok(shared < position, `${file} loads zd-words.js before ${consumer}`);
    }
  }
});

test('the popup userscript builder inlines the shared primitives ahead of its runtime', () => {
  const builder = fs.readFileSync(
    path.join(repoRoot, 'scripts/build-popupdict-userscript.js'),
    'utf8'
  );
  assert.match(builder, /'zd-extension\/js\/zd-words\.js'/,
    'the builder lists the shared source among its runtime sources');

  const generated = fs.readFileSync(path.join(repoRoot, 'zoopdog-popupdict.user.js'), 'utf8');
  const definition = generated.indexOf('function getWordAndContext');
  const call = generated.indexOf('origin = getWordAndContext(');

  assert.notEqual(definition, -1, 'the generated userscript carries the shared definition');
  assert.notEqual(call, -1, 'the generated userscript still calls it');
  assert.ok(definition < call, 'the definition is inlined before the call site');
});
