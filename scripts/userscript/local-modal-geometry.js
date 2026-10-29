// Per-site modal geometry with injected storage and viewport adapters.
function createZooModalGeometry(options) {
  function positionKey(id) { return 'zd-modal-pos:' + options.domain() + ':' + id; }
  function sizeKey(id) { return 'zd-modal-size:' + options.domain() + ':' + id; }
  function savePosition(id, left, top) {
    options.writePosition(positionKey(id), JSON.stringify({left: left, top: top}));
  }
  function restorePosition(id, panel) {
    if (!panel) return;
    var raw = options.readPosition(positionKey(id));
    if (!raw) return;
    var pos;
    try { pos = JSON.parse(raw); } catch (error) { return; }
    if (!pos || typeof pos.left !== 'number' || typeof pos.top !== 'number') return;
    var view = options.viewport();
    var maxLeft = Math.max(view.width - panel.offsetWidth, 0);
    var maxTop = Math.max(view.height - panel.offsetHeight, 0);
    panel.style.position = 'fixed';
    panel.style.margin = '0';
    panel.style.left = Math.min(Math.max(pos.left, 0), maxLeft) + 'px';
    panel.style.top = Math.min(Math.max(pos.top, 0), maxTop) + 'px';
  }
  function saveSize(id, width, height) {
    try { options.writeSize(sizeKey(id), JSON.stringify({width: width, height: height})); }
    catch (error) { /* storage is unavailable */ }
  }
  function restoreSize(id, panel) {
    if (!panel) return;
    var raw;
    try { raw = options.readSize(sizeKey(id)); } catch (error) { return; }
    if (!raw) return;
    var size;
    try { size = JSON.parse(raw); } catch (error) { return; }
    if (!size || !(size.width > 0) || !(size.height > 0)) return;
    var view = options.viewport();
    panel.style.width = Math.min(size.width, view.width) + 'px';
    panel.style.height = Math.min(size.height, view.height) + 'px';
  }
  return {positionKey: positionKey, sizeKey: sizeKey, savePosition: savePosition,
    restorePosition: restorePosition, saveSize: saveSize, restoreSize: restoreSize};
}
