#!/bin/bash
set -euo pipefail

cat >/etc/systemd/system/kea-energy-evaluator.service <<'EOF'
[Unit]
Description=Evaluate Kea Energy bill-shock alerts once
Requires=docker.service
After=docker.service
[Service]
Type=oneshot
ExecStart=/usr/bin/flock -n /run/kea-energy-evaluator.lock /usr/bin/docker compose --env-file /opt/kea/runtime.env -f /opt/kea/compose.yml --profile jobs run --rm evaluator
EOF

cat >/etc/systemd/system/kea-energy-evaluator.timer <<'EOF'
[Unit]
Description=Run Kea Energy bill-shock evaluation hourly
[Timer]
OnCalendar=hourly
Persistent=false
Unit=kea-energy-evaluator.service
[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now kea-energy-evaluator.timer
