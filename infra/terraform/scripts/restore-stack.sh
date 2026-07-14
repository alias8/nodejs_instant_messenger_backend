#!/usr/bin/env bash
# Recreate the whole stack after a `terraform destroy` and deploy the app
# into it: terraform apply, then deploy-app.sh (backend, migrations, both
# frontends).
set -euo pipefail

TF_DIR="${TF_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
SCRIPT_DIR="$TF_DIR/scripts"
cd "$TF_DIR"

echo "Applying Terraform config..."
terraform apply -var-file=terraform.tfvars

"$SCRIPT_DIR/deploy-app.sh"
