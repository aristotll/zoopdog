'use strict';

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
    }
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
    }
  }

  resize(dimensions) {
    const size = zdPopupProtocol.clampDimensions(dimensions);
    this.container.style.height = `${size.height}px`;
    this.container.style.width = `${size.width}px`;
  }
}
