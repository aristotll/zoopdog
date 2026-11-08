// Handles only search tabs explicitly opened by the local reader/Zoopdog search action.
function zooStartAiSearchHandoff() {
  var host = window.location.hostname;
  var isQwen = host === 'chat.qwen.ai';
  var isYuanbao = host === 'yuanbao.tencent.com';
  if (!isQwen && !isYuanbao) return;
  var params = new URLSearchParams(window.location.hash.slice(1));
  var text = params.get('zoopdog_search');
  if (!text) return;
  var attempts = 0;
  function fill() {
    var editor = document.querySelector(isQwen ? 'textarea.message-input-textarea' : '.ql-editor[contenteditable="true"]');
    if (!editor) {
      if (++attempts < 80) setTimeout(fill, 250);
      return;
    }
    if ((editor.value || editor.innerText || '').trim()) return;
    editor.focus();
    if (!document.execCommand('insertText', false, text)) return;
    // Consume before the click so a reload or SPA navigation cannot submit twice.
    params.delete('zoopdog_search');
    var rest = params.toString();
    window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search + (rest ? '#' + rest : ''));
    var sendAttempts = 0;
    function send() {
      var button = document.querySelector(isQwen ? '.chat-prompt-send-button button.send-button' : '[data-new-input-control="send"] [aria-label="Send"], [data-new-input-control="send"] [aria-label="发送"]');
      if (button && !button.disabled && button.getAttribute('aria-disabled') !== 'true') { button.click(); return; }
      if (++sendAttempts < 20) setTimeout(send, 250);
    }
    setTimeout(send, 250);
  }
  fill();
}
