#!/usr/bin/env bash
# Build both frontend role deployments and sync them to their S3 buckets,
# then invalidate each CloudFront distribution so the new build is served
# immediately instead of waiting out the cache TTL.
#
# Requires FRONTEND_DIR to point at the instant_messenger_frontend checkout
# (sibling repo to this one) and VITE_API_BASE_URL to be set to the deployed
# backend's URL (e.g. https://api.your-domain.com).
set -euo pipefail

TF_DIR="${TF_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
FRONTEND_DIR="${FRONTEND_DIR:?Set FRONTEND_DIR to the instant_messenger_frontend checkout path}"
API_BASE_URL="${VITE_API_BASE_URL:?Set VITE_API_BASE_URL to the deployed backend URL, e.g. https://api.your-domain.com}"
cd "$TF_DIR"

USERA_BUCKET=$(terraform output -raw frontend_usera_bucket)
USERB_BUCKET=$(terraform output -raw frontend_userb_bucket)
USERA_DIST_ID=$(terraform output -raw frontend_usera_cloudfront_distribution_id)
USERB_DIST_ID=$(terraform output -raw frontend_userb_cloudfront_distribution_id)

pushd "$FRONTEND_DIR" >/dev/null

echo "Building userA..."
VITE_API_BASE_URL="$API_BASE_URL" npm run build:userA

echo "Building userB..."
VITE_API_BASE_URL="$API_BASE_URL" npm run build:userB

echo "Syncing dist/ -> s3://$USERA_BUCKET ..."
aws s3 sync dist/ "s3://$USERA_BUCKET" --delete

echo "Syncing dist-userB/ -> s3://$USERB_BUCKET ..."
aws s3 sync dist-userB/ "s3://$USERB_BUCKET" --delete

popd >/dev/null

echo "Invalidating CloudFront caches..."
aws cloudfront create-invalidation --distribution-id "$USERA_DIST_ID" --paths '/*' >/dev/null
aws cloudfront create-invalidation --distribution-id "$USERB_DIST_ID" --paths '/*' >/dev/null

echo "Frontend deploy complete."
