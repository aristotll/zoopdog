#!/usr/bin/env node
'use strict';

// Browser performance measurement: loads built userscripts into a real Chromium (through
// Playwright) and reports what the performance plan's completion criteria talk about -- script
// evaluation time, the longest long task, main-thread task time and JS heap -- for the popup
// userscript on a plain page and on a page with five same-origin iframes (at load, on a first
// hover, and on a first hover after the pre-warm had an idle moment), and for nom-ruby on a long
// generated Vietnamese page. It is not part of `make verify`; run it with `make browser-perf`.
// Playwright is not a dependency of this repository (same as scripts/browser-smoke.js): it is
// resolved from the environment, and without it the script prints "skipped" and exits 0, unless
// `--require` is given. It writes nothing into the repository: pages are served from memory
// through Playwright's request routing, and a missing built userscript is built by the real
// builder at its usual (gitignored) repository-root path.
//
// Usage:
//   node scripts/browser-perf.js [popup.user.js [nom-ruby.user.js]] [--popup FILE] [--nom FILE]
//                                [--runs N] [--only popup|nom] [--json] [--require]
// Pass the userscripts of two commits to compare them (docs/build.md describes the worktree recipe).
//
// How each number is measured (all from the page's main thread, in one Chromium):
//   evalMs        time to compile and run the userscript source, measured inside the page around the
//                 insertion of an inline <script> (the source is handed to each frame beforehand, so
//                 the megabytes crossing the DevTools protocol are not counted), summed over the main
//                 frame and every iframe: each frame runs its own copy, as a userscript manager does.
//   longTaskMs    the longest entry of a buffered PerformanceObserver('longtask') in the top frame
//                 from the start of injection (it also reports same-process iframes). The API only reports tasks
//                 over 50 ms, so 0 means "none over 50 ms", not "none over 5 ms".
//   taskMs        total main-thread task time (CDP Performance.getMetrics TaskDuration delta) from
//                 injection until 400 ms after it; this is what shows work below the long-task bar.
//   heapMB        JS heap in use after two forced garbage collections (CDP HeapProfiler.collectGarbage,
//                 then Runtime.getHeapUsage). Same-origin iframes share the page's isolate, so this
//                 is the total over all frames. The `...DeltaMB` metrics subtract the same measure taken
//                 before the source was handed to the page. Strings count as heap, so the embedded
//                 dictionary text is included.
//   latencyMs     from starting the pointer move onto the word until the popup shows its definition,
//                 polled once per animation frame (about 16 ms resolution, plus the protocol).
//   maxGapMs      nom-ruby: the largest gap between two ticks of a 4 ms timer while the page was being
//                 annotated, i.e. the longest the page was unresponsive (rendering work included).
//   settleMs      nom-ruby: injection until the last DOM mutation under <body> (MutationObserver) after
//                 which the page stays quiet for 2 s; `rubies` is the final <ruby> count.

const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');

const root = path.resolve(__dirname, '..');
const ORIGIN = 'http://perf.test';
const GM_SHIM = 'window.GM_addStyle=function(c){var s=document.createElement("style");' +
  's.textContent=c;document.head.appendChild(s)};';

const DEFAULTS = {
  popup: path.join(root, 'zoopdog-popupdict.user.js'),
  nom: path.join(root, 'zoopdog-nom-ruby.user.js')
};
const BUILDERS = {
  popup: path.join(__dirname, 'build-popupdict-userscript.js'),
  nom: path.join(__dirname, 'build-nom-userscript.js')
};

/** @param {string[]} argv */
function parseArgs(argv) {
  const options = {popup: null, nom: null, runs: 3, only: null, json: false, require: false};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      const next = argv[++i];
      if (next === undefined) throw new Error(`${arg} needs a value`);
      return next;
    };
    if (arg === '--json') options.json = true;
    else if (arg === '--require') options.require = true;
    else if (arg === '--popup') options.popup = value();
    else if (arg === '--nom') options.nom = value();
    else if (arg === '--runs') options.runs = Number(value());
    else if (arg === '--only') options.only = value();
    else if (arg.startsWith('--')) throw new Error(`unknown option ${arg}`);
    else positional.push(arg);
  }
  if (positional[0] && !options.popup) options.popup = positional[0];
  if (positional[1] && !options.nom) options.nom = positional[1];
  if (!Number.isInteger(options.runs) || options.runs < 1) throw new Error('--runs must be a positive integer');
  if (options.only && options.only !== 'popup' && options.only !== 'nom') throw new Error('--only is popup or nom');
  return options;
}

/** @param {number[]} values @returns {{median: number, min: number, max: number, runs: number} | null} */
function summarize(values) {
  const numbers = values.filter((value) => typeof value === 'number' && Number.isFinite(value));
  if (!numbers.length) return null;
  const sorted = numbers.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  return {median, min: sorted[0], max: sorted[sorted.length - 1], runs: sorted.length};
}

/** @param {Record<string, number>[]} records one object of metrics per run */
function summarizeRuns(records) {
  const names = new Set();
  records.forEach((record) => Object.keys(record).forEach((name) => names.add(name)));
  const result = {};
  for (const name of names) result[name] = summarize(records.map((record) => record[name]));
  return result;
}

/** @param {number} value */
function format(value) {
  return Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(1);
}

/** @param {Record<string, {median: number, min: number, max: number} | null>} summary */
function formatSummary(summary) {
  return Object.entries(summary).map(([name, stat]) =>
    (stat ? `${name} ${format(stat.median)} (${format(stat.min)}-${format(stat.max)})` : `${name} n/a`));
}

function loadPlaywright() {
  try {
    return require('playwright');
  } catch (error) {
    return null;
  }
}

/** Returns the userscript text, building it at its default path first when the default is missing. */
function readUserscript(kind, requested) {
  const file = requested ? path.resolve(requested) : DEFAULTS[kind];
  if (!fs.existsSync(file)) {
    if (requested) throw new Error(`${file} does not exist`);
    console.log(`building ${path.basename(file)} ...`);
    execFileSync(process.execPath, [BUILDERS[kind]], {cwd: root, stdio: 'pipe'});
  }
  return {file, source: fs.readFileSync(file, 'utf8')};
}

// --- generated pages -------------------------------------------------------------------------

const ENGLISH = 'The quick brown fox jumps over the lazy dog while the committee reviews the quarterly budget. ';
const VIETNAMESE = 'Xin chào các bạn, hôm nay chúng ta cùng nhau tìm hiểu về lịch sử và văn hóa của đất nước Việt Nam. ';

function popupPage(withFrames) {
  const frames = withFrames
    ? Array.from({length: 5}, (_, i) => `<iframe src="/frame-${i}.html" width="300" height="200"></iframe>`).join('')
    : '';
  return '<!doctype html><html><head><meta charset="utf-8"><title>perf</title></head>' +
    '<body style="margin:0;font:24px/1.4 sans-serif"><p>' + ENGLISH.repeat(3) + '</p>' +
    '<p id="vi" style="margin:20px">bạn bè ơi, chào các bạn</p>' + frames + '</body></html>';
}

function framePage() {
  return '<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;font:14px sans-serif">' +
    `<p>${ENGLISH}</p><p>${VIETNAMESE}</p></body></html>`;
}

function longVietnamesePage(paragraphs) {
  const body = [];
  for (let i = 0; i < paragraphs; i++) body.push(`<p>${VIETNAMESE}Đoạn ${i + 1}.</p>`);
  return '<!doctype html><html><head><meta charset="utf-8"><title>perf</title></head>' +
    `<body style="font:16px/1.5 sans-serif">${body.join('')}</body></html>`;
}

// Installed in every frame before the page's own scripts, so long tasks during injection are kept.
const OBSERVER_SCRIPT = `(function() {
  window.__zdLong = [];
  try {
    new PerformanceObserver(function(list) {
      list.getEntries().forEach(function(entry) { window.__zdLong.push([entry.startTime, entry.duration]); });
    }).observe({type: 'longtask', buffered: true});
  } catch (error) { /* longtask unsupported */ }
})();`;

const MUTATION_SCRIPT = `(function() {
  // Event-loop heartbeat: the largest gap between two ticks is how long the page was unresponsive,
  // including rendering work that the longtask API does not report.
  window.__zdMaxGap = 0;
  var last = performance.now();
  setInterval(function() {
    var tick = performance.now();
    if (tick - last > window.__zdMaxGap) window.__zdMaxGap = tick - last;
    last = tick;
  }, 4);
  window.__zdLastMutation = performance.now();
  new MutationObserver(function() { window.__zdLastMutation = performance.now(); })
    .observe(document.body, {childList: true, subtree: true, characterData: true, attributes: true});
})();`;

// --- measurement helpers ---------------------------------------------------------------------

async function newMeasuredPage(browser, pages) {
  const context = await browser.newContext({viewport: {width: 1000, height: 700}});
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(OBSERVER_SCRIPT);
  await page.route(`${ORIGIN}/**`, (route) => {
    const name = new URL(route.request().url()).pathname;
    const body = pages[name];
    if (body === undefined) return route.fulfill({status: 404, body: 'not found'});
    return route.fulfill({status: 200, contentType: 'text/html; charset=utf-8', body});
  });
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  return {context, page, cdp, errors};
}

async function heapMB(cdp) {
  await cdp.send('HeapProfiler.collectGarbage');
  await cdp.send('HeapProfiler.collectGarbage');
  const usage = await cdp.send('Runtime.getHeapUsage');
  return usage.usedSize / 1048576;
}

async function taskSeconds(cdp) {
  const {metrics} = await cdp.send('Performance.getMetrics');
  const entry = metrics.find((metric) => metric.name === 'TaskDuration');
  return entry ? entry.value : 0;
}

/** Longest long task (ms) that started at or after `since` (page time), 0 when none. */
async function longestLongTask(page, since) {
  return page.evaluate((from) => window.__zdLong.reduce((max, [start, duration]) =>
    (start >= from && duration > max ? duration : max), 0), since);
}

const now = (page) => page.evaluate(() => performance.now());

// Hands the source to a frame without running it, so that its transfer is not part of any measure.
function stageSource(frame, source) {
  return frame.evaluate((text) => { window.__zdSource = text; }, GM_SHIM + source);
}

// Runs the staged source as an inline script (what a userscript manager does) and returns the
// milliseconds the insertion took inside the page: compile plus the synchronous top-level run.
function runStagedSource(frame) {
  return frame.evaluate(() => {
    const script = document.createElement('script');
    script.textContent = window.__zdSource;
    window.__zdSource = null;
    const started = performance.now();
    document.head.appendChild(script);
    const elapsed = performance.now() - started;
    script.remove(); // the element would otherwise keep a second copy of the source alive
    return elapsed;
  });
}

async function movePointer(page, x, y) {
  // Two steps, so a handler that coalesces per animation frame sees a real move.
  await page.mouse.move(x - 12, y - 3);
  await page.mouse.move(x, y);
}

async function waitForPopup(page, timeout) {
  const started = Date.now();
  const shown = await page.waitForFunction(() => {
    const popup = document.getElementById('zoopdog-userscript-popup');
    if (!popup) return false;
    const box = popup.getBoundingClientRect();
    return box.width > 0 && box.height > 0 && getComputedStyle(popup).display !== 'none' &&
      (popup.textContent || '').trim().length > 0;
  }, null, {timeout, polling: 'raf'}).then(() => true, () => false);
  return shown ? Date.now() - started : null;
}

/**
 * One popup run. `withFrames`: five 300x200 same-origin iframes. `warm`: before hovering the word the
 * pointer moves over blank space and the page idles, which is what lets the idle pre-warm run.
 */
async function measurePopup(browser, source, {withFrames, warm}) {
  const pages = {'/page.html': popupPage(withFrames)};
  for (let i = 0; i < 5; i++) pages[`/frame-${i}.html`] = framePage();
  const {context, page, cdp, errors} = await newMeasuredPage(browser, pages);
  const record = {};
  try {
    await page.goto(`${ORIGIN}/page.html`, {waitUntil: 'load'});
    await page.waitForTimeout(500);
    const heapBefore = await heapMB(cdp);
    for (const frame of page.frames()) await stageSource(frame, source);
    await page.waitForTimeout(500);
    const tasksBefore = await taskSeconds(cdp);
    const injectedAt = await now(page);

    let evalMs = 0;
    for (const frame of page.frames()) evalMs += await runStagedSource(frame);
    await page.waitForTimeout(400);
    record.evalMs = evalMs;
    record.loadLongTaskMs = await longestLongTask(page, injectedAt);
    record.loadTaskMs = ((await taskSeconds(cdp)) - tasksBefore) * 1000;
    record.heapLoadMB = await heapMB(cdp);
    record.heapLoadDeltaMB = record.heapLoadMB - heapBefore;

    const box = await page.locator('#vi').boundingBox();
    if (warm) {
      const idleFrom = await now(page);
      const idleTasks = await taskSeconds(cdp);
      await movePointer(page, 900, 650);
      await page.waitForTimeout(800);
      record.idleLongTaskMs = await longestLongTask(page, idleFrom);
      record.idleTaskMs = ((await taskSeconds(cdp)) - idleTasks) * 1000;
    }
    const hoverFrom = await now(page);
    const hoverTasks = await taskSeconds(cdp);
    const hoverStarted = Date.now();
    await movePointer(page, box.x + 30, box.y + box.height / 2);
    const waited = await waitForPopup(page, 10000);
    record.latencyMs = waited === null ? null : Date.now() - hoverStarted;
    await page.waitForTimeout(300);
    record.hoverLongTaskMs = await longestLongTask(page, hoverFrom);
    record.hoverTaskMs = ((await taskSeconds(cdp)) - hoverTasks) * 1000;
    record.heapHoverMB = await heapMB(cdp);
    record.heapHoverDeltaMB = record.heapHoverMB - heapBefore;
    record.pageErrors = errors.length;
  } finally {
    await context.close();
  }
  return record;
}

async function measureNom(browser, source, paragraphs) {
  const {context, page, cdp, errors} = await newMeasuredPage(browser, {'/long.html': longVietnamesePage(paragraphs)});
  const record = {};
  try {
    await page.goto(`${ORIGIN}/long.html`, {waitUntil: 'load'});
    await page.evaluate(MUTATION_SCRIPT);
    await page.waitForTimeout(500);
    const heapBefore = await heapMB(cdp);
    await stageSource(page, source);
    await page.waitForTimeout(500);
    const tasksBefore = await taskSeconds(cdp);
    await page.evaluate(() => { window.__zdMaxGap = 0; });
    const injectedAt = await now(page);

    record.evalMs = await runStagedSource(page);

    // Quiet for 2 s after the last mutation, or give up after 90 s.
    const deadline = Date.now() + 90000;
    let lastMutation = injectedAt;
    for (;;) {
      await page.waitForTimeout(250);
      const [current, time] = await page.evaluate(() => [window.__zdLastMutation, performance.now()]);
      lastMutation = current;
      if (time - lastMutation > 2000 || Date.now() > deadline) break;
    }
    record.settleMs = Math.max(0, lastMutation - injectedAt);
    record.longTaskMs = await longestLongTask(page, injectedAt);
    record.maxGapMs = await page.evaluate(() => window.__zdMaxGap);
    record.taskMs = ((await taskSeconds(cdp)) - tasksBefore) * 1000;
    record.rubies = await page.evaluate(() => document.getElementsByTagName('ruby').length);
    record.heapMB = await heapMB(cdp);
    record.heapDeltaMB = record.heapMB - heapBefore;
    record.pageErrors = errors.length;
  } finally {
    await context.close();
  }
  return record;
}

// --- driver ----------------------------------------------------------------------------------

const POPUP_SCENARIOS = [
  {name: 'popup, plain page: load', key: 'popup-plain', options: {withFrames: false, warm: false},
    metrics: ['evalMs', 'loadLongTaskMs', 'loadTaskMs', 'heapLoadMB', 'heapLoadDeltaMB']},
  {name: 'popup, plain page: first hover', key: 'popup-plain', options: {withFrames: false, warm: false},
    metrics: ['latencyMs', 'hoverLongTaskMs', 'hoverTaskMs', 'heapHoverMB', 'heapHoverDeltaMB']},
  {name: 'popup, plain page: first hover after idle', key: 'popup-plain-warm', options: {withFrames: false, warm: true},
    metrics: ['idleLongTaskMs', 'idleTaskMs', 'latencyMs', 'hoverLongTaskMs', 'hoverTaskMs', 'heapHoverMB', 'heapHoverDeltaMB']},
  {name: 'popup, 5 iframes: load', key: 'popup-frames', options: {withFrames: true, warm: false},
    metrics: ['evalMs', 'loadLongTaskMs', 'loadTaskMs', 'heapLoadMB', 'heapLoadDeltaMB']},
  {name: 'popup, 5 iframes: first hover', key: 'popup-frames', options: {withFrames: true, warm: false},
    metrics: ['latencyMs', 'hoverLongTaskMs', 'hoverTaskMs', 'heapHoverMB', 'heapHoverDeltaMB']},
  {name: 'popup, 5 iframes: first hover after idle', key: 'popup-frames-warm', options: {withFrames: true, warm: true},
    metrics: ['idleLongTaskMs', 'idleTaskMs', 'latencyMs', 'hoverLongTaskMs', 'hoverTaskMs', 'heapHoverMB', 'heapHoverDeltaMB']}
];
const NOM_PARAGRAPHS = 3000;

async function run(options) {
  const playwright = loadPlaywright();
  if (!playwright) {
    console.log('skipped: playwright not installed (install it, or run in CI; pass --require to fail instead)');
    return options.require ? 1 : 0;
  }

  const popup = options.only === 'nom' ? null : readUserscript('popup', options.popup);
  const nom = options.only === 'popup' ? null : readUserscript('nom', options.nom);
  const browser = await playwright.chromium.launch({args: ['--js-flags=--expose-gc', '--enable-precise-memory-info']});
  const report = {
    chromium: browser.version(), runs: options.runs,
    files: {popup: popup && popup.file, nom: nom && nom.file},
    popup: {}, nom: null
  };
  try {
    if (popup) {
      const cache = new Map();
      for (const scenario of POPUP_SCENARIOS) {
        // The load and first-hover rows of one page come from the same runs.
        if (!cache.has(scenario.key)) {
          const records = [];
          for (let i = 0; i < options.runs; i++) {
            if (!options.json) process.stderr.write(`  ${scenario.key} run ${i + 1}/${options.runs}\n`);
            records.push(await measurePopup(browser, popup.source, scenario.options));
          }
          cache.set(scenario.key, records);
        }
        const summary = summarizeRuns(cache.get(scenario.key).map((record) => {
          const picked = {};
          scenario.metrics.forEach((metric) => { picked[metric] = record[metric]; });
          return picked;
        }));
        report.popup[scenario.name] = summary;
      }
    }
    if (nom) {
      const records = [];
      for (let i = 0; i < options.runs; i++) {
        if (!options.json) process.stderr.write(`  nom-ruby run ${i + 1}/${options.runs}\n`);
        records.push(await measureNom(browser, nom.source, NOM_PARAGRAPHS));
      }
      report.nom = summarizeRuns(records);
    }
  } finally {
    await browser.close();
  }

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`Chromium ${report.chromium}, ${options.runs} run(s) per row; each cell is median (min-max)`);
    if (popup) console.log(`popup userscript: ${popup.file}`);
    if (nom) console.log(`nom-ruby userscript: ${nom.file}`);
    for (const [name, summary] of Object.entries(report.popup)) {
      console.log(`\n${name}`);
      formatSummary(summary).forEach((line) => console.log(`  ${line}`));
    }
    if (report.nom) {
      console.log(`\nnom-ruby, ${NOM_PARAGRAPHS} Vietnamese paragraphs`);
      formatSummary(report.nom).forEach((line) => console.log(`  ${line}`));
    }
  }
  return 0;
}

module.exports = {parseArgs, summarize, summarizeRuns, formatSummary, run};

if (require.main === module) {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
  run(options).then((code) => { process.exitCode = code; }, (error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
