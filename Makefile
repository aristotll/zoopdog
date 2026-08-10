NODE ?= node
INPUT ?= .idea/newfile.md
MANIFEST ?= /tmp/zoopdog-add-chu-nom.json

.DEFAULT_GOAL := help

.PHONY: help add-chu-nom-plan add-chu-nom-apply import-chu-nom \
	rebuild-nom-userscript rebuild-popupdict-userscript rebuild-userscripts \
	verify-add-chu-nom

help:
	@echo "make add-chu-nom-plan [INPUT=path] [MANIFEST=path]"
	@echo "make import-chu-nom MANIFEST=/tmp/reviewed.json"
	@echo "make rebuild-nom-userscript"
	@echo "make rebuild-popupdict-userscript"
	@echo "make rebuild-userscripts"
	@echo "make verify-add-chu-nom"

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

verify-add-chu-nom:
	$(NODE) --test test/add-chu-nom.test.js
	$(NODE) --check scripts/add-chu-nom.js
	$(NODE) --check scripts/user-nom-entries.js
	$(NODE) --check scripts/build-nom-userscript.js
	$(NODE) --check scripts/build-popupdict-userscript.js
