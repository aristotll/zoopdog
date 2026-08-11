'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {WorkflowError} = require('./errors');

// The whole point of this surface: an agent can set these six fields and nothing else.
// Source hashes, source items, and entry identity are not addressable, so the failure modes
// that came from hand-editing a strict manifest are unreachable rather than merely discouraged.
const DECISION_FIELDS = Object.freeze(['id', 'decision', 'nom', 'explain', 'vi', 'replace']);

function readDecisions(source) {
  let raw;
  if (source === '-') {
    try {
      raw = fs.readFileSync(0, 'utf8');
    } catch (error) {
      throw new WorkflowError('decisions_unreadable', `Unable to read decisions from stdin: ${error.message}`);
    }
  } else {
    try {
      raw = fs.readFileSync(path.resolve(source), 'utf8');
    } catch (error) {
      throw new WorkflowError('decisions_unreadable', `Unable to read decisions: ${error.message}`);
    }
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new WorkflowError('decisions_unreadable', `Unable to parse decisions: ${error.message}`);
  }
  if (!Array.isArray(parsed)) {
    throw new WorkflowError('decisions_shape_invalid', 'Decisions must be a JSON array.');
  }
  return parsed;
}

// Every decision is checked before any is written, so a rejected batch leaves the manifest
// exactly as it was instead of half-applied.
function applyDecisions(manifest, decisions) {
  if (!manifest || !Array.isArray(manifest.entries)) {
    throw new WorkflowError('manifest_schema_unsupported', 'Unsupported or malformed manifest schema.');
  }
  const byId = new Map(manifest.entries.map((entry) => [entry.id, entry]));
  const allowed = new Set(DECISION_FIELDS);
  const planned = [];

  for (const decision of decisions) {
    if (!decision || typeof decision !== 'object' || Array.isArray(decision)) {
      throw new WorkflowError('decisions_shape_invalid',
        'Each decision must be an object with an id and a decision.');
    }
    if (typeof decision.id !== 'string' || !decision.id) {
      throw new WorkflowError('decisions_shape_invalid', 'Each decision must name the entry id it applies to.');
    }
    for (const field of Object.keys(decision)) {
      if (!allowed.has(field)) {
        throw new WorkflowError('decision_field_unknown',
          `Decision for ${decision.id} sets an unknown field: ${field}`,
          {id: decision.id, field, allowed: [...DECISION_FIELDS]});
      }
    }
    const entry = byId.get(decision.id);
    if (!entry) {
      throw new WorkflowError('decision_entry_unknown',
        `No entry in this manifest has id: ${decision.id}`,
        {id: decision.id, known: [...byId.keys()]});
    }
    if (entry.status === 'skipped') {
      throw new WorkflowError('decision_entry_not_actionable',
        `Entry ${decision.id} is skipped and takes no decision.`,
        {id: decision.id, status: entry.status});
    }
    planned.push({entry, decision});
  }

  const touched = [];
  for (const {entry, decision} of planned) {
    for (const field of DECISION_FIELDS) {
      if (field === 'id' || decision[field] === undefined) {
        continue;
      }
      entry[field] = decision[field];
    }
    touched.push(entry.id);
  }
  return touched;
}

module.exports = {
  DECISION_FIELDS,
  readDecisions,
  applyDecisions
};
