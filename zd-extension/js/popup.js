'use strict';

function renderDictionaryState(readiness) {
  const status = document.getElementById('dictionary-status');
  if (!readiness) {
    status.textContent = 'Dictionary status unavailable. Retry.';
    return;
  }
  const labels = {
    'ready-current': `Dictionary ready (${readiness.entryCount} entries).`,
    'ready-refreshed': `Dictionary refreshed (${readiness.entryCount} entries).`,
    'ready-stale': `Using the previous dictionary. ${readiness.error.remedy}`,
    unavailable: `Dictionary unavailable. ${readiness.error.remedy}`
  };
  status.textContent = labels[readiness.state] || `Dictionary state: ${readiness.state}`;
}

function sendRuntimeMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      const error = chrome.runtime.lastError;
      resolve(error ? {type: 'error', error: {message: error.message}} : response);
    });
  });
}

function initializePopup() {
  const reload = document.getElementById('zoopdog-reload');

  sendRuntimeMessage({type: 'check-globally-on'}).then((response) => {
    if (response && response.type !== 'error') {
      document.getElementById('zoopdog-switch').checked = response.status;
    }
  });
  sendRuntimeMessage({type: 'get-dialect'}).then((response) => {
    if (response && response.type !== 'error') {
      const option = document.querySelector(`#dialect-menu option[value=${response.dialect}]`);
      if (option) option.selected = true;
    }
  });
  sendRuntimeMessage({type: 'dictionary-status'}).then((response) => {
    renderDictionaryState(response && response.readiness);
  });

  document.getElementById('zoopdog-switch').addEventListener('click', () => {
    sendRuntimeMessage({type: 'toggle-zoopdog'});
  });
  reload.addEventListener('click', () => {
    reload.disabled = true;
    document.getElementById('dictionary-status').textContent = 'Refreshing dictionary…';
    sendRuntimeMessage({type: 'reload-db'}).then((response) => {
      reload.disabled = false;
      renderDictionaryState(response && response.readiness);
    });
  });
  document.getElementById('dialect-menu').addEventListener('change', () => {
    sendRuntimeMessage({
      type: 'set-dialect',
      dialect: document.getElementById('dialect-menu').value
    });
  });
  document.getElementById('open-pron-guide').addEventListener('click', (event) => {
    event.preventDefault();
    chrome.tabs.create({url: 'https://tabidots.github.io/zoopdog/pronguide.html'}, () => {
      void chrome.runtime.lastError;
    });
  });
}

zdBrowserRuntime.runWhenReady(document, initializePopup);
