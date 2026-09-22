NODE ?= node
ARCHIVE ?=
DRY_RUN ?=
TEXT ?=
TERM ?=

.DEFAULT_GOAL := help

.PHONY: help \
	rebuild-nom-userscript rebuild-popupdict-userscript rebuild-userscripts release-userscripts minify-userscripts \
	rebuild-local-userscripts rebuild-cycle-local-userscripts \
	rebuild-extension-dict rebuild-extension-vnedict-json rebuild-realwords-lexicon nom-annotate nom-popup \
	check-openspec verify verify-scripts verify-browser

help:
	@echo "make rebuild-nom-userscript"
	@echo "make rebuild-popupdict-userscript"
	@echo "make rebuild-userscripts"
	@echo "make minify-userscripts  # minified release builds into dist/ (esbuild)"
	@echo "make release-userscripts  # publish dist/*.user.js as a GitHub Release (DRY_RUN=1 to preview)"
	@echo "make rebuild-local-userscripts  # rebuild only the (Local) userscript variants"
	@echo "make rebuild-cycle-local-userscripts  # watch user entries, rebuild (Local) on change; runs until stopped"
	@echo "make rebuild-extension-dict           # regenerate db_src/vnedict.json from db_src/vnedict.txt"
	@echo "make rebuild-extension-vnedict-json"
	@echo "make rebuild-realwords-lexicon  # regenerate zd-extension/js/realwords.js from its db_src source"
	@echo "make nom-annotate TEXT='...'  # what the nom-ruby userscript would annotate in TEXT"
	@echo "make nom-popup TERM='...'     # what the popup dictionary would show for TERM"
	@echo "make check-openspec    # report OpenSpec lifecycle state; writes nothing"
	@echo "make check-openspec ARCHIVE=1 [DRY_RUN=1]  # archive eligible changes, promote deltas"
	@echo "make verify            # tests + syntax-check maintenance and browser scripts"

rebuild-nom-userscript:
	$(NODE) scripts/build-nom-userscript.js

rebuild-popupdict-userscript:
	$(NODE) scripts/build-popupdict-userscript.js

rebuild-userscripts: rebuild-nom-userscript rebuild-popupdict-userscript

# Minifies the readable root builds into dist/ (needs `npm install` once, for esbuild).
minify-userscripts:
	$(NODE) scripts/minify-userscripts.js

# Publishes the minified builds in dist/; needs `gh`. See docs/build.md.
release-userscripts: rebuild-userscripts rebuild-extension-vnedict-json minify-userscripts
	$(NODE) scripts/release-userscripts.js $(if $(DRY_RUN),--dry-run)

# The (Local) variants are never committed (see .gitignore) and update from their own file on
# this machine, so rebuilding just them skips writing the github-hosted variants needlessly.
rebuild-local-userscripts:
	$(NODE) scripts/build-nom-userscript.js --local-only
	$(NODE) scripts/build-popupdict-userscript.js --local-only

# Long-running: polls every 60s for a change under user_nom_entries/ or user_nom_order.jsonc
# and rebuilds only the (Local) variants when one is found. Runs until interrupted (Ctrl+C).
rebuild-cycle-local-userscripts:
	$(NODE) scripts/watch-local-userscripts.js

rebuild-extension-dict:
	$(NODE) scripts/build-extension-dictionary.js

rebuild-extension-vnedict-json:
	$(NODE) scripts/build-extension-vnedict-json.js

rebuild-realwords-lexicon:
	$(NODE) scripts/build-realwords-lexicon.js

# Reads the same dictionary sources the userscript builders do (see scripts/nom-inspect.js),
# so the answer here never drifts from what a rebuilt userscript would actually show -- no
# rebuild or browser install needed to check one word or sentence.
nom-annotate:
	@test -n "$(TEXT)" || { echo "TEXT is required: make nom-annotate TEXT='...'" >&2; exit 1; }
	$(NODE) scripts/nom-inspect.js annotate "$(TEXT)"

nom-popup:
	@test -n "$(TERM)" || { echo "TERM is required: make nom-popup TERM='...'" >&2; exit 1; }
	$(NODE) scripts/nom-inspect.js popup "$(TERM)"

# Reporting is the default because a bare run of a check must never leave a dirty worktree.
# Archiving moves change directories and writes canonical specs, so it is opt-in, and
# DRY_RUN=1 rehearses it.
check-openspec:
	$(NODE) scripts/check-openspec-lifecycle.js $(if $(ARCHIVE),--archive) $(if $(DRY_RUN),--dry-run)

# Enumerated rather than listed file-by-file so a new script joins verification without a
# Makefile edit. The extracted userscript runtime is checked as code too, which a template
# literal never was.
verify: verify-scripts verify-browser

# Generated userscripts and vnedict.json go stale whenever the dictionary sources or runtimes
# change, and the tests compare against them. A first failure therefore rebuilds them and
# reruns once; a failure that survives the rebuild is a real one.
verify-scripts:
	@$(NODE) --test test/*.test.js || { \
		echo "Tests failed; rebuilding generated userscripts and vnedict.json, then retrying once..."; \
		$(MAKE) rebuild-userscripts rebuild-extension-vnedict-json && $(NODE) --test test/*.test.js; }
	@find scripts -name '*.js' -print0 | xargs -0 -n1 $(NODE) --check

verify-browser:
	@find js zd-extension/js -name '*.js' ! -path '*/lib/*' -print0 | xargs -0 -n1 $(NODE) --check
