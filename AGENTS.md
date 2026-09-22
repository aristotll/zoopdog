# AGENTS.md

## Communication

- Always reply to the user in Vietnamese (`vi`) by default.
- Use another language only when the user explicitly asks for it.
- Keep implementation notes, final summaries, and status updates in Vietnamese unless
  instructed otherwise.

## Project Overview

Zoopdog is a static website plus a Chrome extension for a Vietnamese-English popup dictionary
and Vietnamese pronunciation tools, along with two standalone userscripts generated from the
same data.

The repository intentionally tracks generated assets: `*.jade` compiles to a committed
`*.html` and `css/*.styl` compiles to a committed `css/*.css`. The github-hosted userscripts
(`zoopdog-*.user.js`) are built from `zd-extension/db_src/` and `scripts/userscript/` but are
**not committed**: they are gitignored, minified into `dist/` by esbuild, and published as
GitHub Release assets (`make release-userscripts`). Edit the source, then rebuild.

`package.json` exists only for the build-time devDependency `esbuild` (run `npm install` once);
there are no runtime dependencies, and the shipped browser code is still plain JavaScript.
Verify with:

```sh
make verify
```

## Where Things Live

| Path | What it holds |
| --- | --- |
| `*.jade`, `*.html` | Website pages; `includes.jade` and `meta.jade` are shared markup |
| `css/` | Website styles, `*.styl` compiled to `*.css` |
| `js/` | Website behaviour |
| `zd-extension/` | Chrome extension, Manifest V3; pages, styles, and `js/` runtime |
| `zd-extension/js/zd-words.js` | Shared Vietnamese word primitives — one definition, used by the extension, the website, and the popup userscript |
| `zd-extension/js/zd-nom-match.js` | Shared Chu Nom matching engine — one definition, inlined into the nom-ruby userscript and required by `scripts/nom-inspect.js`/tests |
| `zd-extension/db_src/` | Dictionary sources, including the hand-maintained `user_nom_entries.jsonc` |
| `scripts/lib/` | Shared primitives for scripts; defined once, imported never redefined |
| `scripts/userscript/` | The browser runtime and CSS embedded in the generated userscripts |
| `scripts/add-chu-nom.js`, `scripts/add-chu-nom/` | The deterministic Chu Nom entry workflow |
| `scripts/check-openspec-lifecycle.js` | OpenSpec lifecycle check; `make check-openspec` |
| `openspec/changes/` | Active change proposals; `openspec/changes/archive/` holds finished ones |
| `openspec/specs/` | Canonical capability specs, written by promoting a change's spec deltas |
| `test/` | `node:test` suites, including structural contracts |
| `Makefile` | Every maintenance entry point |
| `docs/` | Build, dictionary-data, and historical notes |

## Editing Rules

- Edit source before generated output: `.jade` before `.html`, `.styl` before `.css`, and
  `scripts/userscript/` before the generated `*.user.js`.
- If a generated file is affected, update and commit it too.
- Preserve the existing lightweight style: plain JavaScript, no bundler, no transpilation, no
  framework.
- Keep third-party minified libraries in `js/lib/` and `zd-extension/js/lib/` intact unless
  explicitly upgrading them.
- Avoid broad rewrites. This is old, browser-facing code with checked-in generated outputs, so
  small targeted changes are safer.
- Preserve Vietnamese text and diacritics exactly when touching dictionary, pronunciation, or
  UI copy.
- Do not delete `zd-extension.zip` or binary/image/font assets unless the task explicitly asks
  for asset cleanup.

## Detailed Procedures

Each of these owns its subject; this file does not repeat them.

- Build commands, compilation, and manual verification: [`docs/build.md`](docs/build.md)
- Dictionary regeneration, MDX extraction, userscript rebuilds:
  [`docs/dictionary-data.md`](docs/dictionary-data.md)
- Adding hand-maintained Chu Nom entries — the `/add-chu-nom` workflow, its review loop, and
  its linguistic rules: [`.codex/commands/add-chu-nom.md`](.codex/commands/add-chu-nom.md).
  This is the sole canonical description; `.claude/commands/add-chu-nom.md` is a pointer to it.
- Why the Chu Nom workflow enforces what it does:
  [`docs/history/chu-nom-lessons.md`](docs/history/chu-nom-lessons.md)
- The popup userscript's local mode (talking to the `book-translator` reader server to add
  Chữ Nôm entries / set rendering order from any page): [`docs/local-mode.md`](docs/local-mode.md)
- Checking what the nom-ruby userscript would annotate, or what the popup dictionary would
  show for a term, locally and without a browser: [`docs/nom-validation.md`](docs/nom-validation.md)

## Git Hygiene

- Check `git status --short` before editing and before the final response.
- Do not revert unrelated user changes.
- **Never run `git checkout --`, `git stash`, or any other discard on
  `zd-extension/db_src/user_nom_entries/**` (or its generated downstream: `zoopdog-*.user.js`,
  `zd-extension/js/vnedict.json`) because it looked unexpectedly modified during a test run.**
  This repository's working directory is routinely shared with other concurrent Claude sessions
  (interactive or background) editing the hand-maintained Chu Nom shard store live, typically
  through `/add-chu-nom`. An unexpected diff there during your own work is very likely someone
  else's in-progress edit, not pollution from your own process — discarding it destroys their
  work. If a test fails because of dictionary-derived content, rebuild the generated artifact
  (`make rebuild-userscripts`, `make rebuild-extension-vnedict-json`) to catch up to current
  data instead of reverting anything, or just leave it and rerun later. This has caused real
  data loss before — treat it as a hard rule, not a judgment call.
- Keep commits scoped: source edits plus their generated artifacts belong together.
- Mention any build or verification commands that could not be run because local tooling is
  missing.
