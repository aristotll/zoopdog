'use strict';

// Bumped from 1 -> 2 when the runtime dictionary moved from one row per source headword
// ({vn, en}) to one grouped row per normalized lookup key ({key, headwords, en}); see
// openspec/changes/normalize-dictionary-entry-identity. A schema-version mismatch makes
// `installedStateIsUsable` treat the installed rows as unusable, so the coordinator always
// performs a full `adapter.replace()` rather than mixing old and new row shapes.
const ZD_DICTIONARY_METADATA_SCHEMA_VERSION = 2;

const STATES = Object.freeze({
  READY_CURRENT: 'ready-current',
  READY_REFRESHED: 'ready-refreshed',
  READY_STALE: 'ready-stale',
  UNAVAILABLE: 'unavailable'
});

const ERRORS = Object.freeze({
  METADATA_FETCH: Object.freeze({
    code: 'metadata-fetch',
    remedy: 'Retry loading the dictionary metadata.'
  }),
  METADATA_INVALID: Object.freeze({
    code: 'metadata-invalid',
    remedy: 'Rebuild the runtime dictionary metadata and retry.'
  }),
  PAYLOAD_FETCH: Object.freeze({
    code: 'payload-fetch',
    remedy: 'Retry loading the dictionary data.'
  }),
  PAYLOAD_INVALID: Object.freeze({
    code: 'payload-invalid',
    remedy: 'Rebuild the runtime dictionary and retry.'
  }),
  DIGEST_MISMATCH: Object.freeze({
    code: 'digest-mismatch',
    remedy: 'Rebuild the dictionary and metadata together, then retry.'
  }),
  TRANSACTION_FAILED: Object.freeze({
    code: 'transaction-failed',
    remedy: 'Retry the dictionary update; the previous dictionary was preserved.'
  })
});

class RuntimeError extends Error {
  constructor(definition, message, cause) {
    super(message || definition.code, cause ? {cause} : undefined);
    this.name = 'RuntimeError';
    this.code = definition.code;
    this.remedy = definition.remedy;
  }
}

function runtimeError(definition, message, cause) {
  return new RuntimeError(definition, message, cause);
}

function validateMetadata(metadata) {
  const valid = metadata
    && typeof metadata === 'object'
    && !Array.isArray(metadata)
    && metadata.schemaVersion === ZD_DICTIONARY_METADATA_SCHEMA_VERSION
    && typeof metadata.revision === 'string'
    && /^[a-f0-9]{64}$/u.test(metadata.revision)
    && Number.isSafeInteger(metadata.entryCount)
    && metadata.entryCount >= 0;
  if (!valid) {
    throw runtimeError(ERRORS.METADATA_INVALID, 'Invalid runtime dictionary metadata');
  }
  return metadata;
}

// Grouped-row shape ({key, headwords, en}) -- see scripts/lib/dictionary-identity.js, the
// single definition of this schema shared between the Node build tooling and this browser
// runtime. A row still carrying the old per-headword `{vn, en}` shape (no `key`/`headwords`)
// is rejected here rather than silently accepted, so old and new schemas can never mix.
function validateDictionaryEntry(entry, index) {
  const valid = entry
    && typeof entry === 'object'
    && !Array.isArray(entry)
    && typeof entry.key === 'string'
    && entry.key.length > 0
    && Array.isArray(entry.headwords)
    && entry.headwords.length > 0
    && entry.headwords.every((headword) => typeof headword === 'string' && headword.length > 0)
    && Array.isArray(entry.en)
    && entry.en.every((sense) => sense
      && typeof sense === 'object'
      && typeof sense.def === 'string'
      && typeof sense.pos === 'string'
      && (sense.headword === undefined || typeof sense.headword === 'string')
      && Object.keys(sense).every((prop) => prop === 'def' || prop === 'pos' || prop === 'headword'));
  if (!valid) {
    throw runtimeError(
      ERRORS.PAYLOAD_INVALID,
      `Invalid runtime dictionary entry at index ${index}`
    );
  }
}

function parseDictionary(dictionaryText, metadata) {
  validateMetadata(metadata);
  let entries;
  try {
    entries = JSON.parse(dictionaryText);
  } catch (cause) {
    throw runtimeError(ERRORS.PAYLOAD_INVALID, 'Runtime dictionary is not valid JSON', cause);
  }
  if (!Array.isArray(entries) || entries.length !== metadata.entryCount) {
    throw runtimeError(ERRORS.PAYLOAD_INVALID, 'Runtime dictionary entry count does not match metadata');
  }
  entries.forEach(validateDictionaryEntry);
  return entries;
}

function installedStateIsUsable(installed) {
  if (!installed || installed.entryCount < 0) return false;
  try {
    const metadata = validateMetadata(installed.metadata);
    return metadata.entryCount === installed.entryCount;
  } catch (_error) {
    return false;
  }
}

function resultFor(state, metadata, verification, error) {
  const result = {state};
  if (metadata) {
    result.revision = metadata.revision;
    result.entryCount = metadata.entryCount;
  }
  if (verification) result.verification = verification;
  if (error) {
    result.error = {code: error.code, message: error.message, remedy: error.remedy};
  }
  return result;
}

function classifyFailure(error, definition) {
  if (error instanceof RuntimeError) return error;
  return runtimeError(definition, error && error.message ? error.message : definition.code, error);
}

function createCoordinator({adapter, fetchMetadata, fetchDictionaryText, digest, onState = () => {}}) {
  if (!adapter || typeof adapter.readState !== 'function' || typeof adapter.replace !== 'function') {
    throw new TypeError('Dictionary coordinator requires a database adapter');
  }
  let current = null;
  let queuedForce = null;

  async function run(force) {
    let installed = null;
    try {
      installed = await adapter.readState();
    } catch (_error) {
      installed = null;
    }

    let metadata;
    try {
      metadata = validateMetadata(await fetchMetadata());
    } catch (error) {
      const failure = error instanceof RuntimeError
        ? error
        : classifyFailure(error, ERRORS.METADATA_FETCH);
      const state = installedStateIsUsable(installed) ? STATES.READY_STALE : STATES.UNAVAILABLE;
      const result = resultFor(state, installed && installed.metadata, null, failure);
      onState(result);
      return result;
    }

    if (!force && installedStateIsUsable(installed)
        && installed.metadata.revision === metadata.revision
        && installed.metadata.schemaVersion === metadata.schemaVersion) {
      const result = resultFor(STATES.READY_CURRENT, metadata, 'revision');
      onState(result);
      return result;
    }

    let dictionaryText;
    try {
      dictionaryText = await fetchDictionaryText();
    } catch (error) {
      const failure = classifyFailure(error, ERRORS.PAYLOAD_FETCH);
      const state = installedStateIsUsable(installed) ? STATES.READY_STALE : STATES.UNAVAILABLE;
      const result = resultFor(state, installed && installed.metadata, null, failure);
      onState(result);
      return result;
    }

    let entries;
    let verification = 'shape-and-count';
    try {
      entries = parseDictionary(dictionaryText, metadata);
      if (typeof digest === 'function') {
        const actualRevision = await digest(dictionaryText);
        if (actualRevision !== metadata.revision) {
          throw runtimeError(ERRORS.DIGEST_MISMATCH, 'Runtime dictionary digest does not match metadata');
        }
        verification = 'sha256';
      }
    } catch (error) {
      const failure = error instanceof RuntimeError
        ? error
        : classifyFailure(error, ERRORS.PAYLOAD_INVALID);
      const state = installedStateIsUsable(installed) ? STATES.READY_STALE : STATES.UNAVAILABLE;
      const result = resultFor(state, installed && installed.metadata, null, failure);
      onState(result);
      return result;
    }

    try {
      await adapter.replace(entries, metadata);
    } catch (error) {
      const failure = classifyFailure(error, ERRORS.TRANSACTION_FAILED);
      const state = installedStateIsUsable(installed) ? STATES.READY_STALE : STATES.UNAVAILABLE;
      const result = resultFor(state, installed && installed.metadata, null, failure);
      onState(result);
      return result;
    }

    const result = resultFor(STATES.READY_REFRESHED, metadata, verification);
    onState(result);
    return result;
  }

  function startRun(force) {
    const promise = run(force);
    current = {promise, forced: force};
    promise.finally(() => {
      if (current && current.promise === promise) current = null;
    });
    return promise;
  }

  // A force request that arrives while an ordinary (non-forced) run is already in flight
  // cannot join it -- that run may resolve to `ready-current` and skip the replacement the
  // caller asked for. Queue exactly one forced follow-up run instead of starting a second one
  // in parallel, and coalesce any further force requests into that same queued follow-up.
  function ensureReady({force = false} = {}) {
    if (!current) return startRun(force);
    if (!force || current.forced) return current.promise;
    if (queuedForce) return queuedForce;
    queuedForce = current.promise.catch(() => {}).then(() => startRun(true));
    queuedForce.finally(() => {
      queuedForce = null;
    });
    return queuedForce;
  }

  return {ensureReady};
}

function createDexieAdapter(db) {
  return {
    async readState() {
      const [metadata, entryCount] = await Promise.all([
        db.metadata.get('dictionary'),
        db.entries.count()
      ]);
      return {metadata, entryCount};
    },
    replace(entries, metadata) {
      return db.transaction('rw', db.entries, db.metadata, async () => {
        await db.entries.clear();
        await db.entries.bulkAdd(entries);
        await db.metadata.put({...metadata, key: 'dictionary'});
        const actualCount = await db.entries.count();
        if (actualCount !== metadata.entryCount) {
          throw runtimeError(ERRORS.TRANSACTION_FAILED, 'IndexedDB row count does not match metadata');
        }
      });
    }
  };
}

const zdDictionaryRuntime = {
  ERRORS,
  STATES,
  RuntimeError,
  createCoordinator,
  createDexieAdapter,
  installedStateIsUsable,
  parseDictionary,
  validateDictionaryEntry,
  validateMetadata
};

if (typeof globalThis !== 'undefined') {
  globalThis.zdDictionaryRuntime = zdDictionaryRuntime;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = zdDictionaryRuntime;
}
