#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const {
  readUserNomEntries,
  toDictionaryEntries
} = require('./user-nom-entries');

const rootDir = path.resolve(__dirname, '..');
const dictionaryPath = path.join(rootDir, 'zd-extension/db_src/vnedict2.json');
const userNomPath = path.join(rootDir, 'zd-extension/db_src/user_nom_entries.jsonc');
const targetPath = path.join(rootDir, 'zoopdog-popupdict.user.js');

const sourceFiles = [
  'zd-extension/js/lib/chroma.min.js',
  'zd-extension/js/zd-pron-data.js',
  'zd-extension/js/zd-pron-functions.js',
  'zd-extension/js/zd-pron-drawtones.js'
];

function cleanText(value) {
  return String(value || '')
    .replace(/^\uFEFF/, '')
    .normalize('NFC')
    .trim();
}

function normalizeTerm(value) {
  return cleanText(value)
    .toLocaleLowerCase('vi-VN')
    .replace(/\s+/g, ' ');
}

function buildDictionary(entries) {
  const dictionary = {};
  let maxWords = 1;

  for (const entry of entries) {
    const key = normalizeTerm(entry.vn);

    if (!key) {
      continue;
    }

    maxWords = Math.max(maxWords, key.split(/\s+/).length);

    if (!dictionary[key]) {
      dictionary[key] = [];
    }

    dictionary[key].push([
      cleanText(entry.vn),
      (entry.en || []).map((item) => [
        cleanText(item.def),
        cleanText(item.pos)
      ])
    ]);
  }

  return {dictionary, maxWords};
}

function readRuntimeSources() {
  return sourceFiles.map((relativePath) => {
    const absolutePath = path.join(rootDir, relativePath);
    return [
      `// ===== ${relativePath} =====`,
      fs.readFileSync(absolutePath, 'utf8')
    ].join('\n');
  }).join('\n\n');
}

function buildCss() {
  return `
@import url("https://fonts.googleapis.com/css?family=Fira+Sans:300,800");

#zoopdog-userscript-popup {
  position: fixed;
  left: 0;
  top: 0;
  z-index: 2147483646;
  visibility: hidden;
  box-sizing: border-box;
  margin-top: 5px;
  padding: 10px 20px;
  min-width: 220px;
  max-width: 440px;
  max-height: 320px;
  overflow-x: hidden;
  overflow-y: auto;
  white-space: nowrap;
  background: #F2ECE1;
  border: none;
  border-radius: 10px;
  box-shadow: 4px 4px 19px -2px rgba(0, 0, 0, 0.47);
  color: #000;
  font-family: "Fira Sans", sans-serif;
  font-size: 16px;
  line-height: normal;
  touch-action: pan-x pan-y;
}

#zoopdog-userscript-popup * {
  box-sizing: border-box;
}

#zoopdog-userscript-popup-lock-icon {
  position: fixed;
  right: 15px;
  top: 12px;
  z-index: 2147483647;
  font-size: 16pt;
  line-height: 1;
  visibility: hidden;
  pointer-events: none;
}

#zoopdog-userscript-popup-body {
  white-space: normal;
}

#zoopdog-userscript-popup-body h1 {
  color: #5BB1B7;
  margin: 5px 0 10px;
  white-space: nowrap;
  font-weight: 800;
  font-size: 18pt;
  line-height: 1.2;
}

#zoopdog-userscript-popup-body ul {
  font-weight: 300;
  font-size: 10pt;
  margin: 0;
  padding: 10px 0 0 20px;
  line-height: 1.5em;
  min-width: 200px;
  max-width: 400px;
}

#zoopdog-userscript-popup-body ul li {
  margin: 5px 0;
  padding: 0;
}

#zoopdog-userscript-popup-body ul li .zoopdog-pos {
  background: #B6638F;
  color: #fff;
  font-weight: bold;
  padding: 2px 4px;
  border-radius: 5px;
}

#zoopdog-userscript-popup-body ul li.zoopdog-cjk-def {
  font-size: 12pt;
  line-height: 1.6;
  word-break: keep-all;
}

#zoopdog-userscript-popup-body .zd-definition:not(:last-child) ul {
  border-bottom: 1px solid #5BB1B7;
  padding-bottom: 20px !important;
  margin-bottom: 20px !important;
}

#zoopdog-userscript-popup-body .zd-pronunciation {
  white-space: nowrap;
}

#zoopdog-userscript-popup-body .zd-pronunciation .zoopdog-word {
  font-size: 16pt;
  user-select: none;
  cursor: default;
  margin-top: 10px;
  margin-bottom: 20px;
}

.zoopdog-word {
  font-family: "DejaVuSansMono-Regular", "DejaVu Sans Mono", monospace;
  position: relative;
  display: inline-block;
  margin-bottom: 30px;
}

.zoopdog-word .zd-tone-canvas {
  height: 200%;
  width: 100%;
}

.zoopdog-word .source-word,
.zoopdog-word .source-ipa {
  display: none;
  font-size: 10pt;
  font-weight: 300;
  position: absolute;
  left: 11px;
}

.zoopdog-word .source-word {
  font-family: "Fira Sans", sans-serif;
  top: -15px;
}

.zoopdog-word .source-ipa {
  font-family: "Charis SIL", "CharisSILW", "Lucida Grande", "Lucida Sans Unicode", "Arial Unicode MS", sans-serif;
  top: -20px;
}

.zoopdog-word .phonemic-unit {
  display: inline;
  vertical-align: middle;
  background: #BFB5AF;
  color: #BFB5AF;
  margin: 0;
  padding: 0;
}

.zoopdog-word .phonemic-unit:first-child {
  border-radius: 10px 0 0 10px;
  padding-left: 10px;
}

.zoopdog-word .phonemic-unit:last-child {
  border-radius: 0 10px 10px 0;
  padding-right: 10px;
}

.zoopdog-word .phonemic-unit:only-child {
  border-radius: 10px;
  padding-left: 10px;
  padding-right: 10px;
}

.zoopdog-word .phonemic-unit.short-vowel {
  background: #5BB1B7;
  color: #5BB1B7;
}

.zoopdog-word .phonemic-unit.glide {
  background: #ECE2D0;
  color: #ECE2D0;
}

.zoopdog-word .phonemic-unit.glide .super {
  font-size: 0.75em;
  vertical-align: top;
  margin: 2px;
}

.zoopdog-word .phonemic-unit.long-vowel,
.zoopdog-word .phonemic-unit.long-consonant {
  padding-right: 20px;
}

.zoopdog-word .phonemic-unit.long-vowel {
  background: #0685AA;
  color: #0685AA;
}

.zoopdog-word .phonemic-unit.long-consonant {
  background: #9B2966;
  color: #9B2966;
}

.phonemes.blank-bg {
  position: absolute;
  left: 0;
  top: 0;
}

.phonemes.blank-bg .phonemic-unit {
  color: #fff;
  background: none;
}
`;
}

function buildUserscript(dictionary, maxWords, runtimeSources) {
  return `// ==UserScript==
// @name        Zoopdog Popup Dictionary
// @description Vietnamese-English popup dictionary with Zoopdog pronunciation guide
// @author      Zoopdog Contributors
// @namespace   https://github.com/tabidots/zoopdog
// @match       *://*/*
// @grant       GM_addStyle
// @run-at      document-idle
// @version     2026.04.19
// ==/UserScript==

(function() {
${runtimeSources}

  // Generated by scripts/build-popupdict-userscript.js from zd-extension/db_src/vnedict2.json.
  // Also merges zd-extension/db_src/user_nom_entries.jsonc when present.
  // Dictionary keys embedded: ${Object.keys(dictionary).length}
  var ZOO_DICTIONARY = ${JSON.stringify(dictionary)};
  var ZOO_MAX_WORDS = ${maxWords};

  var ZOO_SETTINGS = {
    dialect: 'hanoi',
    cjkDefinitionLineLength: 18,
    oldWordResetMs: 500
  };

  var ZOO_WORD_CHAR_RE = /[-\\u00D0A-Za-zÀÁÂÃÈÉÊÌÍÒÓÔÕÙÚĂĐĨŨƠƯàáâãèéêìíòóôõùúăđĩũơưẠẢẤẦẨẪẬẮẰẲẴẶẸẺẼỀẾỂỄỆỈỊỌỎỐỒỔỖỘỚỜỞỠỢỤỦỨỪỬỮỰỲỴÝỶỸạảấầẩẫậắằẳẵặẹẻẽềếểễệỉịọỏốồổỗộớờởỡợụúủứừửữựỳýỵỷỹ]/u;
  var ZOO_CJK_RE = /[\\u3400-\\u4DBF\\u4E00-\\u9FFF\\uF900-\\uFAFF\\u{20000}-\\u{323AF}]/u;
  var ZOO_CJK_SEQUENCE_RE = /[\\u3400-\\u4DBF\\u4E00-\\u9FFF\\uF900-\\uFAFF\\u{20000}-\\u{323AF}]+/gu;

  function addStyle(css) {
    if (typeof GM_addStyle === 'function') {
      GM_addStyle(css);
      return;
    }

    if (typeof GM !== 'undefined' && GM && typeof GM.addStyle === 'function') {
      GM.addStyle(css);
      return;
    }

    var head = document.getElementsByTagName('head')[0];
    if (!head) {
      return;
    }

    var style = document.createElement('style');
    style.type = 'text/css';
    style.textContent = css;
    head.appendChild(style);
  }

  function isWordChar(ch) {
    return !!ch && ZOO_WORD_CHAR_RE.test(ch);
  }

  function normalizeLookup(value) {
    return String(value || '')
      .replace(/[Đ\\u00D0]/gu, 'đ')
      .normalize('NFC')
      .toLocaleLowerCase('vi-VN')
      .replace(/\\s+/g, ' ')
      .trim();
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function getWordAndContext(mouse) {
    var range;
    var textNode;
    var offset;

    if (document.caretPositionFromPoint) {
      range = document.caretPositionFromPoint(mouse.x, mouse.y);
      if (!range) {
        return false;
      }
      textNode = range.offsetNode;
      offset = range.offset;
    } else if (document.caretRangeFromPoint) {
      range = document.caretRangeFromPoint(mouse.x, mouse.y);
      if (!range) {
        return false;
      }
      textNode = range.startContainer;
      offset = range.startOffset;
    } else {
      return false;
    }

    if (!textNode || textNode.nodeType !== Node.TEXT_NODE) {
      return false;
    }

    var data = textNode.data;
    var i = offset;
    var begin;
    var end;
    var contextEnd;

    if (data === undefined || i >= data.length || data[i] === ' ') {
      return false;
    }

    while (i > -1 && isWordChar(data[i])) {
      --i;
    }
    begin = i + 1;

    i = offset;
    while (i < data.length && isWordChar(data[i])) {
      ++i;
    }
    end = i;

    i = offset;
    while (i < data.length && (isWordChar(data[i]) || data[i] === ' ')) {
      ++i;
    }
    contextEnd = i;

    return {
      word: data.substring(begin, end).trim(),
      context: data.substring(begin, contextEnd).trim(),
      node: textNode,
      begin: begin
    };
  }

  function lookupContext(context) {
    var split = String(context || '').trim().split(/\\s+/).filter(Boolean);
    var limit = Math.min(split.length, ZOO_MAX_WORDS);

    for (var i = limit; i > 0; i--) {
      var candidate = normalizeLookup(split.slice(0, i).join(' '));
      if (ZOO_DICTIONARY[candidate]) {
        return {
          key: candidate,
          wordCount: i,
          results: ZOO_DICTIONARY[candidate]
        };
      }
    }

    return null;
  }

  function mouseInRects(mouse, rects) {
    for (var i = 0; i < rects.length; i++) {
      var rect = rects[i];
      if (rect.left <= mouse.x && mouse.x <= rect.right &&
          rect.top <= mouse.y && mouse.y <= rect.bottom) {
        return true;
      }
    }
    return false;
  }

  function elementContainsTextNode(element, textNode) {
    if (!element || !textNode || !textNode.parentNode) {
      return false;
    }
    return element === textNode.parentNode || element.contains(textNode.parentNode);
  }

  function isExcludedTarget(target) {
    if (!target || target.nodeType !== Node.ELEMENT_NODE) {
      return false;
    }

    return !!target.closest(
      '#zoopdog-userscript-popup, #zoopdog-userscript-canvas, input, textarea, select, option, button, script, style, [contenteditable="true"]'
    );
  }

  function getEventPoint(event) {
    var touch = null;

    if (event.changedTouches && event.changedTouches.length) {
      touch = event.changedTouches[0];
    } else if (event.touches && event.touches.length) {
      touch = event.touches[0];
    }

    if (touch) {
      return {x: touch.clientX, y: touch.clientY};
    }

    if (typeof event.clientX === 'number' && typeof event.clientY === 'number') {
      return {x: event.clientX, y: event.clientY};
    }

    return null;
  }

  function Highlighter() {
    this.highlights = [];
    this.padding = 5;
    this.locked = false;
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'zoopdog-userscript-canvas';
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.position = 'fixed';
    this.canvas.style.left = 0;
    this.canvas.style.top = '1px';
    this.canvas.style.zIndex = 2147483645;
    this.canvas.style.pointerEvents = 'none';
    document.body.appendChild(this.canvas);
    this.context = this.canvas.getContext('2d');
    this.resize();
  }

  Highlighter.prototype.resize = function() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
  };

  Highlighter.prototype.on = function(node, begin, howManyWords) {
    if (this.highlights.length) {
      this.off();
    }
    if (node === undefined) {
      return true;
    }

    var words = 0;
    var prevChar = '';
    var i;
    for (i = begin; i < node.data.length; i++) {
      if (node.data[i] === ' ') {
        if (prevChar && isWordChar(prevChar)) {
          words++;
        }
      } else if (!isWordChar(node.data[i])) {
        break;
      }

      if (words === howManyWords) {
        break;
      }

      prevChar = node.data[i];
    }

    if (i === begin) {
      return true;
    }

    if (node.data[begin] === ' ') {
      begin++;
    }

    var range = new Range();
    range.setStart(node, begin);
    range.setEnd(node, i);
    this.highlights = Array.from(range.getClientRects());

    this.context.beginPath();
    for (var j = 0; j < this.highlights.length; j++) {
      var hl = this.highlights[j];
      this.context.rect(
        hl.left - this.padding,
        hl.top - this.padding,
        hl.width + (this.padding * 2),
        hl.height + (this.padding * 2)
      );
      this.context.globalAlpha = 0.25;
      this.context.fillStyle = '#B6638F';
      this.context.fill();
    }
  };

  Highlighter.prototype.off = function() {
    if (this.locked) {
      return true;
    }
    this.context.beginPath();
    this.context.setTransform(1, 0, 0, 1, 0, 0);
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.context.globalAlpha = 0;
    this.highlights = [];
  };

  Highlighter.prototype.toggleLock = function() {
    if (this.locked) {
      this.locked = false;
      this.off();
    } else if (this.highlights.length) {
      this.locked = true;
    }
  };

  function ResultPopup() {
    this.container = document.createElement('div');
    this.container.id = 'zoopdog-userscript-popup';
    this.container.addEventListener('mousedown', function(event) { event.stopPropagation(); });
    this.container.addEventListener('scroll', function(event) { event.stopPropagation(); });

    this.lockIcon = document.createElement('div');
    this.lockIcon.id = 'zoopdog-userscript-popup-lock-icon';
    this.lockIcon.textContent = '📌';

    this.body = document.createElement('div');
    this.body.id = 'zoopdog-userscript-popup-body';
    this.container.appendChild(this.lockIcon);
    this.container.appendChild(this.body);
    document.body.appendChild(this.container);
    this.locked = false;
  }

  ResultPopup.prototype.populate = function(results) {
    this.body.innerHTML = results.map(renderDefinition).join('');
    drawTonesAndGradients();
  };

  ResultPopup.prototype.show = function(rect) {
    this.container.style.visibility = 'visible';
    this.container.style.left = (rect.left - 20) + 'px';
    this.container.style.top = rect.bottom + 'px';
    this.container.style.bottom = 'auto';

    var popupDimensions = this.container.getBoundingClientRect();
    var rightEdge = popupDimensions.right;
    if (rightEdge > window.innerWidth) {
      var xDif = rightEdge - window.innerWidth;
      this.container.style.left = (parseInt(this.container.style.left, 10) - xDif - 20) + 'px';
    }

    if (rect.top > window.innerHeight / 2) {
      var yDif = window.innerHeight - rect.top;
      this.container.style.top = 'auto';
      this.container.style.bottom = (yDif + 10) + 'px';
    }

    popupDimensions = this.container.getBoundingClientRect();
    if (popupDimensions.left < 20) {
      this.container.style.left = '20px';
    }
  };

  ResultPopup.prototype.hide = function() {
    if (this.locked) {
      return true;
    }
    this.container.style.visibility = 'hidden';
  };

  ResultPopup.prototype.toggleLock = function() {
    if (this.locked) {
      this.locked = false;
      this.lockIcon.style.visibility = 'hidden';
      this.hide();
    } else if (this.container.style.visibility === 'visible') {
      this.locked = true;
      this.lockIcon.style.visibility = 'visible';
    }
  };

  function renderDefinition(entry) {
    var vn = entry[0];
    var definitions = entry[1];
    var pronunciation = renderPronunciation(vn);

    return [
      '<div class="zd-definition">',
      '<h1>', escapeHtml(vn), '</h1>',
      '<div class="zd-pronunciation">', pronunciation, '</div>',
      '<ul>',
      renderDefinitionItems(definitions),
      '</ul>',
      '</div>'
    ].join('');
  }

  function renderDefinitionItems(definitions) {
    var html = [];
    var pendingCjkTokens = [];

    function flushCjkTokens() {
      if (!pendingCjkTokens.length) {
        return;
      }

      chunkCjkTokens(pendingCjkTokens).forEach(function(chunk) {
        html.push('<li class="zoopdog-cjk-def">' + chunk.map(escapeHtml).join(' | ') + '</li>');
      });
      pendingCjkTokens = [];
    }

    definitions.forEach(function(item) {
      if (isCjkDefinition(item)) {
        pendingCjkTokens = pendingCjkTokens.concat(extractCjkTokens(item[0]));
        pendingCjkTokens = Array.from(new Set(pendingCjkTokens));
        return;
      }

      flushCjkTokens();
      html.push(renderDefinitionItem(item));
    });

    flushCjkTokens();
    return html.join('');
  }

  function isCjkDefinition(item) {
    return !item[1] && ZOO_CJK_RE.test(item[0]) && !/[A-Za-z]/.test(item[0]);
  }

  function extractCjkTokens(value) {
    return Array.from(new Set(String(value || '').match(ZOO_CJK_SEQUENCE_RE) || []));
  }

  function chunkCjkTokens(tokens) {
    var chunks = [];
    var current = [];
    var currentLength = 0;

    tokens.forEach(function(token) {
      var tokenLength = Array.from(token).length;
      var extraLength = current.length ? tokenLength + 3 : tokenLength;

      if (current.length && currentLength + extraLength > ZOO_SETTINGS.cjkDefinitionLineLength) {
        chunks.push(current);
        current = [];
        currentLength = 0;
        extraLength = tokenLength;
      }

      current.push(token);
      currentLength += extraLength;
    });

    if (current.length) {
      chunks.push(current);
    }

    return chunks;
  }

  function renderDefinitionItem(item) {
    var definition = escapeHtml(item[0]);
    var pos = escapeHtml(item[1]);
    if (pos) {
      return '<li><span class="zoopdog-pos">' + pos + '</span> ' + definition + '</li>';
    }
    return '<li>' + definition + '</li>';
  }

  function renderPronunciation(word) {
    try {
      var byDialect = pronunciationGuide(word);
      var result = byDialect[ZOO_SETTINGS.dialect] || byDialect.hanoi;
      return result && result.zd ? result.zd : escapeHtml(word);
    } catch (error) {
      return escapeHtml(word);
    }
  }

  function main() {
    if (!document.body) {
      window.setTimeout(main, 50);
      return;
    }

    addStyle(${JSON.stringify(buildCss())});

    var highlighter = new Highlighter();
    var popup = new ResultPopup();
    var oldWord = null;

    function clearActiveResult() {
      highlighter.off();
      popup.hide();
    }

    function mainListener(event, clearOnMiss) {
      if (popup.locked || isExcludedTarget(event.target)) {
        return true;
      }

      var mouse = getEventPoint(event);
      if (!mouse) {
        return true;
      }

      if (highlighter.highlights.length && mouseInRects(mouse, highlighter.highlights)) {
        return true;
      }

      var origin = getWordAndContext(mouse);
      var element = document.elementFromPoint(mouse.x, mouse.y);

      if (!origin || !origin.word || !elementContainsTextNode(element, origin.node)) {
        if (clearOnMiss) {
          clearActiveResult();
        }
        return true;
      }

      clearActiveResult();

      if (origin.word === oldWord) {
        return true;
      }

      oldWord = origin.word;
      var lookup = lookupContext(origin.context);
      if (!lookup) {
        window.setTimeout(function() {
          oldWord = null;
        }, ZOO_SETTINGS.oldWordResetMs);
        return true;
      }

      highlighter.on(origin.node, origin.begin, lookup.wordCount);
      popup.populate(lookup.results);
      popup.show(highlighter.highlights[0] || {
        left: mouse.x,
        right: mouse.x,
        top: mouse.y,
        bottom: mouse.y
      });

      window.setTimeout(function() {
        oldWord = null;
      }, ZOO_SETTINGS.oldWordResetMs);

      return true;
    }

    window.addEventListener('resize', function() {
      highlighter.resize();
      clearActiveResult();
    });

    var lastTouchTime = 0;
    var touchMoved = false;
    var pointerTouchMoved = false;

    window.addEventListener('scroll', clearActiveResult, true);
    window.addEventListener('mouseout', function() {
      if (Date.now() - lastTouchTime > 700) {
        clearActiveResult();
      }
    });

    function touchListener(event) {
      lastTouchTime = Date.now();
      if (touchMoved) {
        touchMoved = false;
        return true;
      }
      return mainListener(event, true);
    }

    function clickListener(event) {
      if (Date.now() - lastTouchTime < 700) {
        return true;
      }
      return mainListener(event, true);
    }

    if ('PointerEvent' in window) {
      window.addEventListener('pointerdown', function(event) {
        if (event.pointerType === 'touch') {
          lastTouchTime = Date.now();
          pointerTouchMoved = false;
        }
      }, {passive: true});

      window.addEventListener('pointermove', function(event) {
        if (event.pointerType === 'touch') {
          lastTouchTime = Date.now();
          pointerTouchMoved = true;
          clearActiveResult();
          return;
        }

        if (event.pointerType === 'mouse' || event.pointerType === 'pen') {
          mainListener(event, false);
        }
      }, {passive: true});

      window.addEventListener('pointerup', function(event) {
        if (event.pointerType === 'touch') {
          lastTouchTime = Date.now();
        }

        if (event.pointerType === 'touch' && pointerTouchMoved) {
          pointerTouchMoved = false;
          return true;
        }
        mainListener(event, true);
      }, {passive: true});
    } else {
      window.addEventListener('mousemove', function(event) {
        mainListener(event, false);
      });

      window.addEventListener('touchstart', function() {
        touchMoved = false;
      }, {passive: true});

      window.addEventListener('touchmove', function() {
        touchMoved = true;
        clearActiveResult();
      }, {passive: true, capture: true});

      window.addEventListener('touchend', touchListener, {passive: true});
      window.addEventListener('click', clickListener);
    }

    window.addEventListener('keydown', function(event) {
      if (event.which === 16) {
        highlighter.toggleLock();
        popup.toggleLock();
      }
    });
  }

  main();
})();
`;
}

const userNomEntries = readUserNomEntries(userNomPath);
const entries = JSON.parse(fs.readFileSync(dictionaryPath, 'utf8')).concat(
  toDictionaryEntries(userNomEntries)
);
const {dictionary, maxWords} = buildDictionary(entries);
const runtimeSources = readRuntimeSources();

fs.writeFileSync(targetPath, buildUserscript(dictionary, maxWords, runtimeSources), 'utf8');

console.log(`Wrote ${targetPath}`);
console.log(`Embedded ${Object.keys(dictionary).length} dictionary keys`);
if (userNomEntries.length) {
  console.log(`Merged ${userNomEntries.length} user Nom entries from ${userNomPath}`);
}
console.log(`Maximum term length: ${maxWords} words`);
