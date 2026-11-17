'use strict';

// The bug-catching ESLint rules shared by eslint.config.js (source files) and
// scripts/lint-userscripts.js (built userscripts). Deliberately no formatting or style rules.
const bugRules = Object.freeze({
  'no-undef': 'error',
  'no-redeclare': 'error',
  'no-dupe-keys': 'error',
  'no-dupe-args': 'error',
  'no-unreachable': 'error',
  'no-cond-assign': ['error', 'except-parens'],
  'no-self-assign': 'error',
  'no-const-assign': 'error',
  'valid-typeof': 'error',
  'no-fallthrough': 'error',
  'no-unused-vars': ['error', {args: 'none', caughtErrors: 'none'}]
});

module.exports = {bugRules};
