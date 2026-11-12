// The offline Nôm review queue uses an injected string store; browser UI stays outside it.
/** @typedef {{vi: string, context: string, ts: number}} ZooNomReviewEntry */
/** @param {{read: () => string, write: (value: string) => void}} storage */
function createZooNomReviewStore(storage) {
  /** @returns {ZooNomReviewEntry[]} */
  function read() {
    try {
      var parsed = JSON.parse(storage.read());
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) { return []; }
  }
  /** @param {ZooNomReviewEntry[]} entries */
  function write(entries) { storage.write(JSON.stringify(entries)); }
  /** @param {string} vi */
  function has(vi) { return read().some(function(entry) { return entry.vi === vi; }); }
  /** @param {ZooNomReviewEntry} entry */
  function add(entry) {
    if (!entry.vi) return false;
    var queue = read();
    if (queue.some(function(existing) { return existing.vi === entry.vi; })) return false;
    queue.push(entry);
    write(queue);
    return true;
  }
  return {read: read, write: write, has: has, add: add};
}
