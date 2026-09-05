# Dictionary Data

Dictionary source data lives under `zd-extension/db_src/`.

## Extension runtime dictionary

To regenerate `zd-extension/db_src/vnedict.json`:

```sh
cd zd-extension/db_src
python3 make_dict.py
```

The extension and website read the actively maintained `zd-extension/db_src/vnedict2.json`
through generated runtime files. Rebuild them after any merge or hand-maintained Chu Nom apply:

```sh
make rebuild-extension-vnedict-json
```

The target folds in the hand-maintained `zd-extension/db_src/user_nom_entries.jsonc` the same
way both userscript builders do -- renderings lead a term's definitions, explanations follow
its glosses -- and then applies `user_nom_order.jsonc`. Without that fold an entry added by
`/add-chu-nom` reaches the two userscripts and stays invisible in the extension, which reads
only this generated file.

Hoisting from `user_nom_order.jsonc` moves whole rows. A dictionary row can carry several
renderings as one grouped cell (`巴|芭|𠀧|爸`); such a row is matched and hoisted, but the
group's interior is never rewritten, so a surface showing only the first rendering still shows
`巴`. To lead with a rendering trapped mid-group, give it its own row in
`user_nom_entries.jsonc`.

The target writes compact `zd-extension/js/vnedict.json` and
`zd-extension/js/vnedict.meta.json`. The sidecar records the exact JSON byte hash and entry
count used to refresh browser IndexedDB safely. Both files are generated and must be committed
together; never copy either one by hand.

## Userscripts

```sh
node scripts/build-popupdict-userscript.js
node scripts/build-nom-userscript.js
```

`zoopdog-popupdict.user.js` embeds dictionary data from `zd-extension/db_src/vnedict2.json`,
user Chu Nom entries from `zd-extension/db_src/user_nom_entries.jsonc`, the shared word
primitives from `zd-extension/js/zd-words.js`, and pronunciation rendering code from
`zd-extension/js/zd-pron-*.js`.

`zoopdog-nom-ruby.user.js` embeds a compact lookup table from `vnedict2.json` plus
`mdx_nom.json` and `user_nom_entries.jsonc` when those supplemental files exist.

Edit the generator or the source JSON/JSONC, never the embedded map by hand. The browser
runtime lives in `scripts/userscript/` as real source files — edit it there, not inside
`scripts/build-*.js`, then rebuild.

### Version stamps and auto-update

Both headers carry `@updateURL` and `@downloadURL` pointing at the file's `master` raw URL on
GitHub, so an installed copy updates itself once the rebuilt file is pushed. Tampermonkey only
downloads an update when the served `@version` is greater, so the builders stamp the version
themselves:

- The stamp is the build date, `YYYY.MM.DD`; a second content change on the same date appends a
  counter (`2026.09.05.1`).
- The stamp moves only when the rest of the file changes. A rebuild against unchanged data
  rewrites the same bytes, so the committed userscripts stay out of `git status`.
- Do not edit `@version` by hand in `scripts/userscript/*.runtime.js`; the header holds the
  `__ZOOPDOG_VERSION__` placeholder and the builder fills it in.

A rebuilt userscript only reaches installed copies after it is pushed to `master`. To pull it
immediately instead of waiting for Tampermonkey's update interval, use its dashboard:
**Utilities → Check for userscript updates**.

## Supplemental MDX data

To regenerate `zd-extension/db_src/mdx_nom.json` from an external MDX dictionary, install
`js-mdict` outside the repository and expose it through `NODE_PATH`:

```sh
tmp=$(mktemp -d /tmp/mdx-extract.XXXXXX)
cd "$tmp" && npm init -y >/dev/null && npm install js-mdict@6.0.6 >/dev/null
NODE_PATH="$tmp/node_modules" node /path/to/zoopdog/scripts/extract-mdx-nom-data.js "/path/to/dict.mdx"
```

The extractor keeps only real Unicode CJK/Nom code points and skips private-use glyphs from
MDX font encodings.

After regenerating, merge before rebuilding:

```sh
node scripts/merge-mdx-nom-into-vnedict2.js
make rebuild-extension-vnedict-json
make rebuild-userscripts
```

## Hand-maintained Chu Nom entries

Use the `/add-chu-nom` command. `.codex/commands/add-chu-nom.md` is the canonical workflow
document; `scripts/add-chu-nom.js` is the only writer. Never edit the dictionary data, the
input queue, or the generated userscripts by hand for this workflow.
