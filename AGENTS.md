# AGENTS.md

## Project Overview

Zoopdog is a static website plus a Chrome extension for a Vietnamese-English popup dictionary and Vietnamese pronunciation tools.

The repository intentionally tracks generated assets:

- Root website pages are authored in `*.jade` and committed as matching `*.html` files.
- Root styles are authored in `css/*.styl` and committed as matching `css/*.css` files.
- Extension pages/styles follow the same pattern under `zd-extension/`.
- Extension runtime code lives in `zd-extension/js/`; website JavaScript lives in `js/`.

There is no `package.json`, task runner, or test framework in this repo. Do not assume npm scripts exist.

## Important Paths

- `index.jade`, `popupdict.jade`, `pronunciation.jade`, `homophones.jade`, `pronguide.jade`: source pages for the website.
- `includes.jade`, `meta.jade`: shared website markup.
- `css/style.styl`, `css/pronunciation.styl`, `css/colors.styl`: website styles.
- `js/popupdict.js`, `js/zd-pron.js`: website behavior.
- `zd-extension/manifest.json`: Chrome extension manifest, currently Manifest V3.
- `zd-extension/frame.jade`, `zd-extension/popup.jade`: extension HTML sources.
- `zd-extension/css/*.styl`: extension style sources.
- `zd-extension/js/background.js`: service worker and dictionary DB setup.
- `zd-extension/js/content.js`, `zd-extension/js/showframe.js`, `zd-extension/js/highlighter.js`, `zd-extension/js/frame.js`, `zd-extension/js/popup.js`: extension UI/content behavior.
- `zd-extension/db_src/make_dict.py`: dictionary source conversion helper.
- `scripts/extract-mdx-nom-data.js`: extracts Vietnamese-to-Chu-Nom/CJK mappings from an external MDX dictionary into JSON.
- `scripts/build-popupdict-userscript.js`: generator for the standalone popup dictionary userscript.
- `scripts/build-nom-userscript.js`: generator for the standalone Chu Nom ruby userscript.
- `zd-extension/db_src/mdx_nom.json`: generated supplemental Chu Nom/CJK mappings extracted from the external Vietnamese-Chinese MDX dictionary.
- `zoopdog-popupdict.user.js`: generated userscript that ports the extension popup/highlight/pronunciation behavior without Chrome extension APIs.
- `zoopdog-nom-ruby.user.js`: generated userscript with embedded dictionary data from `zd-extension/db_src/vnedict2.json`.

## Editing Rules

- Prefer editing source files first:
  - Edit `.jade` before regenerated `.html`.
  - Edit `.styl` before regenerated `.css`.
- If a generated HTML/CSS file is affected, update and commit the generated artifact too.
- Preserve the existing lightweight style: plain JavaScript, no module bundler, no transpilation, no framework.
- Keep third-party minified libraries in `js/lib/` and `zd-extension/js/lib/` intact unless explicitly upgrading them.
- Avoid broad rewrites. This project is old, browser-facing code with checked-in generated outputs, so small targeted changes are safer.
- Preserve Vietnamese text and diacritics exactly when touching dictionary, pronunciation, or UI copy.
- Do not delete `zd-extension.zip` or binary/image/font assets unless the task explicitly asks for asset cleanup.

## Build Commands

The repo does not pin build dependencies. If the local machine has compatible CLIs installed, use commands like these from the repo root.

Compile website Jade sources:

```sh
pug index.jade popupdict.jade pronunciation.jade homophones.jade pronguide.jade
```

Compile extension Jade sources with pretty output:

```sh
pug -P zd-extension/frame.jade zd-extension/popup.jade
```

Compile website Stylus sources:

```sh
stylus css/style.styl css/pronunciation.styl
```

Compile extension Stylus sources:

```sh
stylus zd-extension/css/zoopdog.styl zd-extension/css/zoopdog-frame.styl zd-extension/css/zd-pron.styl
```

If these CLIs are missing, note that in the final response and avoid hand-editing generated output unless the change is intentionally limited and source/generated files can be kept consistent.

## Dictionary Data

Dictionary source data is under `zd-extension/db_src/`.

To regenerate `zd-extension/db_src/vnedict.json`:

```sh
cd zd-extension/db_src
python3 make_dict.py
```

The extension reads `zd-extension/js/vnedict.json`. If dictionary data is changed, verify whether the regenerated JSON should also be copied or transformed into that runtime file.

To regenerate the standalone popup dictionary userscript:

```sh
node scripts/build-popupdict-userscript.js
```

The generated `zoopdog-popupdict.user.js` embeds dictionary data from `zd-extension/js/vnedict.json` and pronunciation rendering code from `zd-extension/js/zd-pron-*.js`.

To regenerate the standalone Chu Nom ruby userscript:

```sh
node scripts/build-nom-userscript.js
```

The generated `zoopdog-nom-ruby.user.js` embeds a compact lookup table from `zd-extension/db_src/vnedict2.json` plus `zd-extension/db_src/mdx_nom.json` when that supplemental file exists. Edit the generator or source JSON, not the embedded map by hand.

To regenerate `zd-extension/db_src/mdx_nom.json` from an external MDX dictionary, install `js-mdict` outside the repo and expose it via `NODE_PATH`, for example:

```sh
tmp=$(mktemp -d /tmp/mdx-extract.XXXXXX)
cd "$tmp" && npm init -y >/dev/null && npm install js-mdict@6.0.6 >/dev/null
NODE_PATH="$tmp/node_modules" node /Users/Yao/Mine/JavaScript/zoopdog/scripts/extract-mdx-nom-data.js "/path/to/dict.mdx"
```

The extractor intentionally keeps only real Unicode CJK/Nom code points and skips private-use glyphs from MDX font encodings.

## Manual Verification

For website changes:

- Open the affected root HTML file directly in a browser.
- Check hover popup behavior on `popupdict.html`.
- Check pronunciation and homophone output on `pronunciation.html`, `homophones.html`, and `pronguide.html` when relevant.

For extension changes:

- Open Chrome extension management.
- Load `zd-extension/` as an unpacked extension.
- Verify install/update initializes IndexedDB from `zd-extension/js/vnedict.json`.
- Test popup lookup on a normal webpage, global enable/disable, lock toggle, and dialect selection when affected.

## Git Hygiene

- Check `git status --short` before editing and before the final response.
- Do not revert unrelated user changes.
- Keep commits scoped: source edits plus their generated artifacts belong together.
- Mention any build or verification commands that could not be run because local tooling is missing.
