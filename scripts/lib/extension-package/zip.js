'use strict';

// Dependency-free, deterministic ZIP encode/decode, kept intentionally small.
//
// Reproducibility is the entire point of this module, so every degree of freedom the ZIP
// format allows is pinned:
//   - entries are STORE-only (no compression), so the same input bytes always produce the
//     same output bytes regardless of the Node/zlib version running the packager;
//   - every entry uses a fixed DOS date/time (1980-01-01 00:00:00), so the archive never
//     encodes the machine's clock or the checkout's mtimes;
//   - every entry uses a fixed Unix external file attribute (regular file, 0644) and a fixed
//     "version made by"/"version needed" pair, so the archive never encodes the packaging
//     host's OS or permission bits;
//   - no extra fields, no archive/entry comments, no data descriptors (sizes are known
///    upfront), and paths are forward-slash, non-absolute, and traversal-free.
//
// `readZip` is deliberately strict: it is also the verifier's parser, so anything that could
// make an archive behave differently across tools (symlinks, drift from the fixed metadata
// above, bad CRC/size, duplicate/unsafe paths) is surfaced as a structured issue rather than
// silently accepted.

const {PackageError} = require('./errors');

const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;

const FIXED_DOS_TIME = 0x0000; // 00:00:00
const FIXED_DOS_DATE = 0x0021; // 1980-01-01
const VERSION_NEEDED = 20;
// Upper byte 3 = "made on Unix", so external attributes are interpreted as Unix permission
// bits by tools that honor them; lower byte 20 = ZIP spec version 2.0 (matches VERSION_NEEDED).
const VERSION_MADE_BY = (3 << 8) | 20;
const METHOD_STORE = 0;
const UNIX_REGULAR_FILE_MODE = 0o100644;
const EXTERNAL_ATTRIBUTES = (UNIX_REGULAR_FILE_MODE << 16) >>> 0;
const UNIX_SYMLINK_TYPE = 0o120000;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function assertSafeEntryPath(entryPath) {
  if (typeof entryPath !== 'string' || entryPath.length === 0) {
    throw new PackageError('unsafe_path', 'Entry path must be a non-empty string.', {path: entryPath});
  }
  if (entryPath.includes('\\')) {
    throw new PackageError('unsafe_path', `Entry path must use forward slashes: ${entryPath}`, {path: entryPath});
  }
  if (entryPath.startsWith('/') || /^[A-Za-z]:/.test(entryPath)) {
    throw new PackageError('unsafe_path', `Entry path must be relative: ${entryPath}`, {path: entryPath});
  }
  const segments = entryPath.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new PackageError('unsafe_path', `Entry path must not contain traversal segments: ${entryPath}`, {path: entryPath});
  }
}

function toDosDateTime() {
  // Every entry shares the same fixed timestamp (see module header), so this is a constant
  // rather than a function of the input, but is kept as a pair for readability at call sites.
  return {time: FIXED_DOS_TIME, date: FIXED_DOS_DATE};
}

/**
 * Encode a deterministic ZIP archive.
 * @param {Array<{path: string, data: Buffer}>} entries Unsorted is fine; entries are sorted.
 * @returns {Buffer}
 */
function writeZip(entries) {
  const sorted = [...entries].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const seen = new Set();
  for (const entry of sorted) {
    assertSafeEntryPath(entry.path);
    if (seen.has(entry.path)) {
      throw new PackageError('duplicate_path', `Duplicate entry path: ${entry.path}`, {path: entry.path});
    }
    seen.add(entry.path);
  }

  const {time, date} = toDosDateTime();
  const localChunks = [];
  const centralChunks = [];
  let offset = 0;

  for (const entry of sorted) {
    const nameBytes = Buffer.from(entry.path, 'utf8');
    const data = entry.data;
    const crc = crc32(data);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(LOCAL_FILE_HEADER_SIGNATURE, 0);
    localHeader.writeUInt16LE(VERSION_NEEDED, 4);
    localHeader.writeUInt16LE(0, 6); // general purpose flag
    localHeader.writeUInt16LE(METHOD_STORE, 8);
    localHeader.writeUInt16LE(time, 10);
    localHeader.writeUInt16LE(date, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(data.length, 18); // compressed size == uncompressed (store)
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(nameBytes.length, 26);
    localHeader.writeUInt16LE(0, 28); // extra length

    localChunks.push(localHeader, nameBytes, data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(CENTRAL_DIRECTORY_SIGNATURE, 0);
    centralHeader.writeUInt16LE(VERSION_MADE_BY, 4);
    centralHeader.writeUInt16LE(VERSION_NEEDED, 6);
    centralHeader.writeUInt16LE(0, 8); // general purpose flag
    centralHeader.writeUInt16LE(METHOD_STORE, 10);
    centralHeader.writeUInt16LE(time, 12);
    centralHeader.writeUInt16LE(date, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(nameBytes.length, 28);
    centralHeader.writeUInt16LE(0, 30); // extra length
    centralHeader.writeUInt16LE(0, 32); // comment length
    centralHeader.writeUInt16LE(0, 34); // disk number start
    centralHeader.writeUInt16LE(0, 36); // internal file attributes
    centralHeader.writeUInt32LE(EXTERNAL_ATTRIBUTES, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralChunks.push(centralHeader, nameBytes);

    offset += localHeader.length + nameBytes.length + data.length;
  }

  const centralDirectoryStart = offset;
  const centralDirectory = Buffer.concat(centralChunks);
  const centralDirectorySize = centralDirectory.length;

  const end = Buffer.alloc(22);
  end.writeUInt32LE(END_OF_CENTRAL_DIRECTORY_SIGNATURE, 0);
  end.writeUInt16LE(0, 4); // disk number
  end.writeUInt16LE(0, 6); // disk with central directory
  end.writeUInt16LE(sorted.length, 8); // entries on this disk
  end.writeUInt16LE(sorted.length, 10); // total entries
  end.writeUInt32LE(centralDirectorySize, 12);
  end.writeUInt32LE(centralDirectoryStart, 16);
  end.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...localChunks, centralDirectory, end]);
}

function findEndOfCentralDirectory(buffer) {
  // No archive comment is ever written, so the record is always the last 22 bytes; scanning
  // backward still guards against a corrupt/foreign archive that appended trailing bytes.
  const minSize = 22;
  if (buffer.length < minSize) {
    throw new PackageError('malformed_archive', 'Archive is too small to contain an end-of-central-directory record.');
  }
  const maxBack = Math.min(buffer.length - minSize, 0xffff + minSize);
  for (let back = 0; back <= maxBack; back++) {
    const pos = buffer.length - minSize - back;
    if (buffer.readUInt32LE(pos) === END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
      return pos;
    }
  }
  throw new PackageError('malformed_archive', 'End-of-central-directory record not found.');
}

/**
 * Parse a ZIP archive and validate the invariants this packager guarantees. Returns
 * `{entries, issues}` where `issues` is a list of structured problems (empty when the archive
 * is a well-formed, reproducible-metadata archive with no duplicate/unsafe/symlink paths and
 * every entry's bytes match its recorded CRC-32/size). Parsing never throws for a malformed
 * *entry*; only a structurally unreadable archive throws.
 */
function readZip(buffer) {
  const eocdPos = findEndOfCentralDirectory(buffer);
  const totalEntries = buffer.readUInt16LE(eocdPos + 10);
  const centralDirectorySize = buffer.readUInt32LE(eocdPos + 12);
  const centralDirectoryStart = buffer.readUInt32LE(eocdPos + 16);

  if (centralDirectoryStart + centralDirectorySize > eocdPos) {
    throw new PackageError('malformed_archive', 'Central directory extends past the end-of-central-directory record.');
  }

  const entries = [];
  const issues = [];
  const seenPaths = new Set();
  let cursor = centralDirectoryStart;

  for (let i = 0; i < totalEntries; i++) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== CENTRAL_DIRECTORY_SIGNATURE) {
      throw new PackageError('malformed_archive', `Central directory record ${i} is missing or corrupt.`);
    }
    const versionMadeBy = buffer.readUInt16LE(cursor + 4);
    const method = buffer.readUInt16LE(cursor + 10);
    const time = buffer.readUInt16LE(cursor + 12);
    const date = buffer.readUInt16LE(cursor + 14);
    const crc = buffer.readUInt32LE(cursor + 16);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const externalAttributes = buffer.readUInt32LE(cursor + 38);
    const localHeaderOffset = buffer.readUInt32LE(cursor + 42);
    const nameStart = cursor + 46;
    const entryPath = buffer.slice(nameStart, nameStart + nameLength).toString('utf8');
    cursor = nameStart + nameLength + extraLength + commentLength;

    const entryIssues = [];
    let safePath = true;
    try {
      assertSafeEntryPath(entryPath);
    } catch (error) {
      safePath = false;
      entryIssues.push({code: 'path_traversal', message: error.message, path: entryPath});
    }

    if (safePath) {
      if (seenPaths.has(entryPath)) {
        entryIssues.push({code: 'duplicate_path', message: `Duplicate entry path: ${entryPath}`, path: entryPath});
      }
      seenPaths.add(entryPath);
    }

    const fileTypeBits = (externalAttributes >>> 16) & 0xf000;
    if (fileTypeBits === UNIX_SYMLINK_TYPE) {
      entryIssues.push({code: 'symlink_entry', message: `Archive entry is a symlink: ${entryPath}`, path: entryPath});
    }

    if (
      method !== METHOD_STORE
      || time !== FIXED_DOS_TIME
      || date !== FIXED_DOS_DATE
      || versionMadeBy !== VERSION_MADE_BY
      || externalAttributes !== EXTERNAL_ATTRIBUTES
      || extraLength !== 0
      || commentLength !== 0
    ) {
      entryIssues.push({
        code: 'nonreproducible_metadata',
        message: `Entry does not use the packager's fixed metadata: ${entryPath}`,
        path: entryPath
      });
    }

    if (safePath && localHeaderOffset + 30 <= buffer.length
      && buffer.readUInt32LE(localHeaderOffset) === LOCAL_FILE_HEADER_SIGNATURE) {
      const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
      const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
      const dataEnd = dataStart + compressedSize;
      if (dataEnd > buffer.length) {
        throw new PackageError('malformed_archive', `Entry data for ${entryPath} extends past the end of the archive.`);
      }
      const data = buffer.slice(dataStart, dataEnd);
      const actualCrc = crc32(data);
      if (actualCrc !== crc || data.length !== uncompressedSize || compressedSize !== uncompressedSize) {
        entryIssues.push({code: 'corrupt_entry', message: `CRC-32/size mismatch for entry: ${entryPath}`, path: entryPath});
      }
      entries.push({path: entryPath, data, crc32: actualCrc, issues: entryIssues});
    } else {
      if (safePath) {
        throw new PackageError('malformed_archive', `Local file header for ${entryPath} is missing or corrupt.`);
      }
      entries.push({path: entryPath, data: null, crc32: null, issues: entryIssues});
    }

    issues.push(...entryIssues);
  }

  return {entries, issues};
}

module.exports = {
  crc32,
  writeZip,
  readZip,
  assertSafeEntryPath,
  FIXED_DOS_TIME,
  FIXED_DOS_DATE,
  VERSION_NEEDED,
  VERSION_MADE_BY,
  METHOD_STORE,
  EXTERNAL_ATTRIBUTES
};
