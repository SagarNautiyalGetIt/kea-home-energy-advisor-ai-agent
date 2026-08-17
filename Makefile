.PHONY: help setup dev test lint fmt types check bench pull clean

help:
	@grep -E '^[a-z-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-10s\033[0m %s\n",$$1,$$2}'

setup:  ## create the venv and install everything
	python3 -m venv .venv
	.venv/bin/pip install -q --upgrade pip
	.venv/bin/pip install -q -e ".[dev]"
	@echo "done — activate with: source .venv/bin/activate"

dev:  ## run the API with reload on :8000
	.venv/bin/uvicorn app.main:app --reload --port 8000

test:  ## run the test suite
	.venv/bin/pytest

lint:  ## check style
	.venv/bin/ruff check app tests

fmt:  ## fix style
	.venv/bin/ruff check --fix app tests
	.venv/bin/ruff format app tests

check: lint test  ## what CI runs

pull:  ## download the candidate models (run natively on macOS, NOT in Docker)
	ollama pull gemma3:4b
	ollama pull qwen3:4b

bench:  ## measure words/sec for each candidate model on this machine
	cd "scripts/Device Benchmarking" && bash bench-mac.sh

spec:  ## write the OpenAPI spec for the frontend to generate types from
	.venv/bin/python -c "import json, app.main as m; print(json.dumps(m.app.openapi(), indent=2))" > openapi.json
	@echo "wrote openapi.json — frontend: npx openapi-typescript openapi.json -o src/api.d.ts"

clean:
	rm -rf .venv .pytest_cache **/__pycache__ openapi.json
