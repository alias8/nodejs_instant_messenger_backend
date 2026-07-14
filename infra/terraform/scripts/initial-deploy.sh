#!/usr/bin/env bash
# First-ever deploy: initialize Terraform providers, then provision + deploy
# via restore-stack.sh. Requires infra/terraform/terraform.tfvars to already
# exist (copy from terraform.tfvars.example and set domain_name).
set -euo pipefail

TF_DIR="${TF_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
SCRIPT_DIR="$TF_DIR/scripts"
cd "$TF_DIR"

echo "Initializing Terraform..."
terraform init

"$SCRIPT_DIR/restore-stack.sh"
