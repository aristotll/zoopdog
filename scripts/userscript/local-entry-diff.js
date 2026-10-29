// Renders server-provided preview rows using an injected document.
function createZooEntryDiffRenderer(document) {
  function zooDiffEl(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function zooDiffLine(kind, mark, segments) {
    var line = zooDiffEl('div', 'zd-entry-diff-line zd-entry-diff-' + kind);
    var markEl = zooDiffEl('span', 'zd-entry-diff-mark', mark);
    markEl.setAttribute('aria-hidden', 'true');
    var text = zooDiffEl(kind === 'old' ? 'del' : 'ins');
    if (!segments.length) text.appendChild(zooDiffEl('span', 'zd-entry-diff-empty', '(empty)'));
    segments.forEach(function(segment) {
      text.appendChild(segment.changed ? zooDiffEl('mark', '', segment.text) : document.createTextNode(segment.text));
    });
    line.appendChild(markEl);
    line.appendChild(text);
    return line;
  }

  function zooEntryDiffRow(row) {
    var item = zooDiffEl('li', 'zd-entry-diff-row');
    var head = zooDiffEl('div', 'zd-entry-diff-field', row.field);
    if (row.badge) {
      var kind = row.badge === 'locked' || row.badge === 'new' ? ' zd-entry-diff-badge-' + row.badge : '';
      head.appendChild(zooDiffEl('span', 'zd-entry-diff-badge' + kind, row.badge));
    }
    item.appendChild(head);
    if (row.kind === 'change') {
      if (row.old) item.appendChild(zooDiffLine('old', '\u2212', row.old));
      item.appendChild(zooDiffLine('new', '+', row.new));
      return item;
    }
    item.className += row.kind === 'key' ? ' zd-entry-diff-key' : ' zd-entry-diff-context';
    var line = zooDiffEl('div', 'zd-entry-diff-line');
    var mark = zooDiffEl('span', 'zd-entry-diff-mark', '\u00B7');
    mark.setAttribute('aria-hidden', 'true');
    var value = zooDiffEl('span', row.kind === 'key' ? 'zd-entry-diff-keyterm' : '');
    if (row.value) value.textContent = row.value;
    else value.appendChild(zooDiffEl('span', 'zd-entry-diff-empty', '(empty)'));
    line.appendChild(mark);
    line.appendChild(value);
    item.appendChild(line);
    return item;
  }

  function zooScrollEntryDiffToHead(list) {
    list.scrollTop = 0;
    var modal = list.closest ? list.closest('.zd-modal') : null;
    if (!modal) return;
    modal.scrollTop = Math.max(0, list.offsetTop - 12);
  }

  // Returns the number of *changes* drawn; neither the key nor a context row is something to confirm.
  function zooRenderEntryDiff(list, diff) {
    list.textContent = '';
    var rows = diff && Array.isArray(diff.rows) ? diff.rows : [];
    rows.forEach(function(row) { list.appendChild(zooEntryDiffRow(row)); });
    list.hidden = !list.childElementCount;
    zooScrollEntryDiffToHead(list);
    return diff && diff.changed ? diff.changed : 0;
  }

  return zooRenderEntryDiff;
}
