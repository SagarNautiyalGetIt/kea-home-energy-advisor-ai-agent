# Mobile frontend service — owned by the Frontend team.
.PHONY: install dev web types test lint typecheck doctor export-web export-ios export-android check clean

install:  ## install dependencies exactly as locked
	npm ci

dev:  ## start Expo for a development client or Expo Go
	npm run start

web:  ## start the browser preview
	npm run web

types:  ## regenerate API types from the committed contract
	npm run types

test:  ## run mobile unit tests
	npm run test

lint:  ## run Expo's ESLint configuration
	npm run lint

typecheck:  ## run TypeScript without emitting files
	npm run typecheck

doctor:  ## validate Expo configuration and dependencies
	npx expo-doctor

export-web:  ## create a production web bundle
	npm run export:web

export-ios:  ## create a production iOS JavaScript bundle
	npm run export:ios

export-android:  ## create a production Android JavaScript bundle
	npm run export:android

check: types test lint typecheck doctor export-web export-ios export-android  ## run the mobile CI checks

clean:
	rm -rf node_modules .expo dist web-build
