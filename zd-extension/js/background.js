importScripts(chrome.runtime.getURL("js/lib/dexie.min.js"));
// ✅ Helper: Create and return Dexie DB instance
function createDb() {
  const db = new Dexie("entries");
  db.version(2).stores({
    entries: '++,vn,en'
  });
  return db;
}

// ✅ Helper: Load dictionary data into DB
function populateFrom(url, db) {
  const opts = { method: 'GET', headers: {} };
  return fetch(url, opts)
      .then(response => response.json())
      .then(data => {
        return db.transaction('rw', db.entries, () => {
          data.forEach(item => {
            db.entries.add(item);
          });
        });
      })
      .then(() => {
        return db.entries.count(count => {
          console.log(`Committed ${count} entries.`);
        });
      });
}

// ✅ On extension install/update: Prepopulate DB if empty
chrome.runtime.onInstalled.addListener(() => {
  const db = createDb();
  db.open()
      .then(() => {
        return db.entries.count();
      })
      .then(count => {
        if (count === 0) {
          console.log("Database empty on install. Loading dictionary...");
          const jsonURL = chrome.runtime.getURL('js/vnedict.json');
          return populateFrom(jsonURL, db);
        } else {
          console.log(`Database already populated (${count} entries).`);
        }
      })
      .catch(err => console.error("DB initialization error:", err));
});

// ✅ Message listener for all runtime messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const db = createDb();
  const jsonURL = chrome.runtime.getURL('js/vnedict.json');

  // Always open DB inside listener
  db.open().then(() => {
    // Handle each message type
    if (message.type === 'initial-search') {
      db.entries
          .where('vn')
          .startsWithIgnoreCase(message.term + " ")
          .uniqueKeys(keysArray => {
            keysArray.sort((a, b) => b.length - a.length);
            const range = keysArray.length ? keysArray[0].split(" ").length : 1;
            sendResponse({ type: 'range', range });
          });

    } else if (message.type === 'second-search') {
      db.entries
          .where('vn')
          .anyOfIgnoreCase(message.candidates)
          .toArray()
          .then(results => {
            results.sort((a, b) => b.vn.split(" ").length - a.vn.split(" ").length);
            sendResponse({ type: 'results', results });
          });

    } else if (message.type === 'reload-db') {
      console.log("Reloading DB...");
      db.entries.clear()
          .then(() => populateFrom(jsonURL, db))
          .then(() => sendResponse({ type: 'reload-complete' }));

    } else if (message.type === 'check-globally-on') {
      chrome.storage.sync.get({ zoopdogIsGloballyOn: true }, items => {
        sendResponse({ type: 'globally-on', status: items.zoopdogIsGloballyOn });
      });

    } else if (message.type === 'toggle-zoopdog') {
      chrome.storage.sync.get({ zoopdogIsGloballyOn: true }, items => {
        const newStatus = !items.zoopdogIsGloballyOn;
        chrome.storage.sync.set({ zoopdogIsGloballyOn: newStatus }, () => {
          chrome.tabs.query({}, tabs => {
            tabs.forEach(tab => {
              chrome.tabs.sendMessage(tab.id, { type: "toggle-zoopdog", status: newStatus });
            });
          });
          sendResponse({ type: 'globally-on', status: newStatus });
        });
      });

    } else if (message.type === 'toggle-lock') {
      chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
        if (tabs[0]) {
          chrome.tabs.sendMessage(tabs[0].id, { type: "toggle-lock" });
        }
        sendResponse({ type: 'lock-toggled' });
      });

    } else if (message.type === 'get-dialect') {
      chrome.storage.sync.get({ myDialect: "hanoi" }, items => {
        sendResponse({ type: 'dialect', dialect: items.myDialect });
      });

    } else if (message.type === 'set-dialect') {
      const newDialect = message.dialect || "hanoi";
      console.log("Setting dialect to:", newDialect);
      chrome.storage.sync.set({ myDialect: newDialect }, () => {
        chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
          if (tabs[0]) {
            chrome.tabs.sendMessage(tabs[0].id, { type: 'set-dialect', dialect: newDialect });
          }
          sendResponse({ type: 'dialect-set', dialect: newDialect });
        });
      });

    } else {
      console.warn("Unknown message type:", message.type);
      sendResponse({ type: 'error', message: 'Unknown message type' });
    }
  }).catch(err => {
    console.error("DB error:", err);
    sendResponse({ type: 'error', message: err.message });
  });

  // Indicate we will respond asynchronously
  return true;
});
