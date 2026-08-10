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
