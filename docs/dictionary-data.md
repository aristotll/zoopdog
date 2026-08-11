# Dictionary Data

Dictionary source data lives under `zd-extension/db_src/`.

## Extension runtime dictionary

To regenerate `zd-extension/db_src/vnedict.json`:

```sh
cd zd-extension/db_src
python3 make_dict.py
```

The extension reads `zd-extension/js/vnedict.json`. When dictionary data changes, check whether
the regenerated JSON also needs to be copied or transformed into that runtime file.

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
make rebuild-userscripts
```

## Hand-maintained Chu Nom entries

Use the `/add-chu-nom` command. `.codex/commands/add-chu-nom.md` is the canonical workflow
document; `scripts/add-chu-nom.js` is the only writer. Never edit the dictionary data, the
input queue, or the generated userscripts by hand for this workflow.
