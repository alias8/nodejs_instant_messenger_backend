#!/usr/bin/env bash
# Deploy the app into already-provisioned infrastructure: backend image,
# Prisma migrations, then both frontends. Assumes `terraform apply` has
# already run (infra exists and outputs are populated).
#
# Requires FRONTEND_DIR to point at the instant_messenger_frontend checkout
# (defaults to the sibling repo path used in this project's CLAUDE.md).
set -euo pipefail

TF_DIR="${TF_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
SCRIPT_DIR="$TF_DIR/scripts"
FRONTEND_DIR="${FRONTEND_DIR:-$TF_DIR/../../../instant_messenger_frontend}"
cd "$TF_DIR"

echo "Building + pushing the backend image, rolling out the ECS service..."
"$SCRIPT_DIR/deploy-backend.sh"

echo "Applying Prisma migrations against RDS..."
"$SCRIPT_DIR/run-migration.sh"

API_URL=$(terraform output -raw api_url)
echo "Building + deploying both frontends against $API_URL..."
FRONTEND_DIR="$FRONTEND_DIR" VITE_API_BASE_URL="$API_URL" "$SCRIPT_DIR/deploy-frontend.sh"

echo "App deployed."
echo "  API:   $API_URL"
echo "  userA: $(terraform output -raw usera_url)"
echo "  userB: $(terraform output -raw userb_url)"
