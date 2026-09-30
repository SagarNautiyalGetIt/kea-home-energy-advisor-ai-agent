# Root Makefile — the one entry point for all five teams.
#
# Targets are prefixed by the team that owns them. Anything unprefixed is
# cross-cutting (setup, check, db). Per-service detail lives in that service's
# own Makefile; this file only delegates, so there is one place to look.
.PHONY: help setup check hooks attribution db db-stop db-logs \
        ollama ollama-status api-migrate api-seed data-load data-reload api-dev api-test api-lint api-check api-spec \
        web-install web-dev web-build web-lint web-types \
        ml-pull ml-bench ml-golden voice-setup voice-check voice-smoke \
        clean

COMPOSE := docker compose -f infra/docker-compose.yml
API     := $(MAKE) -C services/api
WEB     := $(MAKE) -C services/web

help:  ## show this help
	@awk 'BEGIN{FS=":.*?## "} /^## /{printf "\n\033[1m%s\033[0m\n", substr($$0,4); next} /^[a-z][a-z-]*:.*?## /{printf "  \033[36m%-14s\033[0m %s\n",$$1,$$2}' $(MAKEFILE_LIST)

## Everyone
setup:  ## install every service's dependencies
	$(API) setup
	$(WEB) install
	@echo ""
	@echo "next: cp .env.example .env && make db && make api-migrate && make api-seed"

check:  ## run every team's CI checks — do this before you push
	$(API) check
	$(WEB) lint
	@# Scoped to your own commits, same as CI. `make attribution` sweeps all history.
	./scripts/check-attribution.sh origin/main..HEAD

hooks:  ## install the shared git hooks — run once per clone
	@git config core.hooksPath scripts/hooks
	@chmod +x scripts/hooks/* scripts/check-attribution.sh
	@echo "hooks installed: commit-msg, pre-push (see docs/attribution-checklist.md)"

attribution:  ## full sweep for assistant attribution artefacts, all history
	./scripts/check-attribution.sh

ollama:  ## start the local model and pull it if missing (NATIVE, never Docker)
	./infra/ollama.sh start
ollama-status:  ## is the model actually answering?
	./infra/ollama.sh status

db:  ## start postgres (Ollama stays NATIVE — Docker has no Apple GPU access)
	$(COMPOSE) up -d db
	@echo "waiting for postgres..."
	@until $(COMPOSE) exec -T db pg_isready -U kea -d kea >/dev/null 2>&1; do sleep 1; done
	@echo "postgres ready on :5432"

db-stop:  ## stop postgres, keep the data volume
	$(COMPOSE) stop db

db-logs:  ## tail postgres logs
	$(COMPOSE) logs -f db

## Backend team — services/api
api-migrate:  ## apply database migrations
	$(API) migrate
api-seed:  ## load the five demo households
	$(API) seed
api-dev:  ## run the API on :8000, docs at /docs
	$(API) dev
api-test:  ## run the backend test suite
	$(API) test
api-lint:  ## ruff
	$(API) lint
api-check:  ## lint + test
	$(API) check
api-spec:  ## regenerate contracts/openapi.json — REQUIRED when an endpoint changes
	$(API) spec

## Data team — data/
# Only the loader the application needs: bill fixtures into the app's Postgres.
# The pipeline stack has its own entry point: `cd data && make help`.
data-load:  ## load the platform schema and all bill fixtures into kea.*/metering/billing
	services/api/.venv/bin/python data/load.py
data-reload:  ## same, but drop the loader's schemas first (never touches app.*)
	services/api/.venv/bin/python data/load.py --drop

## Frontend team — services/web
web-install:  ## install node dependencies
	$(WEB) install
web-dev:  ## run the dev server on :5173
	$(WEB) dev
web-build:  ## production build
	$(WEB) build
web-lint:  ## eslint + tsc
	$(WEB) lint
web-types:  ## regenerate src/api.d.ts from contracts/openapi.json
	$(WEB) types

## AI team — ml/
ml-pull:  ## download the candidate models (run natively on macOS, NOT in Docker)
	ollama pull gemma3:4b
	ollama pull qwen3:4b
ml-golden:  ## run the golden set as a gate (offline narration path)
	$(API) golden
ml-bench:  ## measure words/sec for each candidate model on this machine
	cd ml/benchmarks/device && bash bench-mac.sh

clean:
	$(API) clean
	$(WEB) clean

## AI team — voice (ADR-0003)
voice-setup:  ## download the whisper/piper/silero stack into ml/voice/dist
	./ml/voice/setup.sh
voice-check:  ## report which parts of the voice stack are present — downloads nothing
	./ml/voice/setup.sh --check
voice-smoke:  ## end-to-end check: PCM in, transcript, answer, audio out
	$(API) voice-smoke
