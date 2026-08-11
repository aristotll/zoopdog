const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

const lifecycle = require('../scripts/check-openspec-lifecycle');

const cliPath = path.join(__dirname, '..', 'scripts', 'check-openspec-lifecycle.js');

// Every fixture lives in a temporary root. The suite must never read or write the
// repository's own openspec/ tree, because the command under test moves directories.
function makeRoot(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'zoopdog-openspec-')));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  return root;
}

function writeFile(root, relative, content) {
  const full = path.join(root, relative);
  fs.mkdirSync(path.dirname(full), {recursive: true});
  fs.writeFileSync(full, content);
  return full;
}

const DELTA = `## ADDED Requirements

### Requirement: Example behaviour
The system SHALL do the thing.

#### Scenario: It works
- **WHEN** asked
- **THEN** it does
`;

const DONE_TASKS = '## 1. Work\n\n- [x] 1.1 First\n- [x] 1.2 Second\n';

function makeChange(root, name, options = {}) {
  const {
    tasks = DONE_TASKS,
    omit = [],
    capability = 'example-capability',
    delta = DELTA
  } = options;

  for (const file of ['.openspec.yaml', 'proposal.md', 'design.md']) {
    if (!omit.includes(file)) {
      writeFile(root, `openspec/changes/${name}/${file}`, `# ${file}\n`);
    }
  }
  if (tasks !== null && !omit.includes('tasks.md')) {
    writeFile(root, `openspec/changes/${name}/tasks.md`, tasks);
  }
  if (delta !== null) {
    writeFile(root, `openspec/changes/${name}/specs/${capability}/spec.md`, delta);
  }
  return path.join(root, 'openspec', 'changes', name);
}

function runCli(root, args = []) {
  const result = spawnSync(process.execPath, [cliPath, '--root', root, ...args], {
    encoding: 'utf8',
    stdio: 'pipe'
  });
  return {status: result.status, output: `${result.stdout}${result.stderr}`};
}

// A content-aware fingerprint: catches a move, a create, a delete, and an in-place edit.
function snapshot(root) {
  return fs.readdirSync(root, {recursive: true, withFileTypes: true})
    .map((entry) => {
      const full = path.join(entry.parentPath, entry.name);
      const key = path.relative(root, full).split(path.sep).join('/');
      return entry.isFile() ? `${key}:${fs.readFileSync(full, 'utf8')}` : `${key}/`;
    })
    .sort();
}

test('a bare run reports state and writes nothing', (t) => {
  const root = makeRoot(t);
  makeChange(root, 'ready-change');
  const before = snapshot(root);

  const {status, output} = runCli(root);

  assert.equal(status, 0);
  assert.match(output, /Archive-eligible: ready-change/);
  assert.match(output, /ARCHIVE=1/, 'the report names the command that would archive');
  assert.deepEqual(snapshot(root), before, 'inspection must not touch the tree');
});

test('--archive --dry-run rehearses the move and writes nothing', (t) => {
  const root = makeRoot(t);
  makeChange(root, 'ready-change');
  const before = snapshot(root);

  const {status, output} = runCli(root, ['--archive', '--dry-run']);

  assert.equal(status, 0);
  assert.match(output, /Would promote openspec\/changes\/ready-change\/specs\/example-capability\/spec\.md/);
  assert.match(output, /Would archive openspec\/changes\/ready-change -> openspec\/changes\/archive\/\d{4}-\d{2}-\d{2}-ready-change/);
  assert.deepEqual(snapshot(root), before, 'a dry run must not touch the tree');
});

test('--archive moves the change directory', (t) => {
  const root = makeRoot(t);
  makeChange(root, 'ready-change');

  const {status, output} = runCli(root, ['--archive']);
  const stamp = lifecycle.todayStamp();

  assert.equal(status, 0, output);
  assert.equal(fs.existsSync(path.join(root, 'openspec/changes/ready-change')), false);
  assert.ok(fs.existsSync(path.join(root, `openspec/changes/archive/${stamp}-ready-change/proposal.md`)));
});

test('--dry-run without --archive is rejected', (t) => {
  const root = makeRoot(t);
  makeChange(root, 'ready-change');
  const before = snapshot(root);

  const {status, output} = runCli(root, ['--dry-run']);

  assert.notEqual(status, 0);
  assert.match(output, /--dry-run rehearses --archive/);
  assert.deepEqual(snapshot(root), before);
});

test('a complete change missing proposal.md is not archived and fails the run', (t) => {
  const root = makeRoot(t);
  makeChange(root, 'broken-change', {omit: ['proposal.md']});

  const {status, output} = runCli(root, ['--archive']);

  assert.equal(status, 1);
  assert.match(output, /openspec\/changes\/broken-change: missing proposal\.md/);
  assert.match(output, /Not archived: broken-change has structural issues/);
  assert.ok(fs.existsSync(path.join(root, 'openspec/changes/broken-change/tasks.md')),
    'a change with issues stays where the gate can still see it');
  assert.equal(fs.existsSync(path.join(root, 'openspec/changes/archive')), false);
});

test('an unchecked indented sub-task blocks archiving and is named', (t) => {
  const root = makeRoot(t);
  makeChange(root, 'nested-change', {
    tasks: '## 1. Work\n\n- [x] 1.1 Parent\n  - [ ] 1.1.1 Child unfinished\n- [x] 1.2 Other\n'
  });

  const {status, output} = runCli(root, ['--archive']);

  assert.equal(status, 0, output);
  assert.match(output, /Not archived: nested-change has 1 outstanding task/);
  assert.match(output, /1\.1\.1 Child unfinished/);
  assert.ok(fs.existsSync(path.join(root, 'openspec/changes/nested-change/tasks.md')));
});

test('parseTaskRows sees every checkbox a reader sees', () => {
  const rows = lifecycle.parseTaskRows(
    '- [x] top level\n  - [ ] indented dash\n\t* [X] tabbed star\n- [ ] plain\n'
  );

  assert.deepEqual(rows.map((row) => row.text),
    ['top level', 'indented dash', 'tabbed star', 'plain']);
  assert.deepEqual(rows.map((row) => row.checked), [true, false, true, false]);
  assert.deepEqual(rows.map((row) => row.indent), [0, 2, 1, 0]);
});

test('parseMarker keeps text after the marker and reasons containing parentheses', () => {
  const trailing = lifecycle.parseMarker(
    'Load extension (deferred: needs browser) then rerun make verify (see docs/build.md)',
    'deferred'
  );
  assert.equal(trailing.reason, 'needs browser');
  assert.equal(trailing.rest, 'Load extension then rerun make verify (see docs/build.md)');

  const nested = lifecycle.parseMarker(
    'Verify popup (deferred: needs Chrome (v120) installed)',
    'deferred'
  );
  assert.equal(nested.reason, 'needs Chrome (v120) installed');
  assert.equal(nested.rest, 'Verify popup');

  assert.equal(lifecycle.parseMarker('nothing here', 'deferred'), null);
  assert.equal(lifecycle.parseMarker('unbalanced (deferred: oops', 'deferred'), null);

  assert.equal(
    lifecycle.parseMarker('Write `- [x] thing (deferred: needs a browser)` when blocked', 'deferred'),
    null,
    'a marker inside an inline code span is documentation, not a record'
  );

  const afterCode = lifecycle.parseMarker(
    'Run `make verify (twice)` first (deferred: needs a browser)',
    'deferred'
  );
  assert.equal(afterCode.reason, 'needs a browser',
    'parens inside a code span must not disturb the balance scan');
  assert.equal(afterCode.rest, 'Run `make verify (twice)` first');
});

test('the operator queue reports deferrals and honours placeholders and resolutions', (t) => {
  const root = makeRoot(t);
  makeChange(root, 'queued-change', {
    tasks: [
      '## 1. Verification',
      '',
      '- [x] 1.1 Load extension (deferred: needs a Chrome profile (unpacked) here)',
      '- [x] 1.2 Syntax template (deferred: <reason>)',
      '- [x] 1.3a Docs say to write `- [x] thing (deferred: needs a browser)` when blocked',
      '- [x] 1.3 Old check (deferred: needed a browser) (resolved: 2026-08-12 done)',
      '- [x] 1.4 Nothing special',
      ''
    ].join('\n')
  });

  const rows = lifecycle.operatorQueue(root);
  assert.deepEqual(rows, [{
    change: 'queued-change',
    summary: '1.1 Load extension',
    reason: 'needs a Chrome profile (unpacked) here'
  }]);

  const withResolved = lifecycle.operatorQueue(root, {includeResolved: true});
  assert.deepEqual(withResolved.map((row) => row.reason),
    ['needs a Chrome profile (unpacked) here', 'needed a browser']);

  const {status, output} = runCli(root, ['--operator-queue']);
  assert.equal(status, 0);
  assert.match(output, /Operator queue \(1 deferred verification\(s\)\)/);
  assert.match(output, /needs a Chrome profile \(unpacked\) here/);
});

test('a delta is promoted into a canonical spec that carries no delta header', (t) => {
  const root = makeRoot(t);
  makeChange(root, 'promoting-change');

  const {status, output} = runCli(root, ['--archive']);
  assert.equal(status, 0, output);

  const canonical = path.join(root, 'openspec/specs/example-capability/spec.md');
  assert.ok(fs.existsSync(canonical), 'promotion creates the canonical spec');
  const text = fs.readFileSync(canonical, 'utf8');

  assert.doesNotMatch(text, /^## (?:ADDED|MODIFIED|REMOVED|RENAMED) Requirements$/m);
  assert.match(text, /^## Purpose$/m);
  assert.match(text, /^## Requirements$/m);
  assert.match(text, /### Requirement: Example behaviour/);
  assert.match(output, /Promoted spec delta to openspec\/specs\/example-capability\/spec\.md/);

  assert.deepEqual(lifecycle.checkCanonicalSpecs(root), [],
    'a promoted spec passes the canonical checks');
});

test('an existing canonical spec is never clobbered and blocks the archive', (t) => {
  const root = makeRoot(t);
  makeChange(root, 'conflicting-change');
  const canonical = writeFile(root, 'openspec/specs/example-capability/spec.md',
    '# hand written\n\n## Purpose\n\nMine.\n\n## Requirements\n\n### Requirement: Kept\nThe system SHALL stay.\n');
  const before = snapshot(root);

  const {status, output} = runCli(root, ['--archive']);

  assert.equal(status, 1);
  assert.match(output, /Refusing to archive/);
  assert.match(output, /openspec\/specs\/example-capability\/spec\.md \(already exists\)/);
  assert.match(fs.readFileSync(canonical, 'utf8'), /hand written/);
  assert.deepEqual(snapshot(root), before, 'a refused archive moves and writes nothing');
});

test('canonical heading checks are anchored and depth-independent', (t) => {
  const root = makeRoot(t);

  writeFile(root, 'openspec/specs/h3-purpose/spec.md',
    '# Spec\n\n### Purpose blurb\n\n## Requirements\n\n### Requirement: X\nThe system SHALL x.\n');
  writeFile(root, 'openspec/specs/lookalike/spec.md',
    '# Spec\n\n## Purpose\n\nWhy.\n\n### Requirements overview\n\n### Requirement: X\nThe system SHALL x.\n\n## Requirements\n');
  writeFile(root, 'openspec/specs/nested/deeper/spec.md',
    '# Spec\n\n## ADDED Requirements\n\n### Requirement: X\nThe system SHALL x.\n');

  const issues = lifecycle.checkCanonicalSpecs(root);

  assert.ok(issues.includes('openspec/specs/h3-purpose/spec.md: missing main ## Purpose section'),
    'an ### heading must not satisfy an ## requirement');
  assert.ok(issues.includes(
    'openspec/specs/lookalike/spec.md: requirement appears outside main ## Requirements section'),
  'the anchor must be the real ## heading, not an ### lookalike');
  assert.ok(issues.includes('openspec/specs/nested/deeper/spec.md: contains change-delta Requirements header'),
    'a spec nested more than one level deep is still validated');
});

test('operator-only tags advise deferral without ever implying completeness', (t) => {
  const root = makeRoot(t);
  makeChange(root, 'tagged-change', {
    tasks: '## 1. Work\n\n- [x] 1.1 Done\n- [ ] 1.2 Run it for real (operator-only)\n'
  });
  makeChange(root, 'untagged-change', {
    tasks: '## 1. Work\n\n- [x] 1.1 Done\n- [ ] 1.2 Ordinary unfinished work\n'
  });

  const {status, output} = runCli(root, ['--archive']);

  assert.equal(status, 0, output);
  assert.match(output, /Deferral candidate: tagged-change/);
  assert.doesNotMatch(output, /Deferral candidate: untagged-change/);
  assert.ok(fs.existsSync(path.join(root, 'openspec/changes/tagged-change/tasks.md')),
    'an operator-only task is still an open task');
  assert.equal(fs.existsSync(path.join(root, 'openspec/changes/archive')), false);
});

test('an archive collision gets a suffix and leaves the existing directory intact', (t) => {
  const root = makeRoot(t);
  makeChange(root, 'repeat-change');
  const stamp = lifecycle.todayStamp();
  const occupied = writeFile(root, `openspec/changes/archive/${stamp}-repeat-change/marker.md`, 'original\n');

  const {status, output} = runCli(root, ['--archive']);

  assert.equal(status, 0, output);
  assert.equal(fs.readFileSync(occupied, 'utf8'), 'original\n', 'the existing archive is untouched');
  assert.ok(fs.existsSync(path.join(root, `openspec/changes/archive/${stamp}-repeat-change-2/proposal.md`)));
});

test('a change with no checkbox tasks is an issue and is not archived', (t) => {
  const root = makeRoot(t);
  makeChange(root, 'taskless-change', {tasks: '## 1. Work\n\nProse with no checkboxes.\n'});

  const {status, output} = runCli(root, ['--archive']);

  assert.equal(status, 1);
  assert.match(output, /openspec\/changes\/taskless-change: tasks\.md has no checkbox tasks/);
  assert.ok(fs.existsSync(path.join(root, 'openspec/changes/taskless-change/tasks.md')));
});

test('an empty specs directory and a missing delta are both reported', (t) => {
  const root = makeRoot(t);
  makeChange(root, 'empty-specs', {delta: null});
  fs.mkdirSync(path.join(root, 'openspec/changes/empty-specs/specs/hollow'), {recursive: true});

  const issues = lifecycle.checkChange(root, path.join(root, 'openspec/changes/empty-specs'));

  assert.ok(issues.includes('openspec/changes/empty-specs: missing specs/**/spec.md'));
  assert.ok(issues.includes('openspec/changes/empty-specs/specs/hollow: empty specs directory'));
});
