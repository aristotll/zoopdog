'use strict';

function runWhenReady(documentTarget, initialize) {
  let started = false;
  function start() {
    if (started) return false;
    started = true;
    initialize();
    return true;
  }
  if (documentTarget.readyState === 'loading') {
    documentTarget.addEventListener('DOMContentLoaded', start, {once: true});
  } else {
    start();
  }
  return start;
}

function createLatestTask() {
  let epoch = 0;
  return {
    begin() { epoch += 1; return epoch; },
    invalidate() { epoch += 1; return epoch; },
    isCurrent(candidate) { return candidate === epoch; }
  };
}

const zdBrowserRuntime = {createLatestTask, runWhenReady};

if (typeof globalThis !== 'undefined') {
  globalThis.zdBrowserRuntime = zdBrowserRuntime;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = zdBrowserRuntime;
}
