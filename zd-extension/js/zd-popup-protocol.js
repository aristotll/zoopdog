'use strict';

const PROTOCOL_VERSION = 1;
const ALLOWED_DIALECTS = Object.freeze(['hanoi', 'quangnam', 'saigon']);
const MAX_RESULTS = 100;
const MAX_DEFINITIONS = 100;
const MAX_TEXT_LENGTH = 10000;
const FRAME_BOUNDS = Object.freeze({
  minWidth: 200,
  maxWidth: 700,
  maxHeight: 340
});

function hasOnlyKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  return actual.length === keys.length
    && keys.slice().sort().every((key, index) => key === actual[index]);
}

function isBoundedText(value) {
  return typeof value === 'string' && value.length <= MAX_TEXT_LENGTH;
}

function isDefinition(value) {
  return hasOnlyKeys(value, ['def', 'pos'])
    && isBoundedText(value.def)
    && isBoundedText(value.pos);
}

function isResult(value) {
  return hasOnlyKeys(value, ['en', 'vn'])
    && isBoundedText(value.vn)
    && value.vn.length > 0
    && Array.isArray(value.en)
    && value.en.length <= MAX_DEFINITIONS
    && value.en.every(isDefinition);
}

function validateParentMessage(message) {
  if (!message || message.version !== PROTOCOL_VERSION) return false;
  if (message.type === 'lock' || message.type === 'unlock') {
    return hasOnlyKeys(message, ['type', 'version']);
  }
  if (message.type !== 'populate'
      || !hasOnlyKeys(message, ['dialect', 'results', 'type', 'version'])
      || !ALLOWED_DIALECTS.includes(message.dialect)
      || !Array.isArray(message.results)
      || message.results.length > MAX_RESULTS) {
    return false;
  }
  return message.results.every(isResult);
}

function isDimension(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function validateFrameMessage(message) {
  if (!message || message.version !== PROTOCOL_VERSION) return false;
  if (message.type === 'toggle-lock') {
    return hasOnlyKeys(message, ['type', 'version']);
  }
  if (message.type !== 'resize'
      || !hasOnlyKeys(message, ['dimensions', 'type', 'version'])
      || !hasOnlyKeys(message.dimensions, [
        'height', 'horizontalPadding', 'verticalPadding', 'width'
      ])) {
    return false;
  }
  return Object.values(message.dimensions).every(isDimension);
}

function clampDimensions(dimensions) {
  const height = Math.min(
    FRAME_BOUNDS.maxHeight,
    Math.min(300, dimensions.height) + dimensions.verticalPadding + 20
  );
  const width = Math.min(
    FRAME_BOUNDS.maxWidth,
    Math.max(FRAME_BOUNDS.minWidth, dimensions.width) + dimensions.horizontalPadding
  );
  return {height, width};
}

function validateInitEvent(event, parentWindow) {
  if (!event || event.source !== parentWindow
      || !hasOnlyKeys(event.data, ['type', 'version'])
      || event.data.type !== 'zd:init'
      || event.data.version !== PROTOCOL_VERSION
      || !Array.isArray(event.ports)
      || event.ports.length !== 1
      || !event.ports[0]
      || typeof event.ports[0].postMessage !== 'function') {
    return null;
  }
  return event.ports[0];
}

function bindFramePort(target, parentWindow, onMessage) {
  let port = null;
  function initialize(event) {
    if (port) return;
    const candidate = validateInitEvent(event, parentWindow);
    if (!candidate) return;
    port = candidate;
    target.removeEventListener('message', initialize);
    port.onmessage = (portEvent) => onMessage(portEvent.data);
    if (port.start) port.start();
  }
  target.addEventListener('message', initialize);
  return {
    getPort() { return port; },
    close() {
      target.removeEventListener('message', initialize);
      if (port) port.close();
      port = null;
    }
  };
}

const zdPopupProtocol = {
  ALLOWED_DIALECTS,
  FRAME_BOUNDS,
  MAX_DEFINITIONS,
  MAX_RESULTS,
  MAX_TEXT_LENGTH,
  PROTOCOL_VERSION,
  bindFramePort,
  clampDimensions,
  validateFrameMessage,
  validateInitEvent,
  validateParentMessage
};

if (typeof globalThis !== 'undefined') {
  globalThis.zdPopupProtocol = zdPopupProtocol;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = zdPopupProtocol;
}
