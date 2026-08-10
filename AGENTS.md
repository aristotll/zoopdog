# AGENTS.md

## Communication

- Always reply to the user in Vietnamese (`vi`) by default.
- Use another language only when the user explicitly asks for it.
- Keep implementation notes, final summaries, and status updates in Vietnamese unless instructed otherwise.

## Local Rules

- At the start of a session, also read and follow any project-specific rules in `.claude/no-autoload-rules/*.md` when that directory exists.
- These local rules supplement this `AGENTS.md`; if they conflict, ask the user before proceeding unless the newer user instruction clearly resolves the conflict.

## Project Overview

Zoopdog is a static website plus a Chrome extension for a Vietnamese-English popup dictionary and Vietnamese pronunciation tools.

The repository intentionally tracks generated assets:

- Root website pages are authored in `*.jade` and committed as matching `*.html` files.
- Root styles are authored in `css/*.styl` and committed as matching `css/*.css` files.
- Extension pages/styles follow the same pattern under `zd-extension/`.
- Extension runtime code lives in `zd-extension/js/`; website JavaScript lives in `js/`.

There is no `package.json` and no npm dependency in this repo; do not assume npm scripts exist. Maintenance tasks run through the dependency-free `Makefile`, and the Chu Nom entry workflow has a `node:test` suite:

```sh
make verify
node --test test/*.test.js
```

`make verify` runs every suite under `test/` and syntax-checks every file under `scripts/`, including the extracted userscript runtime.

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
- `scripts/merge-mdx-nom-into-vnedict2.js`: merges extracted MDX Chu Nom/CJK mappings into `zd-extension/db_src/vnedict2.json` and removes duplicate definitions.
- `scripts/build-popupdict-userscript.js`: generator for the standalone popup dictionary userscript.
- `scripts/build-nom-userscript.js`: generator for the standalone Chu Nom ruby userscript.
- `zd-extension/db_src/mdx_nom.json`: generated supplemental Chu Nom/CJK mappings extracted from the external Vietnamese-Chinese MDX dictionary.
- `zd-extension/db_src/user_nom_entries.jsonc`: hand-maintained user Chu Nom/CJK entries shared by the Nom ruby and popup dictionary userscript generators.
- `scripts/lib/`: shared primitives for every script — text normalization, CJK patterns and candidate extraction, repository path constants, JSON/JSONC source helpers, and userscript assembly. Each primitive is defined here once; scripts import rather than redefine them.
- `scripts/userscript/`: the browser runtime and CSS embedded in the generated userscripts, stored as real source files. **Edit the userscript runtime here, never inside `scripts/build-*.js`**, then rebuild. The builders substitute `__ZOOPDOG_*__` placeholders and fail if any is missing or repeated.
- `scripts/add-chu-nom.js`: CLI entry point for the deterministic Chu Nom entry workflow; parses arguments and dispatches `plan`/`apply`.
- `scripts/add-chu-nom/`: the workflow's modules — input parsing, local-source resolution, planning, manifest validation, JSONC editing, and the apply transaction.
- `test/*.test.js`: `node:test` suites covering the Chu Nom workflow, the shared script library, the MDX extract/merge transforms, and the `scripts/` structure contracts (no duplicated primitives, no side effects on import, byte-identical generated output).
- `Makefile`: dependency-free entry points for planning, approved apply, userscript rebuilds, and verification.
- `.codex/commands/add-chu-nom.md`: the sole canonical `/add-chu-nom` agent workflow. It provides the conversational review layer only — `scripts/add-chu-nom.js` performs every dictionary, input-file, and generated-file write. `.claude/commands/add-chu-nom.md` is a pointer to it and must not duplicate the instructions.
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

The generated `zoopdog-popupdict.user.js` embeds dictionary data from `zd-extension/db_src/vnedict2.json`, user Chu Nom entries from `zd-extension/db_src/user_nom_entries.jsonc`, and pronunciation rendering code from `zd-extension/js/zd-pron-*.js`.

To regenerate the standalone Chu Nom ruby userscript:

```sh
node scripts/build-nom-userscript.js
```

The generated `zoopdog-nom-ruby.user.js` embeds a compact lookup table from `zd-extension/db_src/vnedict2.json` plus `zd-extension/db_src/mdx_nom.json` and `zd-extension/db_src/user_nom_entries.jsonc` when those supplemental files exist. Edit the generator or source JSON/JSONC, not the embedded map by hand.

To regenerate `zd-extension/db_src/mdx_nom.json` from an external MDX dictionary, install `js-mdict` outside the repo and expose it via `NODE_PATH`, for example:

```sh
tmp=$(mktemp -d /tmp/mdx-extract.XXXXXX)
cd "$tmp" && npm init -y >/dev/null && npm install js-mdict@6.0.6 >/dev/null
NODE_PATH="$tmp/node_modules" node /Users/Yao/Mine/JavaScript/zoopdog/scripts/extract-mdx-nom-data.js "/path/to/dict.mdx"
```

The extractor intentionally keeps only real Unicode CJK/Nom code points and skips private-use glyphs from MDX font encodings.

After regenerating `zd-extension/db_src/mdx_nom.json`, merge it into `vnedict2.json` before rebuilding userscripts:

```sh
node scripts/merge-mdx-nom-into-vnedict2.js
node scripts/build-nom-userscript.js
node scripts/build-popupdict-userscript.js
```

To add hand-maintained Chu Nom/CJK entries, use the Codex command:

```text
/add-chu-nom tiếng Anh
```

The command is the conversational review layer only. `scripts/add-chu-nom.js` does all the work in two phases and is the only writer:

```sh
node scripts/add-chu-nom.js plan --file .idea/newfile.md --manifest "$manifest"
node scripts/add-chu-nom.js apply --manifest "$manifest" --approve
```

`plan` is read-only: it accepts inline words or a file mention, defaults to `.idea/newfile.md`, preprocesses no-diacritic or lightly mistyped input, and writes a reviewable JSON manifest. After the user approves the reviewed manifest, `apply` upserts `zd-extension/db_src/user_nom_entries.jsonc`, removes the applied input items, rebuilds both userscripts through their builders, verifies the generated embeds, and restores every file it owns if any step fails. Never edit the dictionary data, the input queue, or the generated userscripts by hand for this workflow, and never run `apply` before explicit approval.

The same operations are available through Make:

```sh
make add-chu-nom-plan INPUT=.idea/newfile.md MANIFEST=/path/to/manifest.json
make import-chu-nom MANIFEST=/path/to/reviewed.json
```

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
