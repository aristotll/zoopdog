'use strict';

importScripts(chrome.runtime.getURL("js/lib/dexie.min.js"));
importScripts(chrome.runtime.getURL("js/zd-dictionary-runtime.js"));

const DICTIONARY_URL = chrome.runtime.getURL('js/vnedict.json');
const METADATA_URL = chrome.runtime.getURL('js/vnedict.meta.json');

function createDb() {
  const db = new Dexie('entries');
  db.version(2).stores({entries: '++,vn,en'});
  db.version(3).stores({entries: '++,vn,en', metadata: '&key'});
  return db;
}

async function fetchChecked(url, kind) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Unable to fetch ${kind}: HTTP ${response.status}`);
  return response;
}

async function digestText(text) {
  const data = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function fetchMetadata() {
  const response = await fetchChecked(METADATA_URL, 'dictionary metadata');
  try {
    return await response.json();
  } catch (error) {
    throw new zdDictionaryRuntime.RuntimeError(
      zdDictionaryRuntime.ERRORS.METADATA_INVALID,
      'Runtime dictionary metadata is not valid JSON',
      error
    );
  }
}

const db = createDb();
const coordinator = zdDictionaryRuntime.createCoordinator({
  adapter: zdDictionaryRuntime.createDexieAdapter(db),
  fetchMetadata,
  fetchDictionaryText: async () => (await fetchChecked(DICTIONARY_URL, 'dictionary')).text(),
  digest: globalThis.crypto && globalThis.crypto.subtle ? digestText : null,
  onState: (result) => console.log('Dictionary state:', result.state)
});

function storageGet(defaults) {
  return new Promise((resolve) => chrome.storage.sync.get(defaults, resolve));
}

function storageSet(values) {
  return new Promise((resolve) => chrome.storage.sync.set(values, resolve));
}

function queryTabs(query) {
  return new Promise((resolve) => chrome.tabs.query(query, resolve));
}

function sendToTab(tabId, message) {
  try {
    chrome.tabs.sendMessage(tabId, message, () => {
      void chrome.runtime.lastError;
    });
  } catch (_error) {
    // Restricted Chrome pages and closed tabs have no content-script receiver.
  }
}

async function broadcast(message) {
  const tabs = await queryTabs({});
  tabs.forEach((tab) => sendToTab(tab.id, message));
}

function errorResponse(message, error) {
  return {
    type: 'error',
    requestType: message && message.type,
    error: {
      code: error && error.code ? error.code : 'runtime-failure',
      message: error && error.message ? error.message : String(error),
      remedy: error && error.remedy ? error.remedy : 'Retry the operation.'
    }
  };
}

async function ensureSearchReady() {
  const readiness = await coordinator.ensureReady();
  if (readiness.state === zdDictionaryRuntime.STATES.UNAVAILABLE) {
    const error = new Error(readiness.error.message);
    Object.assign(error, readiness.error);
    throw error;
  }
  return readiness;
}

async function handleMessage(message) {
  if (!message || typeof message.type !== 'string') {
    throw new Error('Message type is required');
  }

  if (message.type === 'initial-search') {
    await ensureSearchReady();
    const keys = await db.entries.where('vn').startsWithIgnoreCase(`${message.term} `).uniqueKeys();
    keys.sort((a, b) => b.length - a.length);
    return {type: 'range', range: keys.length ? keys[0].split(' ').length : 1};
  }
  if (message.type === 'second-search') {
    await ensureSearchReady();
    const results = await db.entries.where('vn').anyOfIgnoreCase(message.candidates || []).toArray();
    results.sort((a, b) => b.vn.split(' ').length - a.vn.split(' ').length);
    return {type: 'results', results};
  }
  if (message.type === 'reload-db') {
    return {type: 'dictionary-state', readiness: await coordinator.ensureReady({force: true})};
  }
  if (message.type === 'dictionary-status') {
    return {type: 'dictionary-state', readiness: await coordinator.ensureReady()};
  }
  if (message.type === 'check-globally-on') {
    const items = await storageGet({zoopdogIsGloballyOn: true});
    return {type: 'globally-on', status: items.zoopdogIsGloballyOn};
  }
  if (message.type === 'toggle-zoopdog') {
    const items = await storageGet({zoopdogIsGloballyOn: true});
    const status = !items.zoopdogIsGloballyOn;
    await storageSet({zoopdogIsGloballyOn: status});
    await broadcast({type: 'toggle-zoopdog', status});
    return {type: 'globally-on', status};
  }
  if (message.type === 'toggle-lock') {
    const tabs = await queryTabs({active: true, currentWindow: true});
    if (tabs[0]) sendToTab(tabs[0].id, {type: 'toggle-lock'});
    return {type: 'lock-toggled'};
  }
  if (message.type === 'get-dialect') {
    const items = await storageGet({myDialect: 'hanoi'});
    return {type: 'dialect', dialect: items.myDialect};
  }
  if (message.type === 'set-dialect') {
    const dialect = ['hanoi', 'quangnam', 'saigon'].includes(message.dialect)
      ? message.dialect
      : 'hanoi';
    await storageSet({myDialect: dialect});
    const tabs = await queryTabs({active: true, currentWindow: true});
    if (tabs[0]) sendToTab(tabs[0].id, {type: 'set-dialect', dialect});
    return {type: 'dialect-set', dialect};
  }
  throw new Error(`Unknown message type: ${message.type}`);
}

chrome.runtime.onInstalled.addListener(() => {
  coordinator.ensureReady().then(
    (result) => console.log(`Dictionary initialization: ${result.state}`),
    (error) => console.error('Dictionary initialization failed:', error)
  );
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message).then(sendResponse, (error) => sendResponse(errorResponse(message, error)));
  return true;
});
