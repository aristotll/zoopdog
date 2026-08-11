// ===============================
// https://stackoverflow.com/a/17694760

var saveSelection, restoreSelection;

if (window.getSelection && document.createRange) {
  saveSelection = function(containerEl) {
    var doc = containerEl.ownerDocument, win = doc.defaultView;
    var range = win.getSelection().getRangeAt(0);
    var preSelectionRange = range.cloneRange();
    preSelectionRange.selectNodeContents(containerEl);
    preSelectionRange.setEnd(range.startContainer, range.startOffset);
    var start = preSelectionRange.toString().length;

    return {
      start: start,
      end: start + range.toString().length
    };
  };

  restoreSelection = function(containerEl, savedSel) {
      var doc = containerEl.ownerDocument, win = doc.defaultView;
      var charIndex = 0, range = doc.createRange();
      range.setStart(containerEl, 0);
      range.collapse(true);
      var nodeStack = [containerEl], node, foundStart = false, stop = false;

      while (!stop && (node = nodeStack.pop())) {
          if (node.nodeType == 3) {
              var nextCharIndex = charIndex + node.length;
              if (!foundStart && savedSel.start >= charIndex && savedSel.start <= nextCharIndex) {
                  range.setStart(node, savedSel.start - charIndex);
                  foundStart = true;
              }
              if (foundStart && savedSel.end >= charIndex && savedSel.end <= nextCharIndex) {
                  range.setEnd(node, savedSel.end - charIndex);
                  stop = true;
              }
              charIndex = nextCharIndex;
          } else {
              var i = node.childNodes.length;
              while (i--) {
                  nodeStack.push(node.childNodes[i]);
              }
          }
      }

      var sel = win.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
  };
} else if (document.selection) {
  saveSelection = function(containerEl) {
    var doc = containerEl.ownerDocument, win = doc.defaultView || doc.parentWindow;
    var selectedTextRange = doc.selection.createRange();
    var preSelectionTextRange = doc.body.createTextRange();
    preSelectionTextRange.moveToElementText(containerEl);
    preSelectionTextRange.setEndPoint("EndToStart", selectedTextRange);
    var start = preSelectionTextRange.text.length;

    return {
      start: start,
      end: start + selectedTextRange.text.length
    };
  };

  restoreSelection = function(containerEl, savedSel) {
    var doc = containerEl.ownerDocument, win = doc.defaultView || doc.parentWindow;
    var textRange = doc.body.createTextRange();
    textRange.moveToElementText(containerEl);
    textRange.collapse(true);
    textRange.moveEnd("character", savedSel.end);
    textRange.moveStart("character", savedSel.start);
    textRange.select();
  };
}

// ===============================

var textField = document.getElementById('textfield')
var mySel
textField.addEventListener('focus', function(){
  var range = document.createRange()
  range.selectNodeContents(this)
  var sel = window.getSelection()
  sel.removeAllRanges()
  sel.addRange(range)
  mySel = saveSelection(this)
})

textField.addEventListener('blur', function(){
  if (window.getSelection) {
    window.getSelection().removeAllRanges();
  } else if (document.selection) {
    document.selection.empty();
  }
})

stripHTML = (el) => {
  el.innerHTML = el.innerHTML.replace(/<\/p>\s*<p.*>/igu, "ZOOPDOG-LINEBREAKZOOPDOG-LINEBREAK")
                             .replace(/<div>(.*?)<\/div>/, "ZOOPDOG-LINEBREAK$1")
                             .replace(/<\/?(font|span|p|div).*?>/igu, "")
                             .replace(/ZOOPDOG-LINEBREAK/igu, "<br>")
                             .normalize()
                             .trim()
  restoreSelection(el, mySel)
}

textField.addEventListener('paste', function(e) {
  stripHTML(this)
  restoreSelection(this, mySel)
})

textField.addEventListener('keyup', function(e) {

  // adapted from https://stackoverflow.com/a/35761139
  //if the last character is a zero-width space, remove it
  var lastCharCode = this.innerHTML.charCodeAt(this.innerHTML.length - 1)
  if (lastCharCode == 8203) {
    this.innerHTML = this.innerHTML.slice(0, -1)
  }

  mySel = saveSelection(this)
  if (e.which === 13) {
    var selection = window.getSelection();
    var range = selection.getRangeAt(0);
    var br = document.createElement("br");
    var zwsp = document.createTextNode("\u200B");
    var textNodeParent = document.getSelection().anchorNode.parentNode;
    var inSpan = textNodeParent.nodeName == "SPAN";
    var span = document.createElement("span");

    // if the carat is inside a <span>, move it out of the <span> tag
    if (inSpan) {
      range.setStartAfter(textNodeParent);
      range.setEndAfter(textNodeParent);
      // create a new span on the next line
      range.insertNode(span);
      range.setStart(span, 0);
      range.setEnd(span, 0);
    }

    // add a zero-width character
    range.insertNode(zwsp);
    range.setStartBefore(zwsp);
    range.setEndBefore(zwsp);

    // insert the new range
    selection.removeAllRanges();
    selection.addRange(range);
    zwsp.parentNode.removeChild(zwsp)
    return false;

  } else if (e.which === 8) {

    this.innerHTML = this.innerHTML.replace(/(<br>)*$/iu, "")
    stripHTML(this)
    this.innerHTML = this.innerHTML.replace(/(<br>)*$/iu, "")
    stripHTML(this)

  } else {

    stripHTML(this)

  }

})

// getWordAndContext, generateCandidates and mouseInRects come from
// zd-extension/js/zd-words.js, loaded by popupdict.html before this file.

const dunzo = () => {
  window.setTimeout(function(){
    var dunzo = document.createElement('div')
    dunzo.classList.add('dunzo')
    document.body.append(dunzo)
  }, 2000)
}

function initializePopupDictionary() {

  const db = new Dexie("entries")
  db.version(2).stores({
    entries: '++,vn,en',
  })
  db.version(3).stores({
    entries: '++,vn,en',
    metadata: '&key',
  })

  const jsonURL = 'zd-extension/js/vnedict.json'
  const metadataURL = 'zd-extension/js/vnedict.meta.json'
  const status = document.getElementById('dictionary-status')
  const retry = document.getElementById('dictionary-retry')

  const loadText = (url) => {
    if (location.protocol === 'file:') {
      return new Promise((resolve, reject) => {
        const request = new XMLHttpRequest()
        request.open('GET', url)
        request.onload = () => {
          if (request.status === 0 || (request.status >= 200 && request.status < 300)) {
            resolve(request.responseText)
          } else {
            reject(new Error(`HTTP ${request.status} loading ${url}`))
          }
        }
        request.onerror = () => reject(new Error(`Unable to load ${url}`))
        request.send()
      })
    }
    return fetch(url).then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status} loading ${url}`)
      return response.text()
    })
  }
  const digest = (globalThis.crypto && globalThis.crypto.subtle) ? async (text) => {
    const bytes = new TextEncoder().encode(text)
    const result = await globalThis.crypto.subtle.digest('SHA-256', bytes)
    return Array.from(new Uint8Array(result), byte => byte.toString(16).padStart(2, '0')).join('')
  } : null
  const renderState = (readiness) => {
    const labels = {
      'ready-current': `Dictionary ready (${readiness.entryCount} entries).`,
      'ready-refreshed': `Dictionary refreshed (${readiness.entryCount} entries).`,
      'ready-stale': `Using the previous dictionary. ${readiness.error.remedy}`,
      unavailable: `Dictionary unavailable. ${readiness.error.remedy}`
    }
    status.textContent = labels[readiness.state] || `Dictionary state: ${readiness.state}`
    retry.hidden = !['ready-stale', 'unavailable'].includes(readiness.state)
  }
  const coordinator = zdDictionaryRuntime.createCoordinator({
    adapter: zdDictionaryRuntime.createDexieAdapter(db),
    fetchMetadata: async () => {
      const text = await loadText(metadataURL)
      try {
        return JSON.parse(text)
      } catch (error) {
        throw new zdDictionaryRuntime.RuntimeError(
          zdDictionaryRuntime.ERRORS.METADATA_INVALID,
          'Runtime dictionary metadata is not valid JSON',
          error
        )
      }
    },
    fetchDictionaryText: () => loadText(jsonURL),
    digest: digest,
    onState: renderState
  })
  let dictionaryReady = coordinator.ensureReady().then((readiness) => {
    renderState(readiness)
    dunzo()
    return readiness
  })
  retry.addEventListener('click', () => {
    retry.disabled = true
    dictionaryReady = coordinator.ensureReady({force: true}).then((readiness) => {
      retry.disabled = false
      renderState(readiness)
      return readiness
    })
  })

  if (!/Chrome|Firefox/.test(navigator.userAgent)) {
    alert("This demo page is not compatible with Safari.\nPlease use Chrome instead.")
  }

  Pace.on('done', function(){
    textField.style.opacity = 1
    Array.from(document.getElementsByClassName('pace')).forEach(function(el){
      el.style.pointerEvents = 'auto'
    })
    document.getElementById('loading-message').style.display = 'none'
    document.getElementById('instructions').style.display = 'block'
  })

  window.highlighter = new Highlighter()
  window.popup = new ResultFrame('zd-extension/frame.html')
  const dialectMenu = document.getElementById('dialect-menu')
  window.popup.dialect = dialectMenu.value
  dialectMenu.addEventListener('change', () => {
    window.popup.dialect = dialectMenu.value
  })
  window.zoopdogIsOn = true
  const lookupTasks = zdBrowserRuntime.createLatestTask()
  const self = window
  let oldWord = null

  const toggleLock = () => {
    self.highlighter.toggleLock()
    self.popup.toggleLock()
  }
  self.popup.onToggleLock = toggleLock
  const invalidateLookup = () => {
    lookupTasks.invalidate()
    oldWord = null
  }

  window.addEventListener('resize', function(e){
    invalidateLookup()
    self.highlighter.off()
    self.popup.hide()
    self.highlighter = new Highlighter()
  })

  textField.addEventListener('scroll', function(e){
    invalidateLookup()
    self.highlighter.off()
    self.popup.hide()
  })

  textField.addEventListener('mouseout', function(e){
    invalidateLookup()
    self.highlighter.off()
    self.popup.hide()
  })

  window.addEventListener('keydown', e => {
    if (e.key === 'Shift' || e.which === 16) toggleLock()
  })

  textField.addEventListener('mousemove', async function(e){

    if (self.popup.locked || !self.zoopdogIsOn) return true

    var mouse = {x: e.clientX, y: e.clientY}
    if (self.highlighter.highlights.length && mouseInRects(mouse, self.highlighter.highlights)) return true

    var origin = getWordAndContext(mouse)
    var el = document.elementFromPoint(mouse.x, mouse.y)

    if (!origin || !origin.word || !el) {
      invalidateLookup()
      self.highlighter.off()
      self.popup.hide()
      return true
    }

    self.highlighter.off()
    self.popup.hide()

    if (Array.from(el.childNodes).indexOf(origin.node) === -1) {
      invalidateLookup()
      return true
    }
    if (origin.word === oldWord) return true
    oldWord = origin.word
    const task = lookupTasks.begin()

    var searchTerm = origin.word.replace(/[Đ\u00D0]/ug, "đ")

    const readiness = await dictionaryReady
    if (!lookupTasks.isCurrent(task)) return false
    if (readiness.state === zdDictionaryRuntime.STATES.UNAVAILABLE) {
      oldWord = null
      return false
    }

    try {
      const keysArray = await db.entries.where('vn').startsWithIgnoreCase(`${searchTerm} `).uniqueKeys()
      if (!lookupTasks.isCurrent(task)) return false
      keysArray.sort((a, b) => b.length - a.length)
      const range = keysArray.length ? keysArray[0].split(' ').length : 1
      const candidates = generateCandidates(origin.context, range)
      const results = await db.entries.where('vn').anyOfIgnoreCase(candidates).toArray()
      if (!lookupTasks.isCurrent(task)) return false
      if (!results.length) {
        oldWord = null
        return false
      }
      results.sort((a, b) => b.vn.split(' ').length - a.vn.split(' ').length)
      const numOfWordsToHighlight = results[0].vn.split(' ').length
      await self.popup.inject()
      if (!lookupTasks.isCurrent(task)) return false
      self.highlighter.on(origin.node, origin.begin, numOfWordsToHighlight)
      await self.popup.populate(results)
      if (!lookupTasks.isCurrent(task)) return false
      if (self.highlighter.highlights.length) await self.popup.show(self.highlighter.highlights[0])
      setTimeout(() => {
        if (lookupTasks.isCurrent(task)) oldWord = null
      }, 500)
    } catch (error) {
      if (lookupTasks.isCurrent(task)) oldWord = null
      console.error('Dictionary lookup failed:', error)
    }

  })

}

zdBrowserRuntime.runWhenReady(document, initializePopupDictionary)
