'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('scripts/userscript/local-metaso-sources.js', 'utf8');

test('MetaSo source bridge exposes only valid http source URLs from each card', () => {
  function card(url) {
    const attrs = {};
    const node = {__reactFiber$sample: {memoizedProps: {}, return: {memoizedProps: {item: {titleLinkUrl: url}}, return: null}},
      getAttribute(name) { return attrs[name] || null; }, setAttribute(name, value) { attrs[name] = value; }};
    return {node, attrs};
  }
  const valid = card('https://www.youdao.com/'), invalid = card('javascript:alert(1)');
  const ctx = {URL, document: {querySelectorAll: () => [valid.node, invalid.node]}, MutationObserver: function() {this.observe = () => {};}, setInterval() {}};
  vm.runInNewContext(source, ctx);
  ctx.zooMetaSoPageBridge();
  assert.equal(valid.attrs['data-zoo-result-url'], 'https://www.youdao.com/');
  assert.equal(invalid.attrs['data-zoo-result-url'], undefined);
});
