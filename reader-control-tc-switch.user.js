// ==UserScript==
// @name        Reader Control: TC Switch Bridge
// @description Lets the reader control page (/control) flip the "繁簡自由切換"
// @description userscript's storage without visiting greasyfork.org -- see the
// @description comment below for why this has to be a separate script.
// @author      Zoopdog Contributors
// @namespace   https://github.com/tabidots/zoopdog
// @match       *://*:8770/control
// @grant       GM_setValue
// @grant       GM_getValue
// @run-at      document-start
// @version     2026.09.22.1
// @updateURL   file:///Users/cheng/mine/zoopdog/reader-control-tc-switch.user.js
// @downloadURL file:///Users/cheng/mine/zoopdog/reader-control-tc-switch.user.js
// ==/UserScript==

// Why this script exists, rather than control.html calling GM_setValue itself:
//
// GM_setValue/GM_getValue are only ever handed by the userscript manager (Stay,
// on iOS Safari) to a script IT has registered and granted -- never to an
// ordinary page's own inline <script>. control.html is served by the reader's
// own HTTP server; it is not a registered userscript, so no code running as
// part of that page's own <script> tag can ever see GM_setValue, no matter
// what that code does. This file is the fix: a second, minimal script Stay
// *does* register (via @match above), so the GM_setValue call below runs with
// real grants, inside a script Stay trusts -- the same shape of privilege the
// "繁簡自由切換" script itself has when it draws its own settings panel on
// greasyfork.org/scripts/24300-... (gated there on `location.host ==
// 'greasyfork.org'`, which page JS cannot spoof -- see that script's own
// source, `inConfigPage`).
//
// What is NOT yet verified: whether Stay's GM_setValue storage is shared by
// key name across every registered script, or namespaced per-script the way
// Tampermonkey's is. If it is namespaced, `GM_setValue('auto', ...)` here
// writes into *this* script's own private bucket and the "繁簡自由切換"
// script's `GM_getValue('auto', ...)` never sees it -- only a real on-device
// try (install this, press the button on /control, then check whether
// switching actually changed) answers that; there is no way to check it from
// outside Safari.
(function () {
  'use strict';

  const DONE_EVENT = 'tc-switch-done';
  const ERROR_EVENT = 'tc-switch-error';

  window.addEventListener('tc-switch-apply', () => {
    try {
      if (typeof GM_setValue !== 'function') {
        window.dispatchEvent(new CustomEvent(ERROR_EVENT, {
          detail: { message: 'GM_setValue not granted to this script by the userscript manager' },
        }));
        return;
      }
      // Same two keys, same meaning, as "繁簡自由切換"'s own save handler:
      // `auto` = 總是自動切換 (always auto-switch), `isSimple` = default
      // language is Simplified when true -- so Traditional is isSimple=false.
      GM_setValue('auto', true);
      GM_setValue('isSimple', false);
      window.dispatchEvent(new CustomEvent(DONE_EVENT, {
        detail: { auto: true, traditional: true },
      }));
    } catch (error) {
      window.dispatchEvent(new CustomEvent(ERROR_EVENT, {
        detail: { message: String((error && error.message) || error) },
      }));
    }
  });
})();
