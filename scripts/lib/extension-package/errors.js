'use strict';

// One row per distinct failure cause, mirroring the shape of scripts/add-chu-nom/errors.js:
// the code is the stable identifier a caller matches on, `hint` is the corrective action, and
// `exit` is the stable non-zero exit code every Make target and test relies on.
const EXIT_CODES = Object.freeze({
  SUCCESS: 0,
  USAGE: 2,
  CONFIGURATION: 3,
  INTEGRITY: 4,
  IO: 5
});

const ERROR_CODES = Object.freeze({
  // CLI surface
  unexpected_argument: {exit: EXIT_CODES.USAGE, hint: 'Pass options as --flag value; positional arguments are not accepted.'},
  unknown_option: {exit: EXIT_CODES.USAGE, hint: 'Run the command with no arguments to see the accepted options.'},
  duplicate_option: {exit: EXIT_CODES.USAGE, hint: 'Supply each option at most once.'},
  missing_option_value: {exit: EXIT_CODES.USAGE, hint: 'Provide a value after the option, or drop the option.'},
  unknown_command: {exit: EXIT_CODES.USAGE, hint: 'Use one of: build, verify.'},

  // Inventory / configuration
  manifest_unreadable: {exit: EXIT_CODES.CONFIGURATION, hint: 'Ensure zd-extension/manifest.json exists and is valid JSON.'},
  manifest_version_unsupported: {exit: EXIT_CODES.CONFIGURATION, hint: 'The packager only supports manifest_version 3.'},
  html_unreadable: {exit: EXIT_CODES.CONFIGURATION, hint: 'Ensure the referenced HTML file exists and is readable.'},
  css_unreadable: {exit: EXIT_CODES.CONFIGURATION, hint: 'Ensure the referenced CSS file exists and is readable.'},
  missing_reference: {exit: EXIT_CODES.CONFIGURATION, hint: 'Create the missing file, or remove the reference from the manifest/HTML/CSS.'},
  missing_dynamic_resource: {exit: EXIT_CODES.CONFIGURATION, hint: 'Run `make rebuild-extension-vnedict-json` (or the relevant generator) before packaging.'},
  inventory_drift: {exit: EXIT_CODES.CONFIGURATION, hint: 'Update scripts/lib/extension-package/inventory.js to match the current manifest/HTML/CSS references.'},
  unsafe_path: {exit: EXIT_CODES.CONFIGURATION, hint: 'Reference a path inside zd-extension/ with no traversal segments.'},

  // Archive integrity (build or verify)
  stale_manifest: {exit: EXIT_CODES.INTEGRITY, hint: 'Run `make rebuild-extension-package` to regenerate the archive from the current manifest.'},
  duplicate_path: {exit: EXIT_CODES.INTEGRITY, hint: 'The archive contains the same entry path twice; rebuild it.'},
  path_traversal: {exit: EXIT_CODES.INTEGRITY, hint: 'The archive contains an unsafe entry path; rebuild it from trusted sources.'},
  unexpected_path: {exit: EXIT_CODES.INTEGRITY, hint: 'The archive contains an entry outside the reviewed inventory; rebuild it.'},
  symlink_entry: {exit: EXIT_CODES.INTEGRITY, hint: 'The archive contains a symlink entry, which the packager never writes; rebuild it.'},
  corrupt_entry: {exit: EXIT_CODES.INTEGRITY, hint: 'An entry’s bytes do not match its recorded CRC-32/size; rebuild the archive.'},
  nonreproducible_metadata: {exit: EXIT_CODES.INTEGRITY, hint: 'An entry does not use the packager’s fixed timestamp/permission/compression metadata; rebuild the archive.'},
  malformed_archive: {exit: EXIT_CODES.INTEGRITY, hint: 'The archive is not a well-formed ZIP produced by this packager; rebuild it.'},

  // I/O
  archive_unreadable: {exit: EXIT_CODES.IO, hint: 'Ensure the archive path exists and is readable.'},
  publish_failed: {exit: EXIT_CODES.IO, hint: 'Check filesystem permissions on the archive directory and retry.'},

  unexpected_failure: {exit: EXIT_CODES.IO, hint: 'Unhandled failure; re-run and report the message if it repeats.'}
});

const EXIT_CATEGORIES = Object.freeze({
  [EXIT_CODES.USAGE]: 'usage',
  [EXIT_CODES.CONFIGURATION]: 'configuration',
  [EXIT_CODES.INTEGRITY]: 'integrity',
  [EXIT_CODES.IO]: 'io'
});

class PackageError extends Error {
  constructor(code, message, details = {}) {
    const entry = ERROR_CODES[code];
    if (!entry) {
      throw new Error(`Unknown package error code: ${code}`);
    }
    super(message);
    this.name = 'PackageError';
    this.code = code;
    this.exitCode = entry.exit;
    this.category = EXIT_CATEGORIES[entry.exit];
    this.hint = entry.hint;
    this.details = details;
  }
}

module.exports = {
  EXIT_CODES,
  ERROR_CODES,
  EXIT_CATEGORIES,
  PackageError
};
