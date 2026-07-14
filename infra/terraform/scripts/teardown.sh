#!/usr/bin/env bash
# Destroy the whole stack. Safe to do when idle: skip_final_snapshot,
# deletion_protection = false, and force_destroy/force_delete are set on
# everything, so this removes the stack without manual cleanup. The Route 53
# hosted zone isn't touched (it's a data source, not a managed resource).
set -euo pipefail

TF_DIR="${TF_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
cd "$TF_DIR"

terraform destroy -var-file=terraform.tfvars
