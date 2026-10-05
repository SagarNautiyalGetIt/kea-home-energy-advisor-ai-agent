#!/bin/bash
set -euxo pipefail

dnf install -y docker
systemctl enable --now docker
mkdir -p /opt/kea /opt/kea/certs
chmod 700 /opt/kea /opt/kea/certs
