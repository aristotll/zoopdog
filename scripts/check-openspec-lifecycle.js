#!/usr/bin/env node
'use strict';

// Lifecycle hygiene for the OpenSpec changes under openspec/. Inspecting is the default and
// never writes; archiving is opt-in, and a change only leaves the active set once it has
// passed the same structural gate that would have caught it there.

const fs = require('node:fs');
const path = require('node:path');
const {parseArgs} = require('node:util');
const repoPaths = require('./lib/paths');

const REQUIRED_FILES = ['proposal.md', 'design.md', 'tasks.md'];

// Indentation and list marker are both free: a sub-task a reader can see must be a task the
// completeness gate can see, or a checked parent silently archives its unchecked children.
const CHECKBOX_RE = /^([ \t]*)([-*]) \[([ xX])\][ \t]+(.+)$/gm;

// Headings are matched as whole lines. Substring containment lets `### Purpose blurb` satisfy
// a `## Purpose` requirement, and lets `### Requirements overview` stand in for the real
// `## Requirements` anchor when locating misplaced requirements.
const DELTA_HEADER_RE = /^## (?:ADDED|MODIFIED|REMOVED|RENAMED) Requirements[ \t]*$/m;
const PURPOSE_HEADER_RE = /^## Purpose[ \t]*$/m;
const REQUIREMENTS_HEADER_RE = /^## Requirements[ \t]*$/m;
const REQUIREMENT_RE = /^### Requirement:/m;

// A task only an operator can finish carries this tag, written by the task's author. Inferring
// it from prose makes the false-negative rate a function of vocabulary.
const OPERATOR_ONLY_RE = /\(operator-only\)/i;

// Task text that merely documents the deferral syntax, e.g. "(deferred: <reason>)", is a
// template rather than an outstanding verification.
const PLACEHOLDER_REASON_RE = /^(?:<[^>]*>|\.{3}|…|\s)*$/;

const OPERATOR_QUEUE_LIMIT = 40;
const OPERATOR_QUEUE_REASON_CHARS = 160;

function toPosix(value) {
  return value.split(path.sep).join('/');
}

function rel(root, target) {
  return toPosix(path.relative(root, target));
}

function isFile(target) {
  return fs.existsSync(target) && fs.statSync(target).isFile();
}

function isDirectory(target) {
  return fs.existsSync(target) && fs.statSync(target).isDirectory();
}

function walk(dir) {
  if (!isDirectory(dir)) {
    return [];
  }
  return fs.readdirSync(dir, {recursive: true, withFileTypes: true})
    .map((entry) => ({entry, full: path.join(entry.parentPath, entry.name)}));
}

function walkFiles(dir) {
  return walk(dir).filter(({entry}) => entry.isFile()).map(({full}) => full);
}

function walkDirectories(dir) {
  return walk(dir).filter(({entry}) => entry.isDirectory()).map(({full}) => full).sort();
}

function todayStamp(now = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

// --- parsing ---------------------------------------------------------------

function parseTaskRows(text) {
  const rows = [];
  for (const match of text.matchAll(CHECKBOX_RE)) {
    rows.push({
      indent: match[1].length,
      checked: match[3].toLowerCase() === 'x',
      text: match[4].trim(),
      line: text.slice(0, match.index).split('\n').length
    });
  }
  return rows;
}

// A marker inside an inline code span documents the syntax; it does not record a deferral.
// Masking preserves length, so offsets found in the mask still index the original text.
function maskCodeSpans(text) {
  return text.replace(/`[^`]*`/g, (span) => ' '.repeat(span.length));
}

// Walks from `(<name>:` to the parenthesis that closes it. A regex cannot do this: a greedy
// one runs to the last `)` on the line and eats the text after the marker, and a `[^)]+` one
// stops at the first `(` inside the reason and truncates it mid-phrase. `scan` is what the
// marker is located in; the returned strings are always sliced from `text`.
function parseMarker(text, name, scan = maskCodeSpans(text)) {
  const opener = new RegExp(`\\(${name}:`, 'i');
  const found = opener.exec(scan);
  if (!found) {
    return null;
  }
  const start = found.index;
  let depth = 0;
  let end = -1;
  for (let index = start; index < scan.length; index += 1) {
    if (scan[index] === '(') {
      depth += 1;
    } else if (scan[index] === ')') {
      depth -= 1;
      if (depth === 0) {
        end = index;
        break;
      }
    }
  }
  if (end === -1) {
    return null;
  }
  const rest = `${text.slice(0, start)} ${text.slice(end + 1)}`;
  return {
    reason: text.slice(start + found[0].length, end).trim(),
    rest: rest.replace(/\s+/g, ' ').trim().replace(/^[-—\s]+|[-—\s]+$/g, '')
  };
}

function isOperatorOnly(text) {
  return OPERATOR_ONLY_RE.test(text);
}

function readTaskRows(changeDir) {
  const tasksPath = path.join(changeDir, 'tasks.md');
  if (!isFile(tasksPath)) {
    return null;
  }
  return parseTaskRows(fs.readFileSync(tasksPath, 'utf8'));
}

// --- structural checks -----------------------------------------------------

function activeChangeDirs(root) {
  const changesDir = repoPaths.resolveIn(root, 'openspecChanges');
  if (!isDirectory(changesDir)) {
    return [];
  }
  return fs.readdirSync(changesDir, {withFileTypes: true})
    .filter((entry) => entry.isDirectory() && entry.name !== 'archive')
    .map((entry) => path.join(changesDir, entry.name))
    .sort();
}

function specDeltas(changeDir) {
  return walkFiles(path.join(changeDir, 'specs'))
    .filter((file) => path.basename(file) === 'spec.md')
    .sort();
}

function checkChange(root, changeDir, rows = readTaskRows(changeDir)) {
  const issues = [];
  const name = rel(root, changeDir);

  if (!isFile(path.join(changeDir, '.openspec.yaml'))) {
    issues.push(`${name}: missing .openspec.yaml`);
  }
  for (const filename of REQUIRED_FILES) {
    if (!isFile(path.join(changeDir, filename))) {
      issues.push(`${name}: missing ${filename}`);
    }
  }

  const specsDir = path.join(changeDir, 'specs');
  if (specDeltas(changeDir).length === 0) {
    issues.push(`${name}: missing specs/**/spec.md`);
  }
  for (const directory of walkDirectories(specsDir)) {
    if (walkFiles(directory).length === 0) {
      issues.push(`${rel(root, directory)}: empty specs directory`);
    }
  }

  if (rows && rows.length === 0) {
    issues.push(`${name}: tasks.md has no checkbox tasks`);
  }
  return issues;
}

function canonicalSpecFiles(root) {
  return walkFiles(repoPaths.resolveIn(root, 'openspecSpecs'))
    .filter((file) => path.basename(file) === 'spec.md')
    .sort();
}

function checkCanonicalSpecs(root) {
  const issues = [];
  for (const file of canonicalSpecFiles(root)) {
    const name = rel(root, file);
    const text = fs.readFileSync(file, 'utf8');

    if (DELTA_HEADER_RE.test(text)) {
      issues.push(`${name}: contains change-delta Requirements header`);
    }
    if (!PURPOSE_HEADER_RE.test(text)) {
      issues.push(`${name}: missing main ## Purpose section`);
    }

    const requirementsMatch = REQUIREMENTS_HEADER_RE.exec(text);
    if (!requirementsMatch) {
      issues.push(`${name}: missing main ## Requirements section`);
    }
    const requirementMatch = REQUIREMENT_RE.exec(text);
    if (requirementMatch && (!requirementsMatch || requirementMatch.index < requirementsMatch.index)) {
      issues.push(`${name}: requirement appears outside main ## Requirements section`);
    }
  }
  return issues;
}

// --- promotion -------------------------------------------------------------

function promotionPlan(root, changeDir) {
  const specsDir = path.join(changeDir, 'specs');
  return specDeltas(changeDir).map((delta) => {
    const capability = toPosix(path.relative(specsDir, path.dirname(delta)));
    return {
      capability,
      delta,
      destination: path.join(repoPaths.resolveIn(root, 'openspecSpecs'), capability, 'spec.md')
    };
  });
}

// Materialises a canonical spec from a delta: the delta's requirement blocks, under the
// `## Purpose` / `## Requirements` structure the canonical checks require. Merging a delta
// into an existing canonical spec changes meaning, so promotion refuses that case instead.
function promoteDeltaText(text, {capability, changeName}) {
  const withoutDeltaHeaders = text
    .split('\n')
    .filter((line) => !/^## (?:ADDED|MODIFIED|REMOVED|RENAMED) Requirements[ \t]*$/.test(line))
    .join('\n');

  const purposeMatch = /^## Purpose[ \t]*$([\s\S]*?)(?=^## |$(?![\s\S]))/m.exec(withoutDeltaHeaders);
  const purpose = purposeMatch
    ? purposeMatch[1].trim()
    : `Canonical specification for the \`${capability}\` capability, promoted from change \`${changeName}\`.`;

  const lines = withoutDeltaHeaders.split('\n');
  const firstRequirement = lines.findIndex((line) => /^### Requirement:/.test(line));
  const requirements = firstRequirement === -1 ? '' : lines.slice(firstRequirement).join('\n').trim();

  return `# ${capability}\n\n## Purpose\n\n${purpose}\n\n## Requirements\n\n${requirements}\n`;
}

// --- operator queue --------------------------------------------------------

function queueSources(root) {
  const entries = activeChangeDirs(root).map((dir) => ({name: path.basename(dir), dir}));
  const archiveRoot = repoPaths.resolveIn(root, 'openspecArchive');
  if (isDirectory(archiveRoot)) {
    for (const entry of fs.readdirSync(archiveRoot, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isDirectory()) {
        entries.push({name: entry.name, dir: path.join(archiveRoot, entry.name)});
      }
    }
  }
  return entries.filter(({dir}) => isFile(path.join(dir, 'tasks.md')));
}

function operatorQueue(root, {includeResolved = false} = {}) {
  const rows = [];
  for (const {name, dir} of queueSources(root)) {
    for (const task of readTaskRows(dir)) {
      const deferred = parseMarker(task.text, 'deferred');
      if (!deferred || PLACEHOLDER_REASON_RE.test(deferred.reason)) {
        continue;
      }
      const resolved = parseMarker(deferred.rest, 'resolved');
      if (resolved && !includeResolved) {
        continue;
      }
      let reason = deferred.reason.replace(/\s+/g, ' ');
      if (reason.length > OPERATOR_QUEUE_REASON_CHARS) {
        reason = `${reason.slice(0, OPERATOR_QUEUE_REASON_CHARS - 1).trimEnd()}…`;
      }
      rows.push({change: name, summary: resolved ? resolved.rest : deferred.rest, reason});
    }
  }
  return rows;
}

function printOperatorQueue(rows) {
  if (rows.length === 0) {
    console.log('Operator queue is empty: no deferred verifications outstanding');
    return;
  }
  console.log(`Operator queue (${rows.length} deferred verification(s)):`);
  for (const {change, summary, reason} of rows.slice(0, OPERATOR_QUEUE_LIMIT)) {
    console.log(`  [${change}] ${summary}`);
    console.log(`      reason: ${reason}`);
  }
  const remaining = rows.length - OPERATOR_QUEUE_LIMIT;
  if (remaining > 0) {
    console.log(`  ... and ${remaining} more (output bounded to ${OPERATOR_QUEUE_LIMIT})`);
  }
}

// --- report ----------------------------------------------------------------

function lifecycleReport(root) {
  const changes = activeChangeDirs(root).map((dir) => {
    // Read once per change and thread the rows through every pass that needs them.
    const parsed = readTaskRows(dir);
    const rows = parsed || [];
    const issues = checkChange(root, dir, parsed);
    const openTasks = rows.filter((row) => !row.checked);
    return {
      dir,
      name: path.basename(dir),
      issues,
      openTasks,
      complete: rows.length > 0 && openTasks.length === 0,
      eligible: issues.length === 0 && rows.length > 0 && openTasks.length === 0,
      deferralCandidate: openTasks.length > 0 && openTasks.every((row) => isOperatorOnly(row.text))
    };
  });
  return {
    changes,
    issues: [...changes.flatMap((change) => change.issues), ...checkCanonicalSpecs(root)]
  };
}

// --- archiving -------------------------------------------------------------

function archiveDestination(archiveRoot, name, stamp) {
  let target = path.join(archiveRoot, `${stamp}-${name}`);
  let suffix = 2;
  while (fs.existsSync(target)) {
    target = path.join(archiveRoot, `${stamp}-${name}-${suffix}`);
    suffix += 1;
  }
  return target;
}

// Total or absent: a rename that crosses a device boundary falls back to copy-then-remove
// rather than leaving the change half-moved.
function moveDirectory(source, destination) {
  fs.mkdirSync(path.dirname(destination), {recursive: true});
  try {
    fs.renameSync(source, destination);
  } catch (error) {
    if (error.code !== 'EXDEV') {
      throw error;
    }
    fs.cpSync(source, destination, {recursive: true});
    fs.rmSync(source, {recursive: true, force: true});
  }
}

function archivePlan(root, changes, stamp) {
  const archiveRoot = repoPaths.resolveIn(root, 'openspecArchive');
  return changes.map((change) => ({
    change,
    destination: archiveDestination(archiveRoot, change.name, stamp),
    promotions: promotionPlan(root, change.dir)
  }));
}

function runArchive(root, plans, {dryRun}) {
  for (const {change, destination, promotions} of plans) {
    for (const {capability, delta, destination: specPath} of promotions) {
      if (dryRun) {
        console.log(`Would promote ${rel(root, delta)} -> ${rel(root, specPath)}`);
        continue;
      }
      fs.mkdirSync(path.dirname(specPath), {recursive: true});
      fs.writeFileSync(specPath, promoteDeltaText(
        fs.readFileSync(delta, 'utf8'),
        {capability, changeName: change.name}
      ));
      console.log(`Promoted spec delta to ${rel(root, specPath)}`);
    }
    if (dryRun) {
      console.log(`Would archive ${rel(root, change.dir)} -> ${rel(root, destination)}`);
      continue;
    }
    moveDirectory(change.dir, destination);
    console.log(`Archived completed OpenSpec change: ${rel(root, destination)}`);
  }
}

// --- cli -------------------------------------------------------------------

const USAGE = [
  'Usage: check-openspec-lifecycle.js [options]',
  '',
  '  (no options)        Report lifecycle state. Writes nothing.',
  '  --archive           Archive every eligible change and promote its spec deltas.',
  '  --dry-run           With --archive, print the planned moves without performing them.',
  '  --operator-queue    List deferred operator verifications, then exit.',
  '  --include-resolved  With --operator-queue, also show entries marked (resolved: ...).',
  '  --root <dir>        Repository root to inspect. Defaults to this repository.'
].join('\n');

function run(argv, root = repoPaths.rootDir) {
  let values;
  try {
    ({values} = parseArgs({
      args: argv,
      options: {
        archive: {type: 'boolean', default: false},
        'dry-run': {type: 'boolean', default: false},
        'operator-queue': {type: 'boolean', default: false},
        'include-resolved': {type: 'boolean', default: false},
        root: {type: 'string'}
      },
      strict: true,
      allowPositionals: false
    }));
  } catch (error) {
    console.error(`${error.message}\n\n${USAGE}`);
    return 2;
  }

  const base = values.root ? path.resolve(values.root) : root;

  if (values['dry-run'] && !values.archive) {
    console.error(`--dry-run rehearses --archive and does nothing on its own.\n\n${USAGE}`);
    return 2;
  }

  if (values['operator-queue']) {
    printOperatorQueue(operatorQueue(base, {includeResolved: values['include-resolved']}));
    return 0;
  }

  const report = lifecycleReport(base);
  const eligible = report.changes.filter((change) => change.eligible);

  if (values.archive) {
    const plans = archivePlan(base, eligible, todayStamp());
    const conflicts = plans.flatMap(({promotions}) =>
      promotions.filter(({destination}) => fs.existsSync(destination)));

    if (conflicts.length > 0) {
      console.error('Refusing to archive: a canonical spec already exists for a promoted delta.');
      for (const {delta, destination} of conflicts) {
        console.error(`  ${rel(base, delta)} -> ${rel(base, destination)} (already exists)`);
      }
      console.error('  Merge the delta into the canonical spec by hand, then re-run.');
      return 1;
    }
    runArchive(base, plans, {dryRun: values['dry-run']});
  } else {
    for (const change of eligible) {
      console.log(`Archive-eligible: ${change.name}`);
      console.log('  Run `make check-openspec ARCHIVE=1` to archive it and promote its spec deltas.');
    }
  }

  if (values.archive) {
    for (const change of report.changes) {
      if (change.eligible || change.openTasks.length === 0) {
        continue;
      }
      console.log(`Not archived: ${change.name} has ${change.openTasks.length} outstanding task(s):`);
      for (const task of change.openTasks.slice(0, 10)) {
        console.log(`  - ${task.text.replace(/\s+/g, ' ').slice(0, 200)}`);
      }
    }
  }

  for (const change of report.changes) {
    if (!change.deferralCandidate) {
      continue;
    }
    console.log(`Deferral candidate: ${change.name} (only operator-only tasks remain)`);
    for (const task of change.openTasks) {
      console.log(`  - ${task.text.replace(/\s+/g, ' ').slice(0, 200)}`);
    }
    console.log("  Convert to '- [x] ... (deferred: <accurate reason>)' to make it archive-eligible.");
  }

  for (const change of report.changes) {
    if (change.complete && change.issues.length > 0) {
      console.log(`Not archived: ${change.name} has structural issues (listed below).`);
    }
  }

  if (report.issues.length > 0) {
    console.log('OpenSpec lifecycle issues found:');
    for (const issue of report.issues) {
      console.log(`  ${issue}`);
    }
    return 1;
  }
  console.log('OK: OpenSpec active changes are structurally actionable');
  return 0;
}

module.exports = {
  parseTaskRows,
  parseMarker,
  maskCodeSpans,
  isOperatorOnly,
  checkChange,
  checkCanonicalSpecs,
  promotionPlan,
  promoteDeltaText,
  operatorQueue,
  lifecycleReport,
  archiveDestination,
  todayStamp,
  run
};

if (require.main === module) {
  process.exitCode = run(process.argv.slice(2));
}
