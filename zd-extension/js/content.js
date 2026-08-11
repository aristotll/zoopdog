'use strict';

// getWordAndContext, generateCandidates and mouseInRects come from js/zd-words.js, which the
// manifest loads before this file.

function sendRuntimeMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        resolve({type: 'error', error: {message: runtimeError.message}});
      } else {
        resolve(response || {type: 'error', error: {message: 'No runtime response'}});
      }
    });
  });
}

function initializeContent() {
  const lookupTasks = zdBrowserRuntime.createLatestTask();
  let oldWord = null;
  window.highlighter = new Highlighter();
  window.popup = new ResultFrame();
  window.zoopdogIsOn = true;

  function toggleLock() {
    window.highlighter.toggleLock();
    window.popup.toggleLock();
  }
  window.popup.onToggleLock = toggleLock;

  sendRuntimeMessage({type: 'get-dialect'}).then((response) => {
    if (response.type === 'dialect') window.popup.dialect = response.dialect;
  });
  sendRuntimeMessage({type: 'check-globally-on'}).then((response) => {
    if (response.type === 'globally-on') window.zoopdogIsOn = response.status;
  });

  function invalidateLookup() {
    lookupTasks.invalidate();
    oldWord = null;
  }

  window.addEventListener('resize', () => {
    invalidateLookup();
    window.highlighter.off();
    window.popup.hide();
    window.highlighter = new Highlighter();
  });
  window.addEventListener('scroll', () => {
    invalidateLookup();
    window.highlighter.off();
    window.popup.hide();
  });
  window.addEventListener('mouseout', () => {
    invalidateLookup();
    window.highlighter.off();
    window.popup.hide();
  });
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Shift' || event.which === 16) toggleLock();
  });

  async function mainListener(event) {
    if (window.popup.locked || !window.zoopdogIsOn) return true;

    const mouse = {x: event.clientX, y: event.clientY};
    if (window.highlighter.highlights.length
        && mouseInRects(mouse, window.highlighter.highlights)) return true;

    const origin = getWordAndContext(mouse);
    const element = document.elementFromPoint(mouse.x, mouse.y);
    if (!origin || !origin.word || !element) {
      invalidateLookup();
      window.highlighter.off();
      window.popup.hide();
      return true;
    }

    window.highlighter.off();
    window.popup.hide();
    if (Array.from(element.childNodes).indexOf(origin.node) === -1) {
      invalidateLookup();
      return true;
    }
    if (origin.word === oldWord) return true;

    oldWord = origin.word;
    const task = lookupTasks.begin();
    const searchTerm = origin.word.replace(/[Đ\u00D0]/ug, 'đ');
    try {
      const initial = await sendRuntimeMessage({type: 'initial-search', term: searchTerm});
      if (!lookupTasks.isCurrent(task)) return false;
      if (initial.type !== 'range') {
        oldWord = null;
        return false;
      }
      const candidates = generateCandidates(origin.context, initial.range);
      const second = await sendRuntimeMessage({type: 'second-search', candidates});
      if (!lookupTasks.isCurrent(task)) return false;
      if (second.type !== 'results' || !second.results.length) {
        oldWord = null;
        return false;
      }

      const wordCount = second.results[0].vn.split(' ').length;
      await window.popup.inject();
      if (!lookupTasks.isCurrent(task)) return false;
      window.highlighter.on(origin.node, origin.begin, wordCount);
      await window.popup.populate(second.results);
      if (!lookupTasks.isCurrent(task)) return false;
      if (window.highlighter.highlights.length) {
        await window.popup.show(window.highlighter.highlights[0]);
      }
      window.setTimeout(() => {
        if (lookupTasks.isCurrent(task)) oldWord = null;
      }, 500);
    } catch (error) {
      if (lookupTasks.isCurrent(task)) oldWord = null;
      console.error('Zoopdog lookup failed:', error);
    }
    return false;
  }

  window.addEventListener('mousemove', mainListener);
  window.addEventListener('click', mainListener);

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'toggle-zoopdog') {
      window.zoopdogIsOn = Boolean(message.status);
      invalidateLookup();
      if (!window.zoopdogIsOn) {
        window.highlighter.off();
        window.popup.hide();
      }
    } else if (message.type === 'toggle-lock') {
      toggleLock();
    } else if (message.type === 'set-dialect') {
      window.popup.dialect = message.dialect;
    }
  });
}

zdBrowserRuntime.runWhenReady(document, initializeContent);
