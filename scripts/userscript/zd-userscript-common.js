// Small helpers shared by the nom-ruby and cjk-ruby userscripts. Both builders inline this file into
// their IIFE (placeholder in each runtime, filled by scripts/build-nom-userscript.js and
// scripts/build-cjk-ruby-userscript.js), so these are plain top-level declarations, not a module.
//
// Only logic that is provably the same in both runtimes lives here. The scan loops, queues and
// MutationObserver handling stay in each runtime: nom-ruby scans synchronously in time slices and
// tracks which nodes it owns, cjk-ruby scans asynchronously around network requests and a cache.

/**
 * @typedef {object} ZdBackoffPollOptions
 * @property {number} intervalMs Delay used while polls keep finding work, and the first delay.
 * @property {number} maxMs Longest delay the poll backs off to while polls find nothing.
 * @property {() => boolean} run One poll; returns whether it found work to do.
 * @property {(callback: () => void, ms: number) => unknown} setTimeout Timer function to arm with.
 * @property {(handle: unknown) => void} clearTimeout Cancels a handle returned by `setTimeout`.
 * @property {() => boolean} [isActive] Asked after each run; when it answers false the poll
 *   stops re-arming itself (it stays stopped until `start()`). Omit to keep polling for ever.
 */

// A self-rescheduling safety-net timer. It starts at `intervalMs`, doubles (up to `maxMs`) after
// every poll that finds nothing and drops back to `intervalMs` after one that does. `wake()` is for
// events that may bring work (a mutation): it only restarts a timer that has backed off, so a steady
// stream of events cannot keep postponing a poll that is already at the short interval. Nothing is
// scheduled until `start()`; `stop()` cancels the pending poll.
/** @param {ZdBackoffPollOptions} options */
function zdCreateBackoffPoll(options) {
  /** @type {unknown} */
  var timer = null;
  var delay = options.intervalMs;

  function poll() {
    var worked = options.run();
    delay = worked ? options.intervalMs : Math.min(delay * 2, options.maxMs);
    timer = !options.isActive || options.isActive() ? options.setTimeout(poll, delay) : null;
  }

  function start() {
    options.clearTimeout(timer);
    delay = options.intervalMs;
    timer = options.setTimeout(poll, delay);
  }

  function stop() {
    options.clearTimeout(timer);
    timer = null;
  }

  function wake() {
    if (timer !== null && delay > options.intervalMs) {
      start();
    }
  }

  return {start: start, stop: stop, wake: wake};
}
