#!/usr/bin/env bash
# Redeploy backend + migrations + both frontends after a code change, with
# the infra left as-is. If you only edited .tf files, use `terraform plan` /
# `apply` directly instead.
set -euo pipefail

TF_DIR="${TF_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
"$TF_DIR/scripts/deploy-app.sh"
