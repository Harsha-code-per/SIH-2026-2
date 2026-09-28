API_PORT ?= 8765
WEB_PORT ?= 5199
RUN      := .run
PY       := .venv/bin/python

.DEFAULT_GOAL := help
.PHONY: help install up down restart status logs test build demo data clean

help: ## Show all commands
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*## "}{printf "  make %-9s %s\n",$$1,$$2}'

install: .venv/.ok web/node_modules/.ok ## Install Python + Node dependencies

.venv/.ok: requirements.txt
	uv venv -q --allow-existing .venv
	uv pip install -q -p .venv -r requirements.txt
	@touch $@

web/node_modules/.ok: web/package.json web/package-lock.json
	npm --prefix web install --silent
	@touch $@

up: install down ## Start API + UI dev servers in the background
	@mkdir -p $(RUN)
	@nohup .venv/bin/uvicorn engine.api:app --port $(API_PORT) > $(RUN)/api.log 2>&1 &
	@nohup npm --prefix web run dev -- --port $(WEB_PORT) --strictPort > $(RUN)/web.log 2>&1 &
	@printf 'Calibrating well twins'; n=0; until curl -sf localhost:$(API_PORT)/api/field >/dev/null; do \
		n=$$((n+1)); [ $$n -gt 60 ] && { echo; echo 'API failed to start:'; tail -20 $(RUN)/api.log; exit 1; }; printf .; sleep 1; done; echo
	@echo "  UI   → http://localhost:$(WEB_PORT)"
	@echo "  API  → http://localhost:$(API_PORT)/docs"
	@echo "  stop → make down"

down: ## Stop both servers
	@pkill -f '[u]vicorn engine.api:app --port $(API_PORT)' || true
	@pkill -f '[v]ite.*--port $(WEB_PORT)' || true
	@echo "stopped"

restart: down up ## Restart both servers (after engine changes)

status: ## Show what is running
	@curl -sf localhost:$(API_PORT)/api/field >/dev/null && echo "API  up   :$(API_PORT)" || echo "API  down"
	@curl -sf localhost:$(WEB_PORT) >/dev/null && echo "UI   up   :$(WEB_PORT)" || echo "UI   down"

logs: ## Follow server logs
	@tail -n 30 -f $(RUN)/api.log $(RUN)/web.log

test: .venv/.ok ## Engine self-check + UI type-check
	NVIDIA_API_KEY= $(PY) -m engine.test_engine
	cd web && npx tsc -b

build: install ## Build the UI into web/dist (served by the API)
	npm --prefix web run build

demo: build down ## One process for recording: UI + API on :$(API_PORT)
	@echo "open http://localhost:$(API_PORT)"
	.venv/bin/uvicorn engine.api:app --port $(API_PORT)

data: .venv/.ok ## Regenerate the synthetic field history
	rm -rf data
	$(PY) -m engine.history > /dev/null
	@echo "data/ regenerated; re-check the demo mission: $(PY) -m engine.optimize"

clean: down ## Remove build output, logs and local envs
	rm -rf $(RUN) web/dist .venv web/node_modules
