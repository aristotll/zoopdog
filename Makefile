NODE ?= node
INPUT ?= .idea/newfile.md
MANIFEST ?=

# The review manifest holds proposed dictionary edits awaiting approval, so its path is
# never defaulted: a fixed name in a world-writable shared directory would let an unrelated
# or attacker-controlled file be applied by a bare `make import-chu-nom`.
MANIFEST_GOALS := add-chu-nom-plan add-chu-nom-apply import-chu-nom
REQUESTED_MANIFEST_GOALS := $(filter $(MANIFEST_GOALS),$(MAKECMDGOALS))

ifneq ($(REQUESTED_MANIFEST_GOALS),)
ifeq ($(strip $(MANIFEST)),)
$(error MANIFEST is required: make $(firstword $(REQUESTED_MANIFEST_GOALS)) MANIFEST=/path/to/manifest.json)
endif
endif

.DEFAULT_GOAL := help

.PHONY: help add-chu-nom-plan add-chu-nom-apply import-chu-nom \
	rebuild-nom-userscript rebuild-popupdict-userscript rebuild-userscripts \
	verify verify-scripts verify-add-chu-nom

help:
	@echo "make add-chu-nom-plan MANIFEST=/path/to/manifest.json [INPUT=path]"
	@echo "make import-chu-nom MANIFEST=/path/to/reviewed.json"
	@echo "make rebuild-nom-userscript"
	@echo "make rebuild-popupdict-userscript"
	@echo "make rebuild-userscripts"
	@echo "make verify            # tests + syntax-check every script"
	@echo "make verify-add-chu-nom # alias for verify"
	@echo ""
	@echo "MANIFEST has no default. Create one outside the repository, for example:"
	@echo "  make add-chu-nom-plan MANIFEST=\"\$$(mktemp -t zoopdog-chu-nom)\""

add-chu-nom-plan:
	$(NODE) scripts/add-chu-nom.js plan --file "$(INPUT)" --manifest "$(MANIFEST)"

add-chu-nom-apply:
	$(NODE) scripts/add-chu-nom.js apply --manifest "$(MANIFEST)" --approve

import-chu-nom: add-chu-nom-apply

rebuild-nom-userscript:
	$(NODE) scripts/build-nom-userscript.js

rebuild-popupdict-userscript:
	$(NODE) scripts/build-popupdict-userscript.js

rebuild-userscripts: rebuild-nom-userscript rebuild-popupdict-userscript

# Enumerated rather than listed file-by-file so a new script joins verification without a
# Makefile edit. The extracted userscript runtime is checked as code too, which a template
# literal never was.
verify: verify-scripts

verify-scripts:
	$(NODE) --test test/*.test.js
	@find scripts -name '*.js' -print0 | xargs -0 -n1 $(NODE) --check

verify-add-chu-nom: verify-scripts
