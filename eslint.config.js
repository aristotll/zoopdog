'use strict';

// ESLint here only catches real bugs (undeclared names, duplicate declarations, dead code,
// accidental assignments); there are no formatting or style rules. The userscript runtimes under
// scripts/userscript/ are fragments of one IIFE, so they are not linted file by file:
// scripts/lint-userscripts.js lints each built userscript as the whole program it is.
const globals = require('globals');
const {bugRules} = require('./scripts/lib/lint-config');

module.exports = [
  {
    ignores: [
      'node_modules/**', 'dist/**', 'zoopdog-*.user.js', 'js/lib/**', 'zd-extension/js/lib/**',
      'scripts/userscript/**', 'zd-extension/db_src/**', 'openspec/**'
    ]
  },
  {
    files: ['scripts/**/*.js', 'test/**/*.js', 'eslint.config.js'],
    languageOptions: {sourceType: 'commonjs', ecmaVersion: 2024, globals: globals.node},
    rules: bugRules
  },
  // browser-smoke.js passes functions to page.evaluate/waitForFunction that run in the page.
  {
    files: ['scripts/browser-smoke.js'],
    languageOptions: {globals: {...globals.node, ...globals.browser}}
  },
  // The standalone browser files are classic <script>s that share one global scope: what one
  // declares at top level another uses. Each file therefore lists the names it takes from others
  // (and from third-party libraries) below, instead of no-undef being switched off. `module` is
  // only touched behind a `typeof module` guard, for the files tests also load under Node.
  {
    files: ['js/*.js', 'zd-extension/js/*.js'],
    languageOptions: {sourceType: 'script', ecmaVersion: 2024, globals: {...globals.browser, module: 'readonly'}},
    // Top-level declarations of a classic script are its public API, so only locals are checked.
    rules: {...bugRules, 'no-unused-vars': ['warn', {vars: 'local', args: 'none', caughtErrors: 'none'}]}
  },
  ...Object.entries({
    'js/popupdict.js': [
      'Dexie', 'Pace', 'Highlighter', 'ResultFrame', 'zdBrowserRuntime', 'zdDictionaryRuntime',
      // zd-words.js
      'mouseInRects', 'generateCandidates', 'getWordAndContext'
    ],
    'js/zd-pron.js': [
      'drawTonesAndGradients', 'pronunciationGuide', 'dialects', 'getMultiWordHomophones', 'zdBrowserRuntime'
    ],
    'zd-extension/js/frame.js': ['Handlebars', 'zdPopupProtocol', 'pronunciationGuide', 'drawTonesAndGradients'],
    'zd-extension/js/highlighter.js': ['zdContainerBoundary', 'zdIsWordChar', 'zdNextTextNode'], // zd-words.js
    'zd-extension/js/showframe.js': ['chrome', 'zdPopupProtocol'],
    'zd-extension/js/zd-pron-core.js': [
      'dialects', 'vowelTable', 'toneTable', 'toneCodes', 'tones', 'rimesToIPA', 'initialsToIPA', 'numbers',
      'TENS_WORD', 'zoopdogSymbols', 'wordUnitsRegex', 'allPossibleRealWords'
    ],
    'zd-extension/js/zd-pron-drawtones.js': ['chroma'],
    'zd-extension/js/zd-pron-functions.js': ['ZDPronCore'],
    'zd-extension/js/zd-pronguide.js': ['pronunciationGuide', 'drawTonesAndGradients', 'zdBrowserRuntime']
  }).map(([file, names]) => ({
    files: [file],
    languageOptions: {globals: Object.fromEntries(names.map((name) => [name, 'readonly']))}
  }))
];
