#!/usr/bin/env node
'use strict';

// Lints the BUILT userscripts as whole programs. The runtimes under scripts/userscript/ are
// fragments of one IIFE (shared helpers are inlined ahead of them), so ESLint cannot judge a
// fragment on its own; the assembled script is the unit where an undeclared name or a duplicate
// declaration is a real bug. Each variant is rendered in memory with a tiny stub dictionary --
// the embedded dictionaries only add a multi-megabyte string literal and no code -- so nothing
// is written and no prior build is needed. `make lint` runs it next to the source lint.

const path = require('node:path');
const {ESLint} = require('eslint');
const globals = require('globals');
const {bugRules} = require('./lib/lint-config');
const nomBuilder = require('./build-nom-userscript');
const popupBuilder = require('./build-popupdict-userscript');
const cjkBuilder = require('./build-cjk-ruby-userscript');

// The privileged names a userscript manager injects (see the @grant lines of each runtime).
const GREASEMONKEY_GLOBALS = {
  GM: 'readonly',
  GM_addStyle: 'readonly',
  GM_getValue: 'readonly',
  GM_setValue: 'readonly',
  GM_registerMenuCommand: 'readonly',
  GM_setClipboard: 'readonly',
  GM_xmlhttpRequest: 'readonly',
  unsafeWindow: 'readonly'
};

// Names that exist only in some builds or only in a worker, declared explicitly instead of turning
// no-undef off. `module` is read in the shared sources only behind a `typeof module` guard.
const SHARED_SOURCE_GLOBALS = {module: 'readonly'};
// cjk-ruby.runtime.js stringifies a function that runs in a Worker (importScripts, ToJyutping from
// the library it loads), and reads the ToJyutping library global behind a `typeof` guard.
const CJK_RUBY_GLOBALS = {importScripts: 'readonly', ToJyutping: 'readonly'};

function renderAll() {
  // A developer's private local site rules must not change what is linted.
  process.env.ZOOPDOG_LOCAL_SITE_RULES = path.join(__dirname, 'does-not-exist.json');
  const nomMap = {'xin chào': '𠸦 / 𠳒'};
  const popupDictionary = {'bạn': [[['bạn'], [['friend', '']]]]};
  const rendered = [];
  for (const variant of nomBuilder.VARIANTS) {
    rendered.push({name: variant.targetKey, text: nomBuilder.buildUserscript(nomMap, {}, variant), globals: {}});
  }
  for (const variant of popupBuilder.VARIANTS) {
    const sources = popupBuilder.readRuntimeSources(variant.localMode);
    rendered.push({
      name: variant.targetKey,
      text: popupBuilder.buildUserscript(popupDictionary, 3, sources, variant),
      globals: {}
    });
  }
  for (const variant of cjkBuilder.VARIANTS) {
    rendered.push({name: variant.targetKey, text: cjkBuilder.buildUserscript(variant), globals: CJK_RUBY_GLOBALS});
  }
  return rendered;
}

async function lintUserscripts(rendered = renderAll()) {
  const problems = [];
  for (const {name, text, globals: extraGlobals} of rendered) {
    const eslint = new ESLint({
      overrideConfigFile: true,
      overrideConfig: [{
        languageOptions: {
          sourceType: 'script',
          ecmaVersion: 2024,
          globals: {...globals.browser, ...GREASEMONKEY_GLOBALS, ...SHARED_SOURCE_GLOBALS, ...extraGlobals}
        },
        rules: bugRules
      }]
    });
    const [result] = await eslint.lintText(text, {filePath: `${name}.user.js`});
    for (const message of result.messages) {
      problems.push({name, line: message.line, column: message.column,
        severity: message.severity === 2 ? 'error' : 'warning', ruleId: message.ruleId, message: message.message});
    }
  }
  return problems;
}

module.exports = {lintUserscripts, renderAll, GREASEMONKEY_GLOBALS};

if (require.main === module) {
  lintUserscripts().then((problems) => {
    for (const p of problems) {
      console.log(`${p.name}:${p.line}:${p.column} ${p.severity} ${p.message} (${p.ruleId})`);
    }
    const errors = problems.filter((p) => p.severity === 'error').length;
    console.log(`Linted the built userscripts: ${errors} error(s), ${problems.length - errors} warning(s)`);
    process.exitCode = errors ? 1 : 0;
  }, (error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
