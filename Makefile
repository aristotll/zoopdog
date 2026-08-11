NODE ?= node
INPUT ?= .idea/newfile.md
MANIFEST ?=
ARCHIVE ?=
DRY_RUN ?=

# The review manifest holds proposed dictionary edits awaiting approval, so its path is
# never defaulted: a fixed name in a world-writable shared directory would let an unrelated
# or attacker-controlled file be applied by a bare `make import-chu-nom`.
DECISIONS ?= -

MANIFEST_GOALS := add-chu-nom-plan add-chu-nom-review add-chu-nom-apply import-chu-nom
REQUESTED_MANIFEST_GOALS := $(filter $(MANIFEST_GOALS),$(MAKECMDGOALS))

ifneq ($(REQUESTED_MANIFEST_GOALS),)
ifeq ($(strip $(MANIFEST)),)
$(error MANIFEST is required: make $(firstword $(REQUESTED_MANIFEST_GOALS)) MANIFEST=/path/to/manifest.json)
endif
endif

.DEFAULT_GOAL := help

.PHONY: help add-chu-nom-plan add-chu-nom-review add-chu-nom-apply import-chu-nom \
	rebuild-nom-userscript rebuild-popupdict-userscript rebuild-userscripts \
	rebuild-extension-vnedict-json \
	check-openspec verify verify-scripts verify-browser verify-add-chu-nom

help:
	@echo "make add-chu-nom-plan MANIFEST=/path/to/manifest.json [INPUT=path]"
	@echo "make add-chu-nom-review MANIFEST=/path/to/manifest.json [DECISIONS=path|-]"
	@echo "make import-chu-nom MANIFEST=/path/to/reviewed.json"
	@echo "make rebuild-nom-userscript"
	@echo "make rebuild-popupdict-userscript"
	@echo "make rebuild-userscripts"
	@echo "make rebuild-extension-vnedict-json"
	@echo "make check-openspec    # report OpenSpec lifecycle state; writes nothing"
	@echo "make check-openspec ARCHIVE=1 [DRY_RUN=1]  # archive eligible changes, promote deltas"
	@echo "make verify            # tests + syntax-check maintenance and browser scripts"
	@echo "make verify-add-chu-nom # alias for verify"
	@echo ""
	@echo "MANIFEST has no default. Create one outside the repository, for example:"
	@echo "  make add-chu-nom-plan MANIFEST=\"\$$(mktemp -t zoopdog-chu-nom)\""

add-chu-nom-plan:
	$(NODE) scripts/add-chu-nom.js plan --file "$(INPUT)" --manifest "$(MANIFEST)"

# Decisions default to stdin because the common case is a small array piped straight in; a
# file path avoids shell quoting trouble with Vietnamese and Chu Nom text.
add-chu-nom-review:
	$(NODE) scripts/add-chu-nom.js review --manifest "$(MANIFEST)" --decisions "$(DECISIONS)"

add-chu-nom-apply:
	$(NODE) scripts/add-chu-nom.js apply --manifest "$(MANIFEST)" --approve

import-chu-nom: add-chu-nom-apply

rebuild-nom-userscript:
	$(NODE) scripts/build-nom-userscript.js

rebuild-popupdict-userscript:
	$(NODE) scripts/build-popupdict-userscript.js

rebuild-userscripts: rebuild-nom-userscript rebuild-popupdict-userscript

rebuild-extension-vnedict-json:
	$(NODE) scripts/build-extension-vnedict-json.js

# Reporting is the default because a bare run of a check must never leave a dirty worktree.
# Archiving moves change directories and writes canonical specs, so it is opt-in, and
# DRY_RUN=1 rehearses it.
check-openspec:
	$(NODE) scripts/check-openspec-lifecycle.js $(if $(ARCHIVE),--archive) $(if $(DRY_RUN),--dry-run)

# Enumerated rather than listed file-by-file so a new script joins verification without a
# Makefile edit. The extracted userscript runtime is checked as code too, which a template
# literal never was.
verify: verify-scripts verify-browser

verify-scripts:
	$(NODE) --test test/*.test.js
	@find scripts -name '*.js' -print0 | xargs -0 -n1 $(NODE) --check

verify-browser:
	@find js zd-extension/js -name '*.js' ! -path '*/lib/*' -print0 | xargs -0 -n1 $(NODE) --check

verify-add-chu-nom: verify
