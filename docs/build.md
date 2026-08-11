# Build and Verification

The repository has no `package.json` and pins no build dependencies. Maintenance tasks run
through the dependency-free `Makefile`; page and style compilation needs `pug` and `stylus`
installed on the machine.

## Verification

```sh
make verify
```

`make verify` runs every suite under `test/` and syntax-checks every file under `scripts/`,
including the extracted userscript runtime. The test command on its own:

```sh
node --test test/*.test.js
```

## Compiling sources

Root pages are authored in `*.jade` and committed as matching `*.html`; root styles are
authored in `css/*.styl` and committed as matching `css/*.css`. Extension pages and styles
follow the same pattern under `zd-extension/`.

Website pages:

```sh
pug index.jade popupdict.jade pronunciation.jade homophones.jade pronguide.jade
```

Extension pages, with pretty output:

```sh
pug -P zd-extension/frame.jade zd-extension/popup.jade
```

Website styles:

```sh
stylus css/style.styl css/pronunciation.styl
```

Extension styles:

```sh
stylus zd-extension/css/zoopdog.styl zd-extension/css/zoopdog-frame.styl zd-extension/css/zd-pron.styl
```

If these CLIs are missing, say so in the final response. Hand-edit generated output only when
the change is small enough to keep the source and the generated file consistent, and commit
both together.

## Rebuilding the userscripts

```sh
make rebuild-userscripts
```

See [dictionary-data.md](dictionary-data.md) for what each userscript embeds and when a
rebuild is required.

## Manual verification

Website changes:

- Open the affected root HTML file directly in a browser.
- Check hover popup behaviour on `popupdict.html`.
- Check pronunciation and homophone output on `pronunciation.html`, `homophones.html`, and
  `pronguide.html` when relevant.

Extension changes:

- Open Chrome extension management and load `zd-extension/` as an unpacked extension.
- Verify install/update initializes IndexedDB from `zd-extension/js/vnedict.json`.
- Test popup lookup on a normal webpage, global enable/disable, the lock toggle, and dialect
  selection when affected.

Userscript changes:

- Install the rebuilt userscript and verify word detection and popup lookup on a normal page.
