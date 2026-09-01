# Backend service — owned by the Backend team.
# Every target assumes this directory is the working directory. The root Makefile
# delegates here, so `make api-test` at the root and `make test` here do the same thing.
.PHONY: help setup migrate seed dev test golden lint fmt check spec clean

VENV := .venv
PY   := $(VENV)/bin/python

help:
	@grep -E '^[a-z-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-10s\033[0m %s\n",$$1,$$2}'

setup:  ## create the venv and install everything
	python3 -m venv $(VENV)
	$(VENV)/bin/pip install -q --upgrade pip
	$(VENV)/bin/pip install -q -e ".[dev]"
	@echo "done — activate with: source services/api/.venv/bin/activate"

migrate:  ## apply migrations (needs `make db` at the root first)
	$(VENV)/bin/alembic upgrade head

seed:  ## load the five demo households (idempotent)
	$(PY) -m app.db.seed

dev:  ## run the API with reload on :8000
	$(VENV)/bin/uvicorn app.main:app --reload --port 8000

test:  ## run the test suite
	$(VENV)/bin/pytest

golden:  ## run the golden set on its own and show the headline (KEA-46 / KEA-57)
	$(VENV)/bin/pytest tests/test_golden_set.py -v

lint:  ## check style
	$(VENV)/bin/ruff check app tests

fmt:  ## fix style
	$(VENV)/bin/ruff check --fix app tests
	$(VENV)/bin/ruff format app tests

check: lint test  ## what CI runs for this service

spec:  ## write the OpenAPI contract the frontend generates types from
	$(PY) -c "import json, app.main as m; print(json.dumps(m.app.openapi(), indent=2))" > ../../contracts/openapi.json
	@echo "wrote contracts/openapi.json"

clean:
	rm -rf $(VENV) .pytest_cache **/__pycache__ *.egg-info
