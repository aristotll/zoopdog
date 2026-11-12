'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');

test('release orders builders before minification and stops on errors under parallel make', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zoopdog-make-'));
  try {
    const mock = path.join(dir, 'node-mock');
    fs.writeFileSync(mock, `#!/bin/sh\nname="$1"\nprintf 'start %s\\n' "$name" >> "$EVENTS"\ncase "$name" in *build-nom-userscript.js|*build-popupdict-userscript.js) sleep 0.1;; esac\nif [ "$name" = "$FAIL_SCRIPT" ]; then exit 1; fi\nprintf 'end %s\\n' "$name" >> "$EVENTS"\n`);
    fs.chmodSync(mock, 0o755);
    for (const jobs of ['-j1', '-j4']) for (const failed of ['', 'scripts/release-inputs.js',
      'scripts/build-nom-userscript.js', 'scripts/build-popupdict-userscript.js',
      'scripts/build-extension-vnedict-json.js', 'scripts/minify-userscripts.js']) {
      const events = path.join(dir, 'events');
      fs.writeFileSync(events, '');
      const result = spawnSync('make', [jobs, 'release-userscripts', `NODE=${mock}`, 'DRY_RUN=1'], {
        cwd: root, env: {...process.env, EVENTS: events, FAIL_SCRIPT: failed}, encoding: 'utf8'
      });
      const lines = fs.readFileSync(events, 'utf8').trim().split('\n');
      const minify = lines.indexOf('start scripts/minify-userscripts.js');
      const publish = lines.indexOf('start scripts/release-userscripts.js');
      if (failed) assert.notEqual(result.status, 0, result.stdout + result.stderr);
      else assert.equal(result.status, 0, result.stdout + result.stderr);
      if (failed.includes('build-') || failed === 'scripts/release-inputs.js') assert.equal(minify, -1);
      else {
        assert.ok(minify > lines.indexOf('end scripts/build-nom-userscript.js'));
        assert.ok(minify > lines.indexOf('end scripts/build-popupdict-userscript.js'));
      }
      if (failed) assert.equal(publish, -1);
      else assert.ok(publish > lines.indexOf('end scripts/minify-userscripts.js'));
    }
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

test('verification preserves the first test failure without a rebuild retry', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zoopdog-verify-'));
  try {
    const mock = path.join(dir, 'node-mock');
    const events = path.join(dir, 'events');
    fs.writeFileSync(mock, '#!/bin/sh\nprintf "%s\\n" "$*" >> "$EVENTS"\nexit 1\n');
    fs.chmodSync(mock, 0o755);
    const result = spawnSync('make', ['verify-scripts', `NODE=${mock}`], {
      cwd: root, env: {...process.env, EVENTS: events}, encoding: 'utf8'
    });
    assert.notEqual(result.status, 0);
    const lines = fs.readFileSync(events, 'utf8').trim().split('\n');
    assert.equal(lines.length, 1);
    assert.equal(lines[0], 'scripts/test-isolated.js');
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

test('release rebuilds even when old, missing, or newer generated files exist', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zoopdog-make-artifacts-'));
  try {
    fs.copyFileSync(path.join(root, 'Makefile'), path.join(dir, 'Makefile'));
    const mock = path.join(dir, 'node-mock');
    const events = path.join(dir, 'events');
    fs.writeFileSync(mock, '#!/bin/sh\nprintf "%s\\n" "$1" >> "$EVENTS"\n');
    fs.chmodSync(mock, 0o755);
    for (const scenario of ['missing', 'stale', 'newer']) {
      if (scenario !== 'missing') {
        for (const name of ['zoopdog-nom-ruby.user.js', 'zoopdog-popupdict.user.js']) {
          const file = path.join(dir, name);
          fs.writeFileSync(file, scenario);
          const time = scenario === 'stale' ? new Date('2000-01-01') : new Date('2099-01-01');
          fs.utimesSync(file, time, time);
        }
      }
      fs.writeFileSync(events, '');
      const result = spawnSync('make', ['-j4', 'release-userscripts', `NODE=${mock}`, 'DRY_RUN=1'], {
        cwd: dir, env: {...process.env, EVENTS: events}, encoding: 'utf8'
      });
      assert.equal(result.status, 0, `${scenario}: ${result.stdout} ${result.stderr}`);
      const calls = fs.readFileSync(events, 'utf8').trim().split('\n');
      for (const script of ['scripts/build-nom-userscript.js', 'scripts/build-popupdict-userscript.js', 'scripts/build-extension-vnedict-json.js']) {
        assert.equal(calls.filter(call => call === script).length, 1, `${scenario}: ${script}`);
        assert.ok(calls.indexOf(script) < calls.indexOf('scripts/minify-userscripts.js'));
      }
      assert.ok(calls.indexOf('scripts/minify-userscripts.js') < calls.indexOf('scripts/release-userscripts.js'));
    }
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});
