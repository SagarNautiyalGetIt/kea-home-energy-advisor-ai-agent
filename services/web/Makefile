# Frontend service — owned by the Frontend team.
.PHONY: install dev build preview lint types clean

install:  ## install node dependencies (exactly as locked)
	npm ci

dev:  ## dev server on :5173, proxying /api to :8000
	npm run dev

build:  ## production build
	npm run build

preview:  ## serve the production build locally
	npm run preview

lint:  ## eslint + tsc --noEmit
	npm run lint

types:  ## regenerate src/api.d.ts from contracts/openapi.json
	npm run types

clean:
	rm -rf node_modules dist .vite
