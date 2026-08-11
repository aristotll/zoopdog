'use strict';

const EXIT_CODES = Object.freeze({
  SUCCESS: 0,
  VALIDATION: 2,
  STALE: 3,
  APPLY_FAILED: 4
});

// One row per distinct failure cause. The code is the stable identifier a caller matches on,
// `hint` is the corrective action to take, and `exit` keeps the shell contract every existing
// Make target and test already relies on. Deriving all three from the code is what stops a
// raise site from inventing a category or omitting a remedy.
const ERROR_CODES = Object.freeze({
  // CLI surface
  unexpected_argument: {exit: EXIT_CODES.VALIDATION, hint: 'Pass options as --flag value; positional arguments are not accepted.'},
  unknown_option: {exit: EXIT_CODES.VALIDATION, hint: 'Run the command with no arguments to see the accepted options.'},
  duplicate_option: {exit: EXIT_CODES.VALIDATION, hint: 'Supply each option at most once.'},
  missing_option_value: {exit: EXIT_CODES.VALIDATION, hint: 'Provide a value after the option, or drop the option.'},
  approve_requires_apply: {exit: EXIT_CODES.VALIDATION, hint: '--approve belongs to apply; plan and review never write dictionary data.'},
  manifest_option_required: {exit: EXIT_CODES.VALIDATION, hint: 'Pass --manifest with a path outside the repository, for example "$(mktemp -t zoopdog-chu-nom)".'},
  input_option_requires_plan: {exit: EXIT_CODES.VALIDATION, hint: '--words and --file select what to plan; apply and review read the manifest instead.'},
  manifest_unreadable: {exit: EXIT_CODES.VALIDATION, hint: 'Re-run plan to regenerate the manifest; do not hand-write it.'},
  unknown_command: {exit: EXIT_CODES.VALIDATION, hint: 'Use one of: plan, review, apply.'},
  unexpected_failure: {exit: EXIT_CODES.APPLY_FAILED, hint: 'Unhandled failure; re-run plan and report the message if it repeats.'},

  // Planning input
  conflicting_input_options: {exit: EXIT_CODES.VALIDATION, hint: 'Pass --words or --file, not both; omit both to use the default input queue.'},
  input_file_missing: {exit: EXIT_CODES.VALIDATION, hint: 'Create the input file, or pass --words with the terms inline.'},
  file_mention_invalid: {exit: EXIT_CODES.VALIDATION, hint: 'Use a path, optionally with a #L<start>-L<end> range.'},
  file_range_invalid: {exit: EXIT_CODES.VALIDATION, hint: 'Use #L<start>-L<end> with start no greater than end.'},

  // Manifest integrity
  approval_required: {exit: EXIT_CODES.VALIDATION, hint: 'Present the review and get explicit user approval, then re-run apply with --approve.'},
  manifest_schema_unsupported: {exit: EXIT_CODES.VALIDATION, hint: 'Re-run plan to produce a manifest at the supported schema version.'},
  source_hashes_missing: {exit: EXIT_CODES.VALIDATION, hint: 'Re-run plan; source hashes are written by planning and must not be removed.'},
  source_invalid: {exit: EXIT_CODES.VALIDATION, hint: 'Re-run plan; the manifest input source must not be edited by hand.'},
  source_hash_path_invalid: {exit: EXIT_CODES.VALIDATION, hint: 'Re-run plan; source hash paths are generated and must stay unique.'},
  source_hash_invalid: {exit: EXIT_CODES.VALIDATION, hint: 'Re-run plan; do not edit source hash values.'},
  source_path_missing: {exit: EXIT_CODES.VALIDATION, hint: 'Re-run plan against the input file so its path is recorded.'},
  source_hash_required_missing: {exit: EXIT_CODES.VALIDATION, hint: 'Re-run plan; every dictionary source must be hashed at planning time.'},
  stale_source: {exit: EXIT_CODES.STALE, hint: 'A source file changed after planning. Re-run plan and review again; do not edit the recorded hash.'},
  text_array_invalid: {exit: EXIT_CODES.VALIDATION, hint: 'Supply the value as an array of strings.'},
  source_item_invalid: {exit: EXIT_CODES.VALIDATION, hint: 'Re-run plan; source item metadata is generated and must not be edited.'},
  source_item_filter_invalid: {exit: EXIT_CODES.VALIDATION, hint: 'Re-run plan; filtered-input metadata is derived from the raw input.'},
  inline_source_mismatch: {exit: EXIT_CODES.VALIDATION, hint: 'Re-run plan; the recorded items must match the planned inline input.'},
  source_range_invalid: {exit: EXIT_CODES.VALIDATION, hint: 'Re-run plan with a valid #L<start>-L<end> range.'},
  source_bytes_mismatch: {exit: EXIT_CODES.VALIDATION, hint: 'The input file changed after planning. Re-run plan and review again.'},

  // Entry validation
  entry_status_invalid: {exit: EXIT_CODES.VALIDATION, hint: 'Status is set by planning; use review to record decisions instead of editing status.'},
  entry_shape_invalid: {exit: EXIT_CODES.VALIDATION, hint: 'Re-run plan; entry identity fields are generated and must not be edited.'},
  entry_source_mismatch: {exit: EXIT_CODES.VALIDATION, hint: 'Re-run plan; an entry may not be detached from the input it came from.'},
  entry_filter_invalid: {exit: EXIT_CODES.VALIDATION, hint: 'Re-run plan; filtered input must stay flagged for review.'},
  entry_primary_invalid: {exit: EXIT_CODES.VALIDATION, hint: 'Re-run plan; each input item has exactly one primary entry.'},
  entry_skip_invalid: {exit: EXIT_CODES.VALIDATION, hint: 'Only a term already present in user entries or earlier in the batch may be skipped.'},
  skipped_entry_applied: {exit: EXIT_CODES.VALIDATION, hint: 'A skipped entry cannot be applied; remove its decision.'},
  decision_missing: {exit: EXIT_CODES.VALIDATION, hint: 'Record apply or reject for this entry with the review command.'},
  entry_vi_missing: {exit: EXIT_CODES.VALIDATION, hint: 'Supply a non-empty Vietnamese term for this entry.'},
  entry_nom_invalid: {exit: EXIT_CODES.VALIDATION, hint: 'Supply at least one Nom/CJK value containing only CJK code points.'},
  entry_explain_invalid: {exit: EXIT_CODES.VALIDATION, hint: 'Supply explain as an array of strings.'},
  entry_replace_invalid: {exit: EXIT_CODES.VALIDATION, hint: 'The replace flag must be true or false.'},
  entry_replace_unreviewed: {exit: EXIT_CODES.VALIDATION, hint: 'Only an entry marked needs-review may replace stored values.'},
  duplicate_approved_key: {exit: EXIT_CODES.VALIDATION, hint: 'Two applied entries resolve to the same key; reject one of them.'},

  // Review decisions
  decisions_option_required: {exit: EXIT_CODES.VALIDATION, hint: 'Pass --decisions with a file path, or - to read the array from stdin.'},
  decisions_unreadable: {exit: EXIT_CODES.VALIDATION, hint: 'Supply decisions as a JSON array; a file path avoids shell quoting issues with Vietnamese and CJK text.'},
  decisions_shape_invalid: {exit: EXIT_CODES.VALIDATION, hint: 'Supply an array of {id, decision, nom?, explain?, vi?, replace?} objects.'},
  decision_field_unknown: {exit: EXIT_CODES.VALIDATION, hint: 'Only id, decision, nom, explain, vi and replace may be set; every other field is generated.'},
  decision_entry_unknown: {exit: EXIT_CODES.VALIDATION, hint: 'Use an id from the review projection that plan or review emitted.'},
  decision_entry_not_actionable: {exit: EXIT_CODES.VALIDATION, hint: 'This entry is skipped and takes no decision; leave it out.'},

  // JSONC editing
  jsonc_unterminated_comment: {exit: EXIT_CODES.VALIDATION, hint: 'Close the block comment in the user entries file.'},
  jsonc_unterminated_string: {exit: EXIT_CODES.VALIDATION, hint: 'Close the string literal in the user entries file.'},
  jsonc_property_expected: {exit: EXIT_CODES.VALIDATION, hint: 'Repair the malformed object in the user entries file.'},
  jsonc_colon_expected: {exit: EXIT_CODES.VALIDATION, hint: 'Add the missing colon after the property name.'},
  jsonc_empty_object: {exit: EXIT_CODES.VALIDATION, hint: 'The entry object has no properties to merge into; repair it by hand.'},
  jsonc_duplicate_key: {exit: EXIT_CODES.VALIDATION, hint: 'Remove the duplicate key from the user entries file.'},
  jsonc_array_missing: {exit: EXIT_CODES.VALIDATION, hint: 'The user entries file must contain a top-level array.'},

  // Apply transaction
  build_step_failed: {exit: EXIT_CODES.APPLY_FAILED, hint: 'Every file was restored. Fix the reported build failure, then re-run apply.'},
  generated_variable_missing: {exit: EXIT_CODES.APPLY_FAILED, hint: 'Every file was restored. Rebuild the userscripts and check the builder placeholders.'},
  generated_key_missing: {exit: EXIT_CODES.APPLY_FAILED, hint: 'Every file was restored. The key did not reach the generated dictionaries; check the builders.'},
  apply_rolled_back: {exit: EXIT_CODES.APPLY_FAILED, hint: 'Every file was restored. Address the reported cause, then re-run apply.'},

  // Repository paths and sources
  dictionary_source_missing: {exit: EXIT_CODES.VALIDATION, hint: 'Generate the dictionary source before planning.'},
  path_escapes_root: {exit: EXIT_CODES.VALIDATION, hint: 'Use a path inside the repository.'},
  path_unresolvable: {exit: EXIT_CODES.VALIDATION, hint: 'Check that the path exists and is readable.'},
  path_outside_root: {exit: EXIT_CODES.VALIDATION, hint: 'Use a path inside the repository; symlinks may not point outside it.'}
});

const EXIT_CATEGORIES = Object.freeze({
  [EXIT_CODES.VALIDATION]: 'validation',
  [EXIT_CODES.STALE]: 'stale',
  [EXIT_CODES.APPLY_FAILED]: 'apply_failed'
});

class WorkflowError extends Error {
  constructor(code, message, details = {}) {
    const entry = ERROR_CODES[code];
    if (!entry) {
      throw new Error(`Unknown workflow error code: ${code}`);
    }
    super(message);
    this.name = 'WorkflowError';
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
  WorkflowError
};
