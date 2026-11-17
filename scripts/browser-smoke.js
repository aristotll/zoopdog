#!/usr/bin/env node
'use strict';

// Browser smoke test: loads the website and the built userscripts into a real Chromium (through
// Playwright) and checks the paths a DOM harness cannot -- that pages run without uncaught errors,
// that the popup shows on hover, and that nom-ruby annotates text. It is not part of
// `make verify`; run it with `make browser-smoke`. Playwright is not a dependency of this
// repository: it is resolved from the environment (a global install, or `npm install --no-save
// playwright` in CI). Without it the script prints "skipped" and exits 0, unless `--require` is
// given.
//
// What it builds: the website's runtime dictionary (gitignored zd-extension/js/vnedict*.json, as
// `make rebuild-extension-vnedict-json` does). The userscripts are rendered in memory with the
// real builders and a tiny stub dictionary, so no root `zoopdog-*.user.js` is needed or written.

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const {execFileSync} = require('node:child_process');

const root = path.resolve(__dirname, '..');
const requireBrowser = process.argv.includes('--require');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.eot': 'application/vnd.ms-fontobject'
};

// The site is served from a random local port; fonts requested by the sandboxed popup frame fail
// CORS there (the frame has an opaque origin), which is a property of serving locally.
const IGNORED_CONSOLE = /font|CORS|Access-Control-Allow-Origin|net::ERR_FAILED/i;

function loadPlaywright() {
  try {
    return require('playwright');
  } catch (error) {
    return null;
  }
}

function serveRepo() {
  const server = http.createServer((request, response) => {
    let relative;
    try {
      relative = decodeURIComponent(new URL(request.url, 'http://localhost').pathname).replace(/^\/+/, '') || 'index.html';
    } catch (error) {
      response.writeHead(400).end();
      return;
    }
    const file = path.resolve(root, relative);
    if (request.method !== 'GET' || (file !== root && !file.startsWith(root + path.sep)) ||
        /(^|[\\/])(\.git|node_modules)([\\/]|$)/.test(relative)) {
      response.writeHead(403).end();
      return;
    }
    fs.readFile(file, (error, body) => {
      if (error) {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, {'Content-Type': MIME[path.extname(file)] || 'application/octet-stream'}).end(body);
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// Userscripts rendered in memory by the real builders; the dictionaries are tiny stubs.
function renderUserscripts() {
  process.env.ZOOPDOG_LOCAL_SITE_RULES = path.join(root, 'does-not-exist.json');
  const popup = require('./build-popupdict-userscript');
  const nom = require('./build-nom-userscript');
  const dictionary = {'bạn': [[['bạn'], [['friend', '']]]], 'bè': [[['bè'], [['friends', '']]]]};
  const popupVariant = popup.VARIANTS.find((variant) => !variant.localMode);
  const nomVariant = nom.VARIANTS.find((variant) => variant.targetKey === 'nomUserscript');
  return {
    popup: popup.buildUserscript(dictionary, 3, popup.readRuntimeSources(false), popupVariant),
    nom: nom.buildUserscript({'xin chào': '𠸦 / 𠳒', 'bạn': '伴'}, {}, nomVariant)
  };
}

// Same shim the userscript managers provide; the scripts are otherwise loaded as plain scripts.
const GM_SHIM = 'window.GM_addStyle=function(c){var s=document.createElement("style");' +
  's.textContent=c;document.head.appendChild(s)};';

async function main() {
  const playwright = loadPlaywright();
  if (!playwright) {
    console.log('skipped: playwright not installed (install it, or run in CI; pass --require to fail instead)');
    return requireBrowser ? 1 : 0;
  }

  console.log('building the runtime dictionary ...');
  execFileSync(process.execPath, [path.join(__dirname, 'build-extension-vnedict-json.js')], {cwd: root, stdio: 'pipe'});
  const scripts = renderUserscripts();

  const failures = [];
  const check = (name, ok, detail = '') => {
    console.log(`${ok ? 'ok    ' : 'FAILED'} ${name}${!ok && detail ? ` (${detail})` : ''}`);
    if (!ok) failures.push(name);
  };

  const server = await serveRepo();
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await playwright.chromium.launch();
  const watch = (page, errors) => {
    page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error' && !IGNORED_CONSOLE.test(message.text())) errors.push(`console: ${message.text()}`);
    });
  };
  const newPage = async () => {
    const context = await browser.newContext({viewport: {width: 1000, height: 700}});
    const page = await context.newPage();
    const errors = [];
    watch(page, errors);
    return {page, errors, context};
  };
  const hover = async (page, selector) => {
    const box = await page.locator(selector).boundingBox();
    // Move in two steps so the hover handler (coalesced per animation frame) sees a real pointer move.
    await page.mouse.move(box.x + 5, box.y + 5);
    await page.mouse.move(box.x + 20, box.y + box.height / 2);
  };

  try {
    // 1. The website pages load without uncaught errors.
    for (const name of ['index.html', 'popupdict.html', 'pronunciation.html', 'homophones.html', 'pronguide.html']) {
      const {page, errors, context} = await newPage();
      const response = await page.goto(`${base}/${name}`, {waitUntil: 'load'});
      await page.waitForTimeout(500);
      check(`${name} loads (HTTP ${response && response.status()}) with no page errors`,
        response && response.ok() && errors.length === 0, errors.join(' | '));
      await context.close();
    }

    // 2. popupdict.html: the dictionary becomes ready and the popup frame shows on hover.
    {
      const {page, errors, context} = await newPage();
      await page.goto(`${base}/popupdict.html`, {waitUntil: 'load'});
      let status = '';
      try {
        await page.waitForFunction(() => /^Dictionary (ready|refreshed)/.test(
          (document.getElementById('dictionary-status') || {}).textContent || ''), null, {timeout: 60000});
      } catch (error) { /* reported below with the last status text */ }
      status = await page.locator('#dictionary-status').textContent();
      check('popupdict.html reaches a ready dictionary status', /^Dictionary (ready|refreshed)/.test(status), status);
      // Pace reveals the sample text (and enables the pointer) once the page has finished loading.
      await page.waitForFunction(() => getComputedStyle(document.getElementById('textfield')).opacity === '1' &&
        getComputedStyle(document.getElementById('instructions')).display === 'block', null, {timeout: 30000})
        .catch(() => {});
      await page.waitForTimeout(1000);
      const box = await page.locator('#textfield').boundingBox();
      await page.mouse.move(box.x + 30, box.y + 30);
      await page.mouse.move(box.x + 60, box.y + 30);
      const shown = await page.waitForFunction(() => {
        const frame = document.getElementById('zoopdog-popup');
        return !!frame && frame.getBoundingClientRect().width > 0 && frame.getBoundingClientRect().height > 0;
      }, null, {timeout: 10000}).then(() => true, () => false);
      check('popupdict.html shows the popup frame on hover', shown);
      check('popupdict.html had no page errors', errors.length === 0, errors.join(' | '));
      await context.close();
    }

    // 3. The popup userscript on a blank page with Vietnamese text.
    {
      const {page, errors, context} = await newPage();
      await page.goto('about:blank');
      await page.setContent('<!doctype html><html><body style="font-size:28px"><p id="t" style="margin:40px">' +
        'bạn bè ơi, chào các bạn</p></body></html>');
      await page.addScriptTag({content: GM_SHIM + scripts.popup});
      await page.waitForTimeout(300);
      const before = await page.evaluate(() => !!document.getElementById('zoopdog-userscript-popup') ||
        !!document.getElementById('zoopdog-userscript-canvas'));
      check('popup userscript builds no popup UI before the first hover', before === false);
      await hover(page, '#t');
      const shown = await page.waitForFunction(() => {
        const popup = document.getElementById('zoopdog-userscript-popup');
        if (!popup) return false;
        const box = popup.getBoundingClientRect();
        return box.width > 0 && box.height > 0 && getComputedStyle(popup).display !== 'none' &&
          /friend/.test(popup.textContent || '');
      }, null, {timeout: 10000}).then(() => true, () => false);
      check('popup userscript shows the popup with the definition on hover', shown);
      check('popup userscript had no page errors', errors.length === 0, errors.join(' | '));
      await context.close();
    }

    // 4. A 10x10 iframe never builds popup UI.
    {
      const {page, errors, context} = await newPage();
      await page.goto('about:blank');
      await page.setContent('<!doctype html><html><body><iframe id="tiny" width="10" height="10" ' +
        'srcdoc="&lt;body style=&quot;margin:0;font-size:8px&quot;&gt;bạn bè&lt;/body&gt;"></iframe></body></html>');
      const frame = page.frame({url: 'about:srcdoc'}) || page.frames().find((candidate) => candidate !== page.mainFrame());
      await frame.waitForLoadState('load');
      await frame.addScriptTag({content: GM_SHIM + scripts.popup});
      const box = await page.locator('#tiny').boundingBox();
      await page.mouse.move(box.x + 2, box.y + 2);
      await page.mouse.move(box.x + 5, box.y + 5);
      await page.waitForTimeout(500);
      const built = await frame.evaluate(() => !!document.getElementById('zoopdog-userscript-popup') ||
        !!document.getElementById('zoopdog-userscript-canvas'));
      check('popup userscript builds no UI in a 10x10 iframe', built === false);
      check('10x10 iframe had no page errors', errors.length === 0, errors.join(' | '));
      await context.close();
    }

    // 5. The nom-ruby userscript annotates text, including text added later.
    {
      const {page, errors, context} = await newPage();
      await page.goto('about:blank');
      await page.setContent('<!doctype html><html><body><p id="a">Xin chào bạn</p><div id="host"></div></body></html>');
      await page.addScriptTag({content: GM_SHIM + scripts.nom});
      const annotated = await page.waitForSelector('#a ruby.zoopdog-nom-ruby', {timeout: 10000}).then(() => true, () => false);
      check('nom-ruby annotates a paragraph', annotated);
      await page.evaluate(() => {
        const p = document.createElement('p');
        p.id = 'b';
        p.textContent = 'Xin chào các bạn';
        document.getElementById('host').appendChild(p);
      });
      const later = await page.waitForSelector('#b ruby.zoopdog-nom-ruby', {timeout: 10000}).then(() => true, () => false);
      check('nom-ruby annotates text added later', later);
      const nomError = await page.evaluate(() => document.documentElement.dataset.zoopdogNomError);
      check('nom-ruby leaves dataset.zoopdogNomError unset', nomError === undefined, nomError);
      check('nom-ruby had no page errors', errors.length === 0, errors.join(' | '));
      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }

  if (failures.length) {
    console.log(`\n${failures.length} check(s) failed:\n  - ${failures.join('\n  - ')}`);
    return 1;
  }
  console.log('\nall browser smoke checks passed');
  return 0;
}

module.exports = {main};

if (require.main === module) {
  main().then((code) => { process.exitCode = code; }, (error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
