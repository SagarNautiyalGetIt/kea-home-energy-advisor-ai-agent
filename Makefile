# Root Makefile — the one entry point for all five teams.
#
# Targets are prefixed by the team that owns them. Anything unprefixed is
# cross-cutting (setup, check, db). Per-service detail lives in that service's
# own Makefile; this file only delegates, so there is one place to look.
.PHONY: help setup check db db-stop db-logs \
        api-migrate api-seed api-dev api-test api-lint api-check api-spec \
        web-install web-dev web-build web-lint web-types \
        ml-pull ml-bench \
        data-images data-up data-down data-clean data-ps data-dbt-build data-serving-schema \
        clean

COMPOSE := docker compose -f infra/docker-compose.yml
API     := $(MAKE) -C services/api
WEB     := $(MAKE) -C services/web
DATA    := $(MAKE) -C data

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

## Data team — data/
# The pipeline stack, separate from `db` above: that one is the application's
# Postgres, this is the lake/warehouse/orchestration stack the Data team runs.
# Target names inside data/Makefile are the conventional ones for a stack of
# that shape, so the prefix is added here at the boundary rather than there.
data-images:  ## build the pipeline images (dataeng/airflow, spark, dbt, soda)
	$(DATA) images
data-up:  ## start the pipeline stack (airflow :8080, minio :9001, grafana :3001)
	$(DATA) up
data-down:  ## stop the pipeline stack
	$(DATA) down
data-clean:  ## stop it and wipe its volumes
	$(DATA) clean
data-ps:  ## what is running in the pipeline stack
	$(DATA) ps
data-serving-schema:  ## apply the source + serving DDL to the pipeline's Postgres
	$(DATA) serving-schema
data-dbt-build:  ## dbt deps + build against Snowflake
	$(DATA) dbt-build

## AI team — ml/
ml-pull:  ## download the candidate models (run natively on macOS, NOT in Docker)
	ollama pull gemma3:4b
	ollama pull qwen3:4b
ml-bench:  ## measure words/sec for each candidate model on this machine
	cd ml/benchmarks/device && bash bench-mac.sh

clean:
	$(API) clean
	$(WEB) clean
