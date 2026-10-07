# Step-by-step and complete Sydney EC2 + RDS deployment commands.
# Run the commands shown by `make -C infra/aws help` from the repository root.
SHELL := /bin/bash
.DEFAULT_GOAL := help

SESSION_ID ?=
SOURCE_PAUSED ?= 0
RELEASE_IP ?= 0
DB_LOCAL_PORT ?= 15432
SSH_HOST ?=
SSH_KEY ?=
DB_HOST ?=
ENABLE_VOICE_ALERTS ?= 0
export SESSION_ID SOURCE_PAUSED RELEASE_IP DB_LOCAL_PORT SSH_HOST SSH_KEY DB_HOST ENABLE_VOICE_ALERTS

.PHONY: help validate export-local login ip-allocate ip-status ip-release session-id session export-db plan-create apply-create host cert images runtime \
	restore verify metabase mobile publish-apk install-apk db-tunnel renew-cert refresh-credentials destroy-plan destroy-apply audit \
	clean-session deploy teardown

help:
	@printf '%s\n' \
	  'Run from the repository root. Replace <id> with the deployed session ID.' \
	  'For individual deployment steps, choose a unique 8-16 character lowercase/digit ID.' \
	  '' \
	  'Complete workflows:' \
	  '  make -C infra/aws deploy SOURCE_PAUSED=1             # Provision, restore, verify, Metabase and build APK' \
	  '    add ENABLE_VOICE_ALERTS=1                          # Also create Amazon Connect voice alerts (billed)' \
	  '  make -C infra/aws teardown                          # Destroy saved session; keep Elastic IP' \
	  '' \
	  'Local preparation:' \
	  '  make -C infra/aws validate                          # Check both Terraform configurations' \
	  '  make -C infra/aws export-local SOURCE_PAUSED=1      # Export paused local DB without deploying' \
	  '  make -C infra/aws session-id                        # Print the saved session ID' \
	  '' \
	  'Retained Sydney Elastic IP:' \
	  '  make -C infra/aws ip-allocate                       # Allocate once, or show existing address' \
	  '  make -C infra/aws ip-status                         # Show address and association' \
	  '  make -C infra/aws ip-release RELEASE_IP=1           # Explicitly release after teardown' \
	  '' \
	  'Individual deployment steps, in order:' \
	  '  make -C infra/aws login                             # Sign in and check the Sydney account' \
	  '  make -C infra/aws ip-allocate                       # Ensure retained address exists' \
	  '  make -C infra/aws session SESSION_ID=<id>            # Create local state and SSH key' \
	  '  make -C infra/aws export-db SESSION_ID=<id> SOURCE_PAUSED=1 # Export paused local DB' \
	  '  make -C infra/aws plan-create SESSION_ID=<id>        # Review Terraform creation plan' \
	  '  make -C infra/aws apply-create SESSION_ID=<id>       # Provision AWS resources and attach IP' \
	  '  make -C infra/aws host SESSION_ID=<id>               # Prepare Docker and RDS TLS certificates' \
	  '  make -C infra/aws cert SESSION_ID=<id>               # Install HTTPS IP certificate' \
	  '  make -C infra/aws images SESSION_ID=<id>             # Build and transfer containers' \
	  '  make -C infra/aws runtime SESSION_ID=<id>            # Install protected runtime credentials' \
	  '  make -C infra/aws restore SESSION_ID=<id>            # Restore private RDS, verify inventory, start services' \
	  '  make -C infra/aws verify SESSION_ID=<id>             # Check HTTPS and restored row count' \
	  '  make -C infra/aws metabase SESSION_ID=<id>           # Pin to the story date; Metabase and the walkthrough at /metabase/' \
	  '  make -C infra/aws mobile SESSION_ID=<id>             # Build APK; installation is separate' \
	  '  make -C infra/aws publish-apk SESSION_ID=<id>        # Serve the APK at https://<ip>/download/kea-energy.apk' \
	  '' \
	  'Maintenance:' \
	  '  make -C infra/aws db-tunnel SESSION_ID=<id>          # Open private RDS at localhost:15432' \
	  '  make -C infra/aws install-apk SESSION_ID=<id>        # Install an already-built APK' \
	  '  make -C infra/aws renew-cert SESSION_ID=<id>        # Renew certificate for unchanged IP' \
	  '  make -C infra/aws refresh-credentials SESSION_ID=<id> # Refresh Bedrock SSO credentials' \
	  '' \
	  'Individual teardown steps, in order:' \
	  '  make -C infra/aws login                             # Sign in and check the Sydney account' \
	  '  make -C infra/aws destroy-plan SESSION_ID=<id>       # Review Terraform destruction plan' \
	  '  make -C infra/aws destroy-apply SESSION_ID=<id>      # Delete EC2/RDS and session network; keep IP' \
	  '  make -C infra/aws audit SESSION_ID=<id>              # Check Sydney for remaining resources' \
	  '  make -C infra/aws clean-session SESSION_ID=<id>      # Remove local session state after audit' \
	  '' \
	  'See infra/aws/README.md for prerequisites and recovery.'

validate:
	@terraform -chdir=address init -backend=false -input=false -lockfile=readonly
	@terraform -chdir=address validate
	@terraform -chdir=ec2 init -backend=false -input=false -lockfile=readonly
	@terraform -chdir=ec2 validate

export-local:
	@test "$(SOURCE_PAUSED)" = "1" || (echo 'Pause publishing/writes, then use make -C infra/aws export-local SOURCE_PAUSED=1'; exit 1)
	@python3 scripts/export_serving.py --source-paused

login:
	@bash scripts/operations.sh login

ip-allocate:
	@bash scripts/operations.sh ip-allocate

ip-status:
	@bash scripts/operations.sh ip-status

ip-release:
	@bash scripts/operations.sh ip-release

session-id:
	@bash scripts/operations.sh session-id

session:
	@bash scripts/operations.sh session

export-db:
	@bash scripts/operations.sh export-db

plan-create:
	@bash scripts/operations.sh plan-create

apply-create:
	@bash scripts/operations.sh apply-create

host:
	@bash scripts/operations.sh host

cert:
	@bash scripts/operations.sh cert

images:
	@bash scripts/operations.sh images

runtime:
	@bash scripts/operations.sh runtime

restore:
	@bash scripts/operations.sh restore

verify:
	@bash scripts/operations.sh verify

metabase:
	@bash scripts/operations.sh metabase

mobile:
	@bash scripts/operations.sh mobile

publish-apk:
	@bash scripts/operations.sh publish-apk

install-apk:
	@bash scripts/operations.sh install-apk

db-tunnel:
	@bash scripts/operations.sh db-tunnel

renew-cert:
	@bash scripts/operations.sh renew-cert

refresh-credentials:
	@bash scripts/operations.sh refresh-credentials

destroy-plan:
	@bash scripts/operations.sh destroy-plan

destroy-apply:
	@bash scripts/operations.sh destroy-apply

audit:
	@bash scripts/operations.sh audit

clean-session:
	@bash scripts/operations.sh clean-session

deploy:
	@SESSION_ID="$(if $(filter command line,$(origin SESSION_ID)),$(SESSION_ID),)" bash scripts/operations.sh deploy

teardown:
	@SESSION_ID="$(if $(filter command line,$(origin SESSION_ID)),$(SESSION_ID),)" bash scripts/operations.sh teardown
