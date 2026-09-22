'use strict';

// A tiny atomic transaction journal that lets a killed process's mutation be diagnosed --
// and, when unambiguous, recovered -- instead of silently corrupting the workflow-owned files.
// It never stores file bytes, only hashes: the byte-level snapshot/rollback within one owning
// process is unchanged (see `fsutil.snapshotFiles`/`restoreSnapshot`); the journal exists only
// so a *different* process (or an operator) can tell whether an interrupted mutation ever
// touched disk.
const fs = require('node:fs');
const path = require('node:path');
const {atomicWrite} = require('../lib/fsutil');
const {CONTROL_DIR_NAME} = require('./lock');

const JOURNAL_SCHEMA_VERSION = 1;

function journalFilePath(repoRoot) {
  return path.join(repoRoot, CONTROL_DIR_NAME, 'journal.json');
}

function readJournal(repoRoot) {
  const file = journalFilePath(repoRoot);
  if (!fs.existsSync(file)) return null;
  try {
    const journal = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!journal || journal.schemaVersion !== JOURNAL_SCHEMA_VERSION) return null;
    return journal;
  } catch {
    return null;
  }
}

// `files` is an array of `{path, preHash, postHash}`. `postHash` is optional/undefined until
// the phase transitions to `committed`.
function writeJournal(repoRoot, {token, operation, phase, files}) {
  const journal = {
    schemaVersion: JOURNAL_SCHEMA_VERSION,
    token,
    operation,
    phase,
    updatedAt: new Date().toISOString(),
    files
  };
  atomicWrite(journalFilePath(repoRoot), `${JSON.stringify(journal, null, 2)}\n`);
  return journal;
}

function clearJournal(repoRoot) {
  const file = journalFilePath(repoRoot);
  if (fs.existsSync(file)) {
    fs.unlinkSync(file);
  }
}

module.exports = {
  JOURNAL_SCHEMA_VERSION,
  journalFilePath,
  readJournal,
  writeJournal,
  clearJournal
};
