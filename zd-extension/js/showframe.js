'use strict';

const PIN_POSITION_KEY = 'zoopdogPopupPinPosition';

class ResultFrame {
  constructor(srcUrl) {
    this.container = document.createElement('iframe');
    this.container.id = 'zoopdog-popup';
    this.container.addEventListener('mousedown', (event) => event.stopPropagation());
    this.container.addEventListener('scroll', (event) => event.stopPropagation());
    this.container.setAttribute('sandbox', 'allow-scripts');
    this.container.setAttribute('src', srcUrl || chrome.runtime.getURL('../frame.html'));
    this.container.style.width = '0px';
    this.container.style.height = '0px';
    this.injected = null;
    this.locked = false;
    this.port = null;
    this.dialect = 'hanoi';
    this.onToggleLock = null;
    this.pinPosition = null;
    this.loadPinPosition();
  }

  initializeChannel() {
    this.closeChannel();
    const channel = new MessageChannel();
    this.port = channel.port1;
    this.port.onmessage = (event) => this.handleFrameMessage(event.data);
    if (this.port.start) this.port.start();
    this.container.contentWindow.postMessage(
      {type: 'zd:init', version: zdPopupProtocol.PROTOCOL_VERSION},
      '*',
      [channel.port2]
    );
  }

  handleFrameMessage(message) {
    if (!zdPopupProtocol.validateFrameMessage(message)) return;
    if (message.type === 'resize') {
      this.resize(message.dimensions);
    } else if (message.type === 'toggle-lock' && typeof this.onToggleLock === 'function') {
      this.onToggleLock();
    } else if (message.type === 'drag' && this.locked) {
      const box = this.container.getBoundingClientRect();
      this.moveTo(box.left + message.dx, box.top + message.dy);
    } else if (message.type === 'drag-end' && this.locked) {
      this.savePinPosition();
    }
  }

  moveTo(left, top) {
    const box = this.container.getBoundingClientRect();
    const style = this.container.style;
    style.left = `${Math.max(0, Math.min(left, window.innerWidth - box.width))}px`;
    style.top = `${Math.max(0, Math.min(top, window.innerHeight - box.height))}px`;
    style.bottom = 'auto';
  }

  savePinPosition() {
    const box = this.container.getBoundingClientRect();
    this.pinPosition = {left: box.left, top: box.top};
    try {
      chrome.storage.local.set({[PIN_POSITION_KEY]: this.pinPosition});
    } catch (error) { /* position just is not remembered */ }
  }

  loadPinPosition() {
    try {
      chrome.storage.local.get(PIN_POSITION_KEY, (items) => {
        const pos = items && items[PIN_POSITION_KEY];
        if (pos && Number.isFinite(pos.left) && Number.isFinite(pos.top)) {
          this.pinPosition = pos;
          if (this.locked) this.moveTo(pos.left, pos.top);
        }
      });
    } catch (error) { /* no stored position */ }
  }

  closeChannel() {
    if (this.port) this.port.close();
    this.port = null;
  }

  inject() {
    if (!this.injected) {
      this.injected = new Promise((resolve) => {
        this.container.addEventListener('load', () => {
          this.initializeChannel();
          resolve();
        });
        document.body.appendChild(this.container);
      });
    }
    return this.injected;
  }

  send(message) {
    const envelope = {...message, version: zdPopupProtocol.PROTOCOL_VERSION};
    if (!zdPopupProtocol.validateParentMessage(envelope)) return Promise.resolve(false);
    return this.inject().then(() => {
      if (!this.port) return false;
      this.port.postMessage(envelope);
      return true;
    });
  }

  populate(results) {
    return this.send({type: 'populate', results, dialect: this.dialect});
  }

  show(rect) {
    return this.inject().then(() => {
      this.container.style.visibility = 'visible';
      this.container.style.position = 'fixed';
      this.container.style.zIndex = '100000';
      this.container.style.left = `${rect.left - 20}px`;
      this.container.style.top = `${rect.bottom}px`;
      this.container.style.bottom = 'auto';

      const popupDimensions = this.container.getBoundingClientRect();
      if (popupDimensions.right > window.innerWidth) {
        const difference = popupDimensions.right - window.innerWidth;
        this.container.style.left = `${parseInt(this.container.style.left, 10) - difference - 20}px`;
      }
      if (rect.top > window.innerHeight / 2) {
        const difference = window.innerHeight - rect.top;
        this.container.style.top = 'auto';
        this.container.style.bottom = `${difference + 10}px`;
      }
      if (popupDimensions.left < 20) this.container.style.left = '20px';
    });
  }

  hide() {
    if (this.locked) return true;
    this.container.style.visibility = 'hidden';
    return false;
  }

  toggleLock() {
    if (this.locked) {
      this.locked = false;
      this.send({type: 'unlock'});
      this.hide();
    } else if (this.container.style.visibility === 'visible') {
      this.locked = true;
      this.send({type: 'lock'});
      if (this.pinPosition) this.moveTo(this.pinPosition.left, this.pinPosition.top);
    }
  }

  resize(dimensions) {
    const size = zdPopupProtocol.clampDimensions(dimensions);
    this.container.style.height = `${size.height}px`;
    this.container.style.width = `${size.width}px`;
  }
}
