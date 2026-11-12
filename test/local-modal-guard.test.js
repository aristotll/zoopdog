'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

test('modal guard releases only buttons it disabled after failure and blocks concurrent submits', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../scripts/userscript/local-modal-guard.js'), 'utf8');
  const context = vm.createContext({Promise});
  vm.runInContext(source, context);
  const active = {disabled: false, hasAttribute: () => false};
  const disabled = {disabled: true, hasAttribute: () => false};
  const cancel = {disabled: false, hasAttribute: name => name === 'data-zd-modal-cancel'};
  const attrs = {};
  const scope = {querySelectorAll: () => [active, disabled, cancel],
    getAttribute: name => attrs[name], setAttribute: (name, value) => { attrs[name] = value; },
    removeAttribute: name => { delete attrs[name]; }};
  const event = {currentTarget: {closest: () => scope}, preventDefault() { this.prevented = true; }};
  let reject, calls = 0;
  const guarded = context.zooGuard(() => { calls++; return new Promise((resolve, fail) => { reject = fail; }); });
  const first = guarded(event);
  guarded(event);
  assert.equal(calls, 1);
  assert.equal(event.prevented, true);
  assert.equal(active.disabled, true);
  assert.equal(cancel.disabled, false);
  reject(new Error('request failed'));
  await assert.rejects(first, /request failed/);
  await Promise.resolve();
  assert.equal(active.disabled, false);
  assert.equal(disabled.disabled, true);
  assert.equal(attrs['data-zd-busy'], undefined);
});

test('builder includes the guard before its callers only in the local variant', () => {
  const {readRuntimeSources} = require('../scripts/build-popupdict-userscript');
  const local = readRuntimeSources(true), publicSource = readRuntimeSources(false);
  assert.ok(local.indexOf('function zooGuard(') >= 0);
  assert.ok(local.indexOf('function zooGuard(') < local.indexOf('function zooWireNomForm('));
  assert.equal(publicSource.includes('function zooGuard('), false);
});
