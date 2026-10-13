#!/usr/bin/env bash
# Implementation of infra/aws/Makefile targets. No target runs on a timer.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/session.sh"
SESSION_ID="${SESSION_ID:-}"
SOURCE_PAUSED="${SOURCE_PAUSED:-0}"
RELEASE_IP="${RELEASE_IP:-0}"
DB_LOCAL_PORT="${DB_LOCAL_PORT:-15432}"
SSH_HOST="${SSH_HOST:-}"
SSH_KEY="${SSH_KEY:-}"
DB_HOST="${DB_HOST:-}"

step_login() {
  export AWS_PROFILE=kea-energy AWS_REGION=ap-southeast-2 AWS_DEFAULT_REGION=ap-southeast-2
  aws sso login --profile "$AWS_PROFILE"
  kea_check_account
  printf 'Confirmed account %s in %s.\n' "$KEA_ACCOUNT" "$KEA_REGION"
}

step_ip_allocate() {
  export AWS_PROFILE=kea-energy AWS_REGION=ap-southeast-2 AWS_DEFAULT_REGION=ap-southeast-2
  kea_check_account
  if [[ -s "$KEA_IP_STATE" ]]; then
    kea_ip_details
    printf 'Retained Sydney Elastic IP: %s (%s).\n' "$KEA_IP_PUBLIC_IP" "$KEA_IP_ALLOCATION_ID"
    return
  fi
  [[ ! -e "$KEA_IP_STATE" ]] || { echo 'Empty Elastic IP state exists; inspect it before retrying.' >&2; exit 1; }
  local existing
  existing="$(aws ec2 describe-addresses --region "$KEA_REGION" \
    --filters 'Name=tag:Name,Values=kea-energy-stable-ip' \
    --query 'Addresses[].AllocationId' --output text)"
  [[ -z "$existing" ]] || {
    printf 'A retained Kea Energy Elastic IP already exists (%s), but local state is missing; import it instead of allocating another.\n' "$existing" >&2
    exit 1
  }
  umask 077
  mkdir -p "$KEA_IP_DIR"
  chmod 700 "$KEA_IP_DIR"
  export TF_DATA_DIR="$KEA_IP_DIR/terraform-data"
  export TF_VAR_account_id="$KEA_ACCOUNT" TF_VAR_cloud_owner="$(whoami)"
  terraform -chdir="$KEA_IP_STACK" init -input=false -lockfile=readonly
  terraform -chdir="$KEA_IP_STACK" validate
  terraform -chdir="$KEA_IP_STACK" plan -state="$KEA_IP_STATE" -out="$KEA_IP_DIR/allocate.tfplan"
  terraform -chdir="$KEA_IP_STACK" show -no-color "$KEA_IP_DIR/allocate.tfplan"
  terraform -chdir="$KEA_IP_STACK" apply -state="$KEA_IP_STATE" "$KEA_IP_DIR/allocate.tfplan"
  kea_ip_details
  printf 'Retained Sydney Elastic IP allocated: %s (%s). It is billed until ip-release.\n' \
    "$KEA_IP_PUBLIC_IP" "$KEA_IP_ALLOCATION_ID"
}

step_ip_status() {
  export AWS_PROFILE=kea-energy AWS_REGION=ap-southeast-2 AWS_DEFAULT_REGION=ap-southeast-2
  kea_check_account
  kea_ip_details
  local instance
  instance="$(aws ec2 describe-addresses --region "$KEA_REGION" \
    --allocation-ids "$KEA_IP_ALLOCATION_ID" --query 'Addresses[0].InstanceId' --output text)"
  printf 'Retained Sydney Elastic IP: %s (%s), instance: %s\n' \
    "$KEA_IP_PUBLIC_IP" "$KEA_IP_ALLOCATION_ID" "${instance:-None}"
}

step_ip_release() {
  [[ "$RELEASE_IP" == 1 ]] || {
    echo 'Set RELEASE_IP=1 to explicitly release the retained Elastic IP.' >&2
    exit 1
  }
  export AWS_PROFILE=kea-energy AWS_REGION=ap-southeast-2 AWS_DEFAULT_REGION=ap-southeast-2
  kea_check_account
  kea_ip_details
  local association session_settings remaining
  association="$(aws ec2 describe-addresses --region "$KEA_REGION" \
    --allocation-ids "$KEA_IP_ALLOCATION_ID" --query 'Addresses[0].AssociationId' --output text)"
  [[ -z "$association" || "$association" == None ]] || {
    echo 'Elastic IP is still associated with an EC2 instance; tear down that session first.' >&2
    exit 1
  }
  for session_settings in "$KEA_WORK"/public-*/operator.env; do
    [[ -f "$session_settings" ]] || continue
    if grep -Fq "TF_VAR_elastic_ip_allocation_id=$KEA_IP_ALLOCATION_ID" "$session_settings"; then
      echo 'A local deployment session still references this Elastic IP; finish its teardown first.' >&2
      exit 1
    fi
  done
  export TF_DATA_DIR="$KEA_IP_DIR/terraform-data"
  export TF_VAR_account_id="$KEA_ACCOUNT" TF_VAR_cloud_owner="$(whoami)"
  terraform -chdir="$KEA_IP_STACK" init -input=false -lockfile=readonly
  terraform -chdir="$KEA_IP_STACK" plan -destroy -state="$KEA_IP_STATE" -out="$KEA_IP_DIR/release.tfplan"
  terraform -chdir="$KEA_IP_STACK" show -no-color "$KEA_IP_DIR/release.tfplan"
  terraform -chdir="$KEA_IP_STACK" apply -state="$KEA_IP_STATE" "$KEA_IP_DIR/release.tfplan"
  remaining="$(aws ec2 describe-addresses --region "$KEA_REGION" \
    --filters "Name=allocation-id,Values=$KEA_IP_ALLOCATION_ID" \
    --query 'Addresses[].AllocationId' --output text)"
  [[ -z "$remaining" ]] || { echo 'Elastic IP remains allocated; keep its Terraform state.' >&2; exit 1; }
  [[ -z "$(terraform -chdir="$KEA_IP_STACK" state list -state="$KEA_IP_STATE")" ]] || {
    echo 'Terraform still manages the Elastic IP; keep its state.' >&2
    exit 1
  }
  rm -r -- "$KEA_IP_DIR"
  printf 'Released retained Sydney Elastic IP %s.\n' "$KEA_IP_PUBLIC_IP"
}

step_session_id() {
  kea_current_session_id
}

step_session() {
  kea_require_id "$SESSION_ID"
  umask 077
  # A new session must not inherit adoption overrides from another operator.env.
  unset TF_VAR_resource_name TF_VAR_vpc_cidr TF_VAR_db_master_password
  export AWS_PROFILE=kea-energy AWS_REGION=ap-southeast-2 AWS_DEFAULT_REGION=ap-southeast-2
  kea_check_account
  kea_ip_details
  local association
  association="$(aws ec2 describe-addresses --region "$KEA_REGION" \
    --allocation-ids "$KEA_IP_ALLOCATION_ID" --query 'Addresses[0].AssociationId' --output text)"
  [[ -z "$association" || "$association" == None ]] || {
    echo 'Retained Elastic IP is already attached; tear down that session before a new deployment.' >&2
    exit 1
  }
  [[ ! -e "$KEA_STACK/terraform.tfstate" ]] || { echo 'Unexpected Terraform state in ec2/; inspect it first.' >&2; exit 1; }
  export SESSION_DIR="$KEA_WORK/public-$SESSION_ID"
  [[ ! -e "$SESSION_DIR" ]] || { echo "Session already exists: $SESSION_DIR" >&2; exit 1; }
  mkdir -p "$SESSION_DIR"
  chmod 700 "$SESSION_DIR"
  export STATE="$SESSION_DIR/terraform.tfstate"
  export TF_DATA_DIR="$SESSION_DIR/terraform-data"
  export DUMP="$KEA_WORK/exports/$SESSION_ID.dump"
  export MANIFEST="$KEA_WORK/exports/$SESSION_ID.json"
  ssh-keygen -q -t ed25519 -N '' -C "kea-energy-$SESSION_ID" -f "$SESSION_DIR/id_ed25519"
  export TF_VAR_account_id="$KEA_ACCOUNT"
  export TF_VAR_cloud_owner="$(whoami)"
  export TF_VAR_session_id="$SESSION_ID"
  export TF_VAR_elastic_ip_allocation_id="$KEA_IP_ALLOCATION_ID"
  export TF_VAR_ssh_public_key_path="$SESSION_DIR/id_ed25519.pub"
  ip="$(curl -fsS https://checkip.amazonaws.com)"
  [[ "$ip" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] || { echo 'Could not determine SSH IPv4 address.' >&2; exit 1; }
  export TF_VAR_ssh_cidr="$ip/32"
  export TF_VAR_web_cidrs='["0.0.0.0/0"]'
  # Amazon Connect voice alerts are billed per session; create them only on request.
  export TF_VAR_enable_voice_alerts=false
  [[ "${ENABLE_VOICE_ALERTS:-0}" != 1 ]] || TF_VAR_enable_voice_alerts=true
  export TF_VAR_ami_id="$(aws ssm get-parameter --name /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64 --query Parameter.Value --output text)"
  [[ "$TF_VAR_ami_id" == ami-* ]] || { echo 'Could not determine Sydney Amazon Linux AMI.' >&2; exit 1; }
  {
    for name in AWS_PROFILE AWS_REGION AWS_DEFAULT_REGION SESSION_ID SESSION_DIR STATE TF_DATA_DIR DUMP MANIFEST TF_VAR_account_id TF_VAR_cloud_owner TF_VAR_session_id TF_VAR_elastic_ip_allocation_id TF_VAR_ssh_public_key_path TF_VAR_ssh_cidr TF_VAR_web_cidrs TF_VAR_enable_voice_alerts TF_VAR_ami_id; do
      printf 'export %s=%q\n' "$name" "${!name}"
    done
  } > "$SESSION_DIR/operator.env"
  chmod 600 "$SESSION_DIR/operator.env"
  python3 "$KEA_ROOT/infra/aws/scripts/database_credentials.py" "$SESSION_DIR"
  kea_save_session_id "$SESSION_ID"
  printf 'Session ID: %s\nState: %s\n' "$SESSION_ID" "$STATE"
}

step_export_db() {
  kea_load_session "$SESSION_ID"
  [[ "$SOURCE_PAUSED" == 1 ]] || { echo 'Pause local writes, then set SOURCE_PAUSED=1.' >&2; exit 1; }
  python3 "$KEA_ROOT/infra/aws/scripts/export_serving.py" --source-paused --session-id "$SESSION_ID"
  python3 -c 'import hashlib,json,sys; p,m=sys.argv[1:]; expected=json.load(open(m))["sha256"]; actual=hashlib.file_digest(open(p,"rb"),"sha256").hexdigest(); assert actual==expected, "dump checksum mismatch"' "$DUMP" "$MANIFEST"
  printf 'Export verified: %s\n' "$DUMP"
}

step_plan_create() {
  kea_load_session "$SESSION_ID"
  kea_check_account
  terraform -chdir="$KEA_STACK" init -input=false -lockfile=readonly
  terraform -chdir="$KEA_STACK" validate
  terraform -chdir="$KEA_STACK" plan -state="$STATE" -out="$SESSION_DIR/create.tfplan"
  terraform -chdir="$KEA_STACK" show -no-color "$SESSION_DIR/create.tfplan"
}

step_apply_create() {
  kea_load_session "$SESSION_ID"
  kea_check_account
  [[ -f "$SESSION_DIR/create.tfplan" ]] || { echo 'Run plan-create first.' >&2; exit 1; }
  terraform -chdir="$KEA_STACK" apply -state="$STATE" "$SESSION_DIR/create.tfplan"
  PUBLIC_IP="$(terraform -chdir="$KEA_STACK" output -state="$STATE" -raw public_ip)"
  INSTANCE_ID="$(terraform -chdir="$KEA_STACK" output -state="$STATE" -raw instance_id)"
  DB_HOST="$(terraform -chdir="$KEA_STACK" output -state="$STATE" -raw db_host)"
  DB_IDENTIFIER="$(terraform -chdir="$KEA_STACK" output -state="$STATE" -raw db_identifier)"
  printf 'export PUBLIC_IP=%q\nexport INSTANCE_ID=%q\nexport DB_HOST=%q\nexport DB_IDENTIFIER=%q\n' "$PUBLIC_IP" "$INSTANCE_ID" "$DB_HOST" "$DB_IDENTIFIER" >> "$SESSION_DIR/operator.env"
  for attempt in {1..10}; do
    aws ec2 describe-instances --region "$KEA_REGION" --instance-ids "$INSTANCE_ID" --query 'Reservations[].Instances[].BlockDeviceMappings[].Ebs.VolumeId' --output text > "$SESSION_DIR/volume-ids.txt"
    [[ -s "$SESSION_DIR/volume-ids.txt" ]] && break
    sleep 3
  done
  [[ -s "$SESSION_DIR/volume-ids.txt" ]] || { echo 'Could not record root EBS volume ID; inspect EC2 before continuing.' >&2; exit 1; }
  printf 'Session %s: instance %s, public IP %s\n' "$SESSION_ID" "$INSTANCE_ID" "$PUBLIC_IP"
  if [[ "${TF_VAR_enable_voice_alerts:-false}" == true ]]; then
    printf 'Voice alerts: Connect instance %s, flow %s, caller %s\n' \
      "$(terraform -chdir="$KEA_STACK" output -state="$STATE" -raw connect_instance_id)" \
      "$(terraform -chdir="$KEA_STACK" output -state="$STATE" -raw connect_contact_flow_id)" \
      "$(terraform -chdir="$KEA_STACK" output -state="$STATE" -raw connect_phone_number)"
  fi
}

step_host() {
  kea_load_session "$SESSION_ID"
  ready=0
  for attempt in {1..60}; do
    if kea_ssh 'true' >/dev/null 2>&1; then ready=1; break; fi
    sleep 10
  done
  [[ "$ready" == 1 ]] || { echo 'EC2 SSH did not become ready within 10 minutes.' >&2; exit 1; }
  kea_ssh 'sudo cloud-init status --wait && sudo docker version'
  if ! kea_ssh 'sudo docker compose version'; then
    kea_ssh 'set -e; sudo install -d -m 755 /usr/local/lib/docker/cli-plugins; curl -fsSL https://github.com/docker/compose/releases/download/v5.5.0/docker-compose-linux-x86_64 -o /tmp/docker-compose; sudo install -m 755 /tmp/docker-compose /usr/local/lib/docker/cli-plugins/docker-compose; sudo docker compose version'
  fi
  kea_ssh 'set -e; sudo install -d -m 755 /opt/kea/certs/rds; curl -fsSL https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem -o /tmp/rds-ca.pem; sudo install -m 644 /tmp/rds-ca.pem /opt/kea/certs/rds/global-bundle.pem; rm /tmp/rds-ca.pem; sudo docker pull postgres:16-alpine'
}

step_cert() {
  kea_load_session "$SESSION_ID"
  kea_ssh 'sudo install -d -m 700 /opt/kea/letsencrypt /opt/kea/letsencrypt-lib'
  kea_ssh "sudo docker run --rm -p 80:80 -v /opt/kea/letsencrypt:/etc/letsencrypt -v /opt/kea/letsencrypt-lib:/var/lib/letsencrypt certbot/certbot:v5.8.0 certonly --non-interactive --agree-tos --register-unsafely-without-email --standalone --preferred-profile shortlived --ip-address '$PUBLIC_IP'"
  kea_ssh "sudo install -d -o 10001 -g 10001 -m 700 /opt/kea/certs/active && sudo install -o 10001 -g 10001 -m 600 '/opt/kea/letsencrypt/live/$PUBLIC_IP/fullchain.pem' /opt/kea/certs/active/fullchain.pem && sudo install -o 10001 -g 10001 -m 600 '/opt/kea/letsencrypt/live/$PUBLIC_IP/privkey.pem' /opt/kea/certs/active/privkey.pem"
}

step_images() {
  kea_load_session "$SESSION_ID"
  cd "$KEA_ROOT"
  docker buildx build --platform linux/amd64 --load -f infra/aws/containers/api.Dockerfile -t kea-energy-api:ec2 .
  docker buildx build --platform linux/amd64 --load -f infra/aws/containers/web.Dockerfile -t kea-energy-web:ec2 .
  docker save -o "$SESSION_DIR/images.tar" kea-energy-api:ec2 kea-energy-web:ec2
  kea_scp "$SESSION_DIR/images.tar" "$KEA_STACK/compose.yml" "$KEA_STACK/Caddyfile" "$KEA_STACK/install-evaluator-timer.sh"
  kea_ssh 'sudo docker load -i ~/images.tar && sudo install -m 644 compose.yml Caddyfile /opt/kea/ && sudo install -m 755 install-evaluator-timer.sh /opt/kea/ && rm images.tar compose.yml Caddyfile install-evaluator-timer.sh'
  rm "$SESSION_DIR/images.tar"
}

step_runtime() {
  kea_load_session "$SESSION_ID"
  kea_check_account
  : "${DB_HOST:?Apply the RDS configuration first}"
  python3 "$KEA_ROOT/infra/aws/scripts/database_credentials.py" "$SESSION_DIR" --db-host "$DB_HOST"
  python3 "$KEA_ROOT/infra/aws/scripts/runtime_credentials.py" "$SESSION_DIR/runtime.env" --public-ip "$PUBLIC_IP" --db-host "$DB_HOST" --db-password-file "$SESSION_DIR/db-app-password"
  kea_ssh 'set -e; umask 077; cat > runtime.env; sudo install -o root -g root -m 600 runtime.env /opt/kea/runtime.env; rm runtime.env' < "$SESSION_DIR/runtime.env"
  kea_ssh 'set -e; umask 077; cat > db-admin.env; sudo install -o root -g root -m 600 db-admin.env /opt/kea/db-admin.env; rm db-admin.env' < "$SESSION_DIR/db-admin.env"
  kea_ssh 'set -e; umask 077; cat > db-client.env; sudo install -o root -g root -m 600 db-client.env /opt/kea/db-client.env; rm db-client.env' < "$SESSION_DIR/db-client.env"
  printf 'Protected runtime environment installed.\n'
}

step_restore() {
  kea_load_session "$SESSION_ID"
  [[ -s "$DUMP" && -s "$SESSION_DIR/runtime.env" ]] || { echo 'Dump or runtime environment missing.' >&2; exit 1; }
  [[ ! -e "$SESSION_DIR/restore.started" ]] || { echo 'Restore already started; inspect the database before retrying.' >&2; exit 1; }
  touch "$SESSION_DIR/restore.started"
  python3 "$KEA_ROOT/infra/aws/scripts/configure_rds.py" "$SESSION_DIR" --public-ip "$PUBLIC_IP"
  kea_ssh 'sudo docker run --rm -i --env-file /opt/kea/db-admin.env -v /opt/kea/certs/rds:/certs:ro postgres:16-alpine pg_restore --role=kea -d kea --no-owner --no-acl --exit-on-error' < "$DUMP"
  # The administrator login is needed only for role setup and the import.
  kea_ssh 'sudo rm -f /opt/kea/db-admin.env'
  python3 "$KEA_ROOT/infra/aws/scripts/verify_rds.py" "$SESSION_DIR" "$MANIFEST" --public-ip "$PUBLIC_IP"
  kea_ssh 'sudo docker compose --env-file /opt/kea/runtime.env -f /opt/kea/compose.yml run --rm api alembic upgrade head'
  kea_ssh 'sudo docker compose --env-file /opt/kea/runtime.env -f /opt/kea/compose.yml up -d --wait api web'
  kea_ssh 'sudo bash /opt/kea/install-evaluator-timer.sh && sudo systemctl is-active --quiet kea-energy-evaluator.timer'
  touch "$SESSION_DIR/restore.complete"
}

step_verify() {
  kea_load_session "$SESSION_ID"
  [[ -f "$SESSION_DIR/restore.complete" ]] || { echo 'Run restore first.' >&2; exit 1; }
  expected="$(python3 -c 'import json,sys; r=json.load(open(sys.argv[1]))["inventory"]["relations"]; print(next(str(x["value"]) for x in r if x["schema"]=="kea" and x["name"]=="mart_daily_usage"))' "$MANIFEST")"
  actual="$(printf 'SELECT count(*) FROM kea.mart_daily_usage;\n' | kea_ssh 'sudo docker run --rm -i --env-file /opt/kea/db-client.env -v /opt/kea/certs/rds:/certs:ro postgres:16-alpine psql -X -v ON_ERROR_STOP=1 -At')"
  [[ "$actual" == "$expected" ]] || { printf 'Daily usage row mismatch: local %s, EC2 %s\n' "$expected" "$actual" >&2; exit 1; }
  kea_ssh 'sudo docker compose --env-file /opt/kea/runtime.env -f /opt/kea/compose.yml ps'
  curl --fail --show-error "https://$PUBLIC_IP/api/live"
  curl --fail --show-error "https://$PUBLIC_IP/api/health"
  printf '\nHTTPS and %s daily usage rows verified.\n' "$actual"
}

step_metabase() {
  kea_load_session "$SESSION_ID"
  [[ -f "$SESSION_DIR/restore.complete" ]] || { echo 'Run restore first.' >&2; exit 1; }
  : "${DB_HOST:?Apply the RDS configuration first}"
  local psql='sudo docker run --rm -i --env-file /opt/kea/db-client.env -v /opt/kea/certs/rds:/certs:ro postgres:16-alpine psql -X -v ON_ERROR_STOP=1'
  local compose='sudo docker compose --env-file /opt/kea/runtime.env -f /opt/kea/compose.yml'
  # The served span runs a year past the story; pin it to the newest forecast
  # date so the app opens on the walkthrough's cycle. Safe to repeat.
  kea_ssh "$psql" < "$KEA_ROOT/data/pipeline/scripts/ops/serving_as_of.sql"
  # configure_rds.py created kea_metabase; the tables' owner grants it reads.
  kea_ssh "$psql" <<'SQL'
GRANT CONNECT ON DATABASE kea TO kea_metabase;
GRANT USAGE ON SCHEMA kea, billing, metering, catalogue TO kea_metabase;
GRANT SELECT ON ALL TABLES IN SCHEMA kea, billing, metering, catalogue TO kea_metabase;
SQL
  kea_ssh "$compose restart api && $compose up -d metabase"
  local admin_password metabase_password
  admin_password="$(<"$SESSION_DIR/metabase-admin-password")"
  metabase_password="$(<"$SESSION_DIR/metabase-db-password")"
  METABASE_URL="https://$PUBLIC_IP/metabase" METABASE_SERVING_ONLY=1 \
    METABASE_ADMIN_EMAIL=admin@kea.example METABASE_ADMIN_PASSWORD="$admin_password" \
    KEA_APP_PASSWORD="$metabase_password" KEA_BACKEND_DB_HOST="$DB_HOST" \
    KEA_BACKEND_DB_USER=kea_metabase KEA_BACKEND_DB_SSL=1 \
    python3 "$KEA_ROOT/data/analysis/metabase/metabase_setup.py"
  METABASE_URL="https://$PUBLIC_IP/metabase" \
    METABASE_ADMIN_EMAIL=admin@kea.example METABASE_ADMIN_PASSWORD="$admin_password" \
    python3 "$KEA_ROOT/data/analysis/metabase/build_demo_dashboard.py"
  printf 'Metabase: https://%s/metabase/ as admin@kea.example; the password is in %s/metabase-admin-password\n' \
    "$PUBLIC_IP" "$SESSION_DIR"
}

step_mobile() {
  kea_load_session "$SESSION_ID"
  cd "$KEA_ROOT/services/mobile"
  if [[ -z "${ANDROID_HOME:-}" && -d /opt/homebrew/share/android-commandlinetools/platforms ]]; then
    export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
  fi
  [[ -n "${ANDROID_HOME:-}" && -d "$ANDROID_HOME/platforms" ]] || {
    echo 'Set ANDROID_HOME to the installed Android SDK directory before building.' >&2
    exit 1
  }
  export ANDROID_SDK_ROOT="$ANDROID_HOME"
  npm ci
  # npm ci replaces native modules; stale CMake files can reference codegen
  # directories from the previous installation and break Gradle's clean task.
  rm -rf -- android/app/.cxx
  # arm64-v8a by default: practically every Android phone in use, and 162 MB
  # to download instead of 253 MB for every architecture (6 Oct 2026; the
  # JavaScript bundle and assets are most of the rest). ANDROID_ABIS=all builds
  # every architecture (older 32-bit phones, x86 emulators).
  local abis="${ANDROID_ABIS:-arm64-v8a}"
  # macOS Bash 3.2 treats an empty array expansion as unset under `set -u`.
  # Invoke Gradle directly in each branch so the default ABI path also works.
  if [[ "$abis" != all ]]; then
    EXPO_PUBLIC_API_URL="https://$PUBLIC_IP" EXPO_PUBLIC_USE_REAL_DATA=true \
      ./android/gradlew -p android --no-daemon "-PreactNativeArchitectures=$abis" clean :app:assembleRelease
  else
    EXPO_PUBLIC_API_URL="https://$PUBLIC_IP" EXPO_PUBLIC_USE_REAL_DATA=true \
      ./android/gradlew -p android --no-daemon clean :app:assembleRelease
  fi
  printf 'APK built: %s\nTo install it when ready: make -C infra/aws install-apk SESSION_ID=%s\n' \
    "$KEA_ROOT/services/mobile/android/app/build/outputs/apk/release/app-release.apk" "$SESSION_ID"
}

step_publish_apk() {
  kea_load_session "$SESSION_ID"
  local apk="$KEA_ROOT/services/mobile/android/app/build/outputs/apk/release/app-release.apk"
  [[ -s "$apk" ]] || { echo 'Release APK missing; run make mobile to build it.' >&2; exit 1; }
  # The compose file and Caddyfile carry the /download/ route; sync them so an
  # older session gains it, then recreate web (a few seconds) to mount the folder.
  kea_scp "$apk" "$KEA_STACK/compose.yml" "$KEA_STACK/Caddyfile"
  kea_ssh 'set -e; sudo install -d -m 755 /opt/kea/downloads; sudo install -m 644 app-release.apk /opt/kea/downloads/kea-energy.apk; sudo install -m 644 compose.yml Caddyfile /opt/kea/; rm app-release.apk compose.yml Caddyfile'
  kea_ssh 'sudo docker compose --env-file /opt/kea/runtime.env -f /opt/kea/compose.yml up -d web && sudo docker compose --env-file /opt/kea/runtime.env -f /opt/kea/compose.yml restart web'
  local url="https://$PUBLIC_IP/download/kea-energy.apk" got
  for _ in 1 2 3 4 5 6; do
    got="$(curl -sI -o /dev/null -w '%{http_code} %{content_type}' "$url" || true)"
    [[ "$got" == "200 application/vnd.android.package-archive" ]] && break
    sleep 3
  done
  [[ "$got" == "200 application/vnd.android.package-archive" ]] || { printf 'Download check failed: %s\n' "$got" >&2; exit 1; }
  printf 'Android app published: %s\n' "$url"
  # The committed QR code encodes one URL. The Elastic IP is retained, so it
  # stays right across sessions; publish it only while the IP still matches.
  local qr="$KEA_ROOT/infra/aws/downloads/kea-energy-apk-qr.png" qr_ip=13.54.25.80
  if [[ "$PUBLIC_IP" == "$qr_ip" ]]; then
    kea_scp "$qr"
    kea_ssh 'sudo install -m 644 kea-energy-apk-qr.png /opt/kea/downloads/ && rm kea-energy-apk-qr.png'
    printf 'QR code: https://%s/download/kea-energy-apk-qr.png\n' "$PUBLIC_IP"
  else
    printf 'QR code not published: it encodes %s, this session is %s. Regenerate it (see infra/aws/README.md).\n' \
      "$qr_ip" "$PUBLIC_IP" >&2
  fi
}

step_install_apk() {
  kea_load_session "$SESSION_ID"
  cd "$KEA_ROOT/services/mobile"
  [[ -s android/app/build/outputs/apk/release/app-release.apk ]] || {
    echo 'Release APK missing; run make mobile to build it.' >&2
    exit 1
  }
  [[ "$(adb get-state)" == device ]] || { echo 'Connect and unlock the Android phone.' >&2; exit 1; }
  adb install -r android/app/build/outputs/apk/release/app-release.apk
}

step_db_tunnel() {
  [[ "$DB_LOCAL_PORT" =~ ^[0-9]+$ ]] && (( DB_LOCAL_PORT >= 1024 && DB_LOCAL_PORT <= 65535 )) || {
    echo 'DB_LOCAL_PORT must be an unused port from 1024 to 65535.' >&2
    exit 1
  }

  local ssh_host ssh_key db_host
  if [[ -n "$SSH_HOST$SSH_KEY$DB_HOST" ]]; then
    [[ -n "$SSH_HOST" && -n "$SSH_KEY" && -n "$DB_HOST" ]] || {
      echo 'For teammate access, set SSH_HOST, SSH_KEY and DB_HOST together.' >&2
      exit 1
    }
    [[ -f "$SSH_KEY" && ! -L "$SSH_KEY" ]] || {
      echo 'SSH_KEY must name an existing private-key file, not a symlink.' >&2
      exit 1
    }
    [[ "$DB_HOST" =~ ^[a-z0-9.-]+\.ap-southeast-2\.rds\.amazonaws\.com$ ]] || {
      echo 'DB_HOST must be a Sydney RDS endpoint.' >&2
      exit 1
    }
    ssh_host="$SSH_HOST"
    ssh_key="$SSH_KEY"
    db_host="$DB_HOST"
    printf 'Opening teammate tunnel through %s.\n' "$ssh_host"
    printf 'Connect the database client to 127.0.0.1:%s. Press Ctrl-C to close the tunnel.\n' "$DB_LOCAL_PORT"
    exec ssh -i "$ssh_key" -o ConnectTimeout=5 -o ExitOnForwardFailure=yes \
      -o ServerAliveInterval=30 -o StrictHostKeyChecking=accept-new -N \
      -L "127.0.0.1:$DB_LOCAL_PORT:$db_host:5432" "ec2-user@$ssh_host"
  fi

  if [[ -z "$SESSION_ID" ]]; then
    SESSION_ID="$(kea_current_session_id)"
  fi
  kea_load_session "$SESSION_ID"
  : "${PUBLIC_IP:?Run make apply-create first}"
  : "${DB_HOST:?Run make apply-create first}"
  printf 'Opening tunnel for session %s through %s.\n' "$SESSION_ID" "$PUBLIC_IP"
  printf 'Connect the database client to 127.0.0.1:%s. Press Ctrl-C to close the tunnel.\n' "$DB_LOCAL_PORT"
  exec ssh "${KEA_SSH[@]}" -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -N \
    -L "127.0.0.1:$DB_LOCAL_PORT:$DB_HOST:5432" "ec2-user@$PUBLIC_IP"
}

step_renew_cert() {
  kea_load_session "$SESSION_ID"
  kea_ssh 'sudo docker run --rm -p 80:80 -v /opt/kea/letsencrypt:/etc/letsencrypt -v /opt/kea/letsencrypt-lib:/var/lib/letsencrypt certbot/certbot:v5.8.0 renew'
  kea_ssh "sudo install -o 10001 -g 10001 -m 600 '/opt/kea/letsencrypt/live/$PUBLIC_IP/fullchain.pem' /opt/kea/certs/active/fullchain.pem && sudo install -o 10001 -g 10001 -m 600 '/opt/kea/letsencrypt/live/$PUBLIC_IP/privkey.pem' /opt/kea/certs/active/privkey.pem && sudo docker compose --env-file /opt/kea/runtime.env -f /opt/kea/compose.yml restart web"
  curl --fail --show-error "https://$PUBLIC_IP/api/live"
}

step_refresh_credentials() {
  kea_load_session "$SESSION_ID"
  kea_check_account
  [[ -s "$SESSION_DIR/runtime.env" ]] || { echo 'Runtime file missing.' >&2; exit 1; }
  python3 "$KEA_ROOT/infra/aws/scripts/runtime_credentials.py" "$SESSION_DIR/runtime.env" --refresh
  kea_ssh 'set -e; umask 077; cat > runtime.env; sudo install -o root -g root -m 600 runtime.env /opt/kea/runtime.env; rm runtime.env' < "$SESSION_DIR/runtime.env"
  kea_ssh 'sudo docker compose --env-file /opt/kea/runtime.env -f /opt/kea/compose.yml up -d --force-recreate api'
}

# The account cannot create IAM roles or users, so the API runs on the operator's
# four-hour SSO credentials. The LaunchAgent installed by credentials-timer runs
# this every 30 minutes; it refreshes only when under 45 minutes remain.
step_keep_credentials() {
  kea_load_session "$SESSION_ID"
  local timer="$KEA_ROOT/infra/aws/scripts/credentials_timer.py" status=0
  # 0 is due and 3 (NOT_DUE) is fresh. Anything else is a failed check, which
  # refreshes rather than passing for fresh credentials.
  python3 "$timer" due "$SESSION_DIR" || status=$?
  case "$status" in
    0) ;;
    3)
      printf '%s credentials still fresh\n' "$(date -u +%FT%TZ)"
      return 0
      ;;
    *)
      printf '%s due check failed (exit %s); refreshing anyway\n' "$(date -u +%FT%TZ)" "$status"
      python3 "$timer" notify "Kea AWS demo: the credential due check failed (exit $status), so the timer refreshed anyway. See $SESSION_DIR/keep-credentials.log."
      ;;
  esac
  printf '%s refreshing credentials\n' "$(date -u +%FT%TZ)"
  # A separate make, so the refresh keeps `set -e` and a failure stops it whole.
  local output
  if output="$(make -C "$KEA_ROOT/infra/aws" refresh-credentials SESSION_ID="$SESSION_ID" 2>&1)"; then
    printf '%s\n' "$output"
    return 0
  fi
  printf '%s\n' "$output"
  # The local export records expiry before SSH installs it. A failed upload
  # must not make the next timer run mistake remote credentials for fresh.
  rm -f -- "$SESSION_DIR/runtime.env.expires"
  # An expired CLI sign-in is the usual overnight failure. The browser still
  # holds the portal sign-in, so a fresh login approves itself; retry once.
  if grep -Eiq 'token from sso|sso session|sso login|sso token' <<<"$output"; then
    printf '%s signing in to AWS again\n' "$(date -u +%FT%TZ)"
    if python3 "$timer" login &&
        make -C "$KEA_ROOT/infra/aws" refresh-credentials SESSION_ID="$SESSION_ID"; then
      printf '%s refreshed after signing in again\n' "$(date -u +%FT%TZ)"
      return 0
    fi
    rm -f -- "$SESSION_DIR/runtime.env.expires"
  fi
  python3 "$timer" notify "Kea AWS demo credentials could not be refreshed. Run make -C infra/aws login, then make -C infra/aws refresh-credentials SESSION_ID=$SESSION_ID."
  exit 1
}

step_credentials_timer() {
  kea_load_session "$SESSION_ID"
  python3 "$KEA_ROOT/infra/aws/scripts/credentials_timer.py" install "$SESSION_ID" "$SESSION_DIR"
}

step_credentials_timer_stop() {
  kea_require_id "$SESSION_ID"
  python3 "$KEA_ROOT/infra/aws/scripts/credentials_timer.py" uninstall "$SESSION_ID"
}

step_destroy_plan() {
  kea_load_session "$SESSION_ID"
  kea_check_account
  [[ -s "$STATE" ]] || { echo 'Terraform state missing; do not destroy from an empty state.' >&2; exit 1; }
  terraform -chdir="$KEA_STACK" init -input=false -lockfile=readonly
  [[ -n "$(terraform -chdir="$KEA_STACK" state list -state="$STATE")" ]] || { echo 'No managed resources in state.' >&2; exit 1; }
  terraform -chdir="$KEA_STACK" plan -destroy -state="$STATE" -out="$SESSION_DIR/destroy.tfplan"
  terraform -chdir="$KEA_STACK" show -no-color "$SESSION_DIR/destroy.tfplan"
}

step_destroy_apply() {
  kea_load_session "$SESSION_ID"
  kea_check_account
  [[ -s "$STATE" && -f "$SESSION_DIR/destroy.tfplan" ]] || { echo 'Run destroy-plan with this session state first.' >&2; exit 1; }
  terraform -chdir="$KEA_STACK" apply -state="$STATE" "$SESSION_DIR/destroy.tfplan"
  terraform -chdir="$KEA_STACK" state list -state="$STATE" > "$SESSION_DIR/remaining-resources.txt"
  [[ ! -s "$SESSION_DIR/remaining-resources.txt" ]] || { echo 'Terraform still manages resources; keep the state.' >&2; exit 1; }
}

step_audit() {
  kea_load_session "$SESSION_ID"
  kea_check_account
  [[ -s "$STATE" ]] || { echo 'Terraform state missing; cannot complete audit.' >&2; exit 1; }
  [[ -z "$(terraform -chdir="$KEA_STACK" state list -state="$STATE")" ]] || { echo 'Terraform state still contains resources.' >&2; exit 1; }
  instances="$(aws ec2 describe-instances --region "$KEA_REGION" --filters "Name=tag:Project,Values=kea-energy" "Name=tag:Session,Values=$SESSION_ID" 'Name=instance-state-name,Values=pending,running,stopping,stopped' --query 'Reservations[].Instances[].InstanceId' --output text)"
  vpcs="$(aws ec2 describe-vpcs --region "$KEA_REGION" --filters "Name=tag:Project,Values=kea-energy" "Name=tag:Session,Values=$SESSION_ID" --query 'Vpcs[].VpcId' --output text)"
  groups="$(aws ec2 describe-security-groups --region "$KEA_REGION" --filters "Name=tag:Project,Values=kea-energy" "Name=tag:Session,Values=$SESSION_ID" --query 'SecurityGroups[].GroupId' --output text)"
  keys="$(aws ec2 describe-key-pairs --region "$KEA_REGION" --filters "Name=tag:Project,Values=kea-energy" "Name=tag:Session,Values=$SESSION_ID" --query 'KeyPairs[].KeyName' --output text)"
  databases="$(aws rds describe-db-instances --region "$KEA_REGION" --query "DBInstances[?DBInstanceIdentifier=='${DB_IDENTIFIER:-kea-energy-$SESSION_ID}'].DBInstanceIdentifier" --output text)"
  backups="$(aws rds describe-db-instance-automated-backups --region "$KEA_REGION" --query "DBInstanceAutomatedBackups[?DBInstanceIdentifier=='${DB_IDENTIFIER:-kea-energy-$SESSION_ID}'].DBInstanceIdentifier" --output text)"
  subnet_groups="$(aws rds describe-db-subnet-groups --region "$KEA_REGION" --query "DBSubnetGroups[?DBSubnetGroupName=='${DB_IDENTIFIER:-kea-energy-$SESSION_ID}'].DBSubnetGroupName" --output text)"
  connect="$(aws connect list-instances --region "$KEA_REGION" --query "InstanceSummaryList[?InstanceAlias=='${DB_IDENTIFIER:-kea-energy-$SESSION_ID}'].Id" --output text)"
  [[ -z "$instances$vpcs$groups$keys$databases$backups$subnet_groups$connect" ]] || { printf 'Resources remain: instances=%s vpcs=%s groups=%s keys=%s databases=%s backups=%s subnet_groups=%s connect=%s\n' "$instances" "$vpcs" "$groups" "$keys" "$databases" "$backups" "$subnet_groups" "$connect" >&2; exit 1; }
  if [[ -n "${INSTANCE_ID:-}" && ! -s "$SESSION_DIR/volume-ids.txt" ]]; then
    echo 'Root EBS volume ID was not recorded; check the Sydney EBS console before cleaning this session.' >&2
    exit 1
  fi
  if [[ -s "$SESSION_DIR/volume-ids.txt" ]]; then
    for volume in $(cat "$SESSION_DIR/volume-ids.txt"); do
      found="$(aws ec2 describe-volumes --region "$KEA_REGION" --filters "Name=volume-id,Values=$volume" --query 'Volumes[].VolumeId' --output text)"
      [[ -z "$found" ]] || { echo "EBS volume remains: $found" >&2; exit 1; }
    done
  fi
  if [[ -n "${TF_VAR_elastic_ip_allocation_id:-}" ]]; then
    kea_ip_details
    [[ "$KEA_IP_ALLOCATION_ID" == "$TF_VAR_elastic_ip_allocation_id" ]] || {
      echo 'Retained Elastic IP allocation changed; inspect it before cleaning this session.' >&2
      exit 1
    }
    local association
    association="$(aws ec2 describe-addresses --region "$KEA_REGION" \
      --allocation-ids "$KEA_IP_ALLOCATION_ID" --query 'Addresses[0].AssociationId' --output text)"
    [[ -z "$association" || "$association" == None ]] || {
      echo 'Retained Elastic IP is still associated; inspect it before cleaning this session.' >&2
      exit 1
    }
  fi
  printf 'Sydney audit clear for session %s.\n' "$SESSION_ID"
}

step_clean_session() {
  kea_require_id "$SESSION_ID"
  make -C "$KEA_ROOT/infra/aws" audit SESSION_ID="$SESSION_ID"
  kea_load_session "$SESSION_ID"
  [[ "$SESSION_DIR" == "$KEA_WORK/public-$SESSION_ID" ]] || exit 1
  rm -r -- "$SESSION_DIR"
  kea_clear_session_id "$SESSION_ID"
  printf 'Removed local session files; the separate database export was kept.\n'
}

step_deploy() {
  [[ "$SOURCE_PAUSED" == 1 ]] || { echo 'Pause local writes, then set SOURCE_PAUSED=1.' >&2; exit 1; }
  id="${SESSION_ID:-$(date -u +%Y%m%d%H%M%S)}"
  kea_require_id "$id"
  printf 'Deploying session %s. Keep this ID for teardown.\n' "$id"
  for step in login ip-allocate session export-db plan-create apply-create host cert images runtime restore verify metabase credentials-timer mobile publish-apk; do
    printf '\n==> %s\n' "$step"
    make -C "$KEA_ROOT/infra/aws" "$step" SESSION_ID="$id" SOURCE_PAUSED=1 || {
      printf 'Stopped at %s. Session %s files and any state were retained; inspect them before continuing.\n' "$step" "$id" >&2
      exit 1
    }
  done
  printf 'Deployment complete: %s. Run make aws-teardown when you decide to remove it.\n' "$id"
}

step_teardown() {
  if [[ -z "$SESSION_ID" ]]; then
    SESSION_ID="$(kea_current_session_id)"
    printf 'Using saved session ID %s for teardown.\n' "$SESSION_ID"
  fi
  kea_require_id "$SESSION_ID"
  kea_load_session "$SESSION_ID"
  [[ -s "$STATE" ]] || { echo 'Terraform state missing; teardown cannot proceed.' >&2; exit 1; }
  for step in login credentials-timer-stop destroy-plan destroy-apply audit clean-session; do
    printf '\n==> %s\n' "$step"
    make -C "$KEA_ROOT/infra/aws" "$step" SESSION_ID="$SESSION_ID" || {
      printf 'Teardown stopped at %s. Session %s state was retained.\n' "$step" "$SESSION_ID" >&2
      exit 1
    }
  done
  printf 'Teardown verified for session %s. Local export and any retained Elastic IP were kept.\n' "$SESSION_ID"
}

target="${1:?Supply a Make target name}"
function="step_${target//-/_}"
declare -F "$function" >/dev/null || { printf 'Unknown AWS target: %s\n' "$target" >&2; exit 2; }
"$function"
