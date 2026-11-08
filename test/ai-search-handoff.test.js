'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync('scripts/userscript/local-ai-search.js', 'utf8');

function harness(host, hash, existing = '') {
  const editor = {value: existing, innerText: existing, focus() {}};
  let sent = 0, inserted = '', clean = '';
  const button = {getAttribute() { return null; }, click() { sent++; }};
  const document = {
    querySelector(selector) {
      if (selector.includes('message-input-textarea') || selector.includes('.ql-editor')) return editor;
      if (selector.includes('send-button') || selector.includes('data-new-input-control')) return button;
      return null;
    },
    execCommand(command, ui, value) { inserted = value; editor.value = value; editor.innerText = value; return true; }
  };
  const context = {URLSearchParams, document, window: {location: {hostname: host, hash, pathname: '/chat', search: ''},
    history: {replaceState(state, title, url) { clean = url; }}}, setTimeout(fn) { fn(); }};
  vm.runInNewContext(source, context);
  return {run: () => context.zooStartAiSearchHandoff(), get sent() { return sent; }, get inserted() { return inserted; }, get clean() { return clean; }};
}

test('Qwen and Yuanbao accept a marked query, insert it once and send', () => {
  for (const host of ['chat.qwen.ai', 'yuanbao.tencent.com']) {
    const h = harness(host, '#zoopdog_search=hello%20world');
    h.run();
    assert.equal(h.inserted, 'hello world');
    assert.equal(h.sent, 1);
    assert.equal(h.clean, '/chat');
  }
});

test('ignores unrelated sites, ordinary tabs and nonempty user drafts', () => {
  for (const [host, hash, draft] of [['evil.test', '#zoopdog_search=x', ''], ['chat.qwen.ai', '#other=x', ''], ['chat.qwen.ai', '#zoopdog_search=x', 'draft']]) {
    const h = harness(host, hash, draft); h.run();
    assert.equal(h.sent, 0); assert.equal(h.inserted, '');
  }
});

test('the local userscript builder includes the handoff, but the public build does not', () => {
  const {readRuntimeSources} = require('../scripts/build-popupdict-userscript.js');
  assert.match(readRuntimeSources(true), /function zooStartAiSearchHandoff/);
  assert.doesNotMatch(readRuntimeSources(false), /function zooStartAiSearchHandoff/);
});
