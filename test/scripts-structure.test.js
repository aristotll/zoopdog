const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
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
});

test('runtime placeholders must be replaced exactly once', () => {
  const {renderRuntime} = require('../scripts/lib/userscript');

  assert.equal(renderRuntime('var A = __X__;', {'__X__': '1'}), 'var A = 1;');
  assert.throws(() => renderRuntime('var A = 1;', {'__X__': '1'}), /exactly once, found 0/);
  assert.throws(() => renderRuntime('__X__ __X__', {'__X__': '1'}), /exactly once, found 2/);
  assert.throws(() => renderRuntime('__ZOOPDOG_LEFTOVER__', {}), /Unreplaced runtime placeholder/);
});

test('an edit to a runtime source reaches the generated userscript', (t) => {
  const runtimePath = path.join(scriptsDir, 'userscript/nom-ruby.runtime.js');
  const targetPath = path.join(repoRoot, 'zoopdog-nom-ruby.user.js');
  const originalRuntime = fs.readFileSync(runtimePath);
  const originalTarget = fs.readFileSync(targetPath);
  t.after(() => {
    fs.writeFileSync(runtimePath, originalRuntime);
    fs.writeFileSync(targetPath, originalTarget);
  });

  const marker = '// zoopdog-runtime-edit-probe';
  fs.writeFileSync(runtimePath, `${marker}\n${originalRuntime.toString('utf8')}`);
  execFileSync(process.execPath, ['scripts/build-nom-userscript.js'], {cwd: repoRoot, stdio: 'pipe'});

  const rebuilt = fs.readFileSync(targetPath, 'utf8');
  assert.match(rebuilt, new RegExp(marker));
  assert.equal(
    rebuilt.replace(`${marker}\n`, ''),
    originalTarget.toString('utf8'),
    'the probe line is the only difference'
  );
});

test('both generated userscripts rebuild byte-identically', (t) => {
  const targets = [
    path.join(repoRoot, 'zoopdog-nom-ruby.user.js'),
    path.join(repoRoot, 'zoopdog-popupdict.user.js')
  ];
  const before = targets.map((target) => fs.readFileSync(target));
  t.after(() => targets.forEach((target, index) => {
    if (!fs.readFileSync(target).equals(before[index])) {
      fs.writeFileSync(target, before[index]);
    }
  }));

  for (const builder of ['scripts/build-nom-userscript.js', 'scripts/build-popupdict-userscript.js']) {
    execFileSync(process.execPath, [builder], {cwd: repoRoot, stdio: 'pipe'});
  }

  targets.forEach((target, index) => {
    assert.ok(fs.readFileSync(target).equals(before[index]),
      `${path.basename(target)} changed`);
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
    {name: 'mouseInRects', pattern: /function\s+mouseInRects\s*\(|(?:const|var|let)\s+mouseInRects\s*=/}
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
const SHARED_NAMES = ['zdIsWordChar', 'getWordAndContext', 'generateCandidates', 'mouseInRects'];

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

test('the extension loads the shared primitives before every script that uses them', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'zd-extension/manifest.json'), 'utf8'));
  const scripts = manifest.content_scripts[0].js;
  const shared = scripts.indexOf('js/zd-words.js');
  assert.notEqual(shared, -1, 'the manifest declares the shared source');

  for (const relative of sharedConsumers()) {
    if (!relative.startsWith('zd-extension/js/')) {
      continue;
    }
    const entry = relative.replace('zd-extension/', '');
    const position = scripts.indexOf(entry);
    if (position === -1) {
      continue; // not a content script; nothing to order
    }
    assert.ok(shared < position,
      `js/zd-words.js must precede ${entry}, got ${JSON.stringify(scripts)}`);
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
