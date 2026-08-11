'use strict';

const popupBody = document.getElementById('zoopdog-popup-body');
const myTemplate = Handlebars.compile(document.getElementById('zoopdog-popup-template').innerHTML);

function postToParent(message) {
  const port = frameBinding.getPort();
  if (port) {
    port.postMessage({...message, version: zdPopupProtocol.PROTOCOL_VERSION});
  }
}

function sendSize(ofWhat) {
  const htmlStyle = window.getComputedStyle(document.documentElement);
  postToParent({
    type: 'resize',
    dimensions: {
      height: ofWhat.scrollHeight,
      width: ofWhat.scrollWidth,
      verticalPadding: parseInt(htmlStyle.marginTop, 10) * 2 || 0,
      horizontalPadding: parseInt(htmlStyle.marginLeft, 10) * 2 || 0
    }
  });
  document.body.style.overflowY = ofWhat.scrollHeight > 300 ? 'scroll' : 'hidden';
}

function renderResults(message) {
  popupBody.style.width = '0px';
  popupBody.innerHTML = myTemplate({results: message.results});
  Array.from(document.getElementsByClassName('zd-pronunciation')).forEach((element) => {
    const source = element.textContent;
    element.innerHTML = pronunciationGuide(source)[message.dialect].zd;
  });
  drawTonesAndGradients();
  sendSize(popupBody);
}

function handleParentMessage(message) {
  if (!zdPopupProtocol.validateParentMessage(message)) return;
  if (message.type === 'populate') {
    renderResults(message);
  } else if (message.type === 'lock') {
    document.getElementById('zoopdog-popup-lock-icon').style.visibility = 'visible';
  } else if (message.type === 'unlock') {
    document.getElementById('zoopdog-popup-lock-icon').style.visibility = 'hidden';
  }
}

const frameBinding = zdPopupProtocol.bindFramePort(window, window.parent, handleParentMessage);
window.addEventListener('keydown', (event) => {
  if (event.key === 'Shift' || event.which === 16) {
    postToParent({type: 'toggle-lock'});
  }
});
