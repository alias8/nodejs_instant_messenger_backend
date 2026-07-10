#!/usr/bin/env bash
# Build the backend Docker image, push it to ECR, and force the ECS service
# to redeploy with the new image. Run from anywhere; paths are resolved
# relative to this script.
set -euo pipefail

TF_DIR="${TF_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
BACKEND_DIR="${BACKEND_DIR:-$(cd "$TF_DIR/../.." && pwd)}"
cd "$TF_DIR"

REGION=$(terraform output -raw ecr_repository_url | cut -d'.' -f4)
ECR_URL=$(terraform output -raw ecr_repository_url)
CLUSTER=$(terraform output -raw ecs_cluster_name)
SERVICE=$(terraform output -raw ecs_service_name)

echo "Logging in to ECR..."
aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$ECR_URL"

echo "Building image from $BACKEND_DIR..."
docker build -t "$ECR_URL:latest" "$BACKEND_DIR"

echo "Pushing to $ECR_URL:latest..."
docker push "$ECR_URL:latest"

echo "Forcing a new deployment of $SERVICE on $CLUSTER..."
aws ecs update-service --cluster "$CLUSTER" --service "$SERVICE" --force-new-deployment >/dev/null

echo "Deployment triggered. Watch it with:"
echo "  aws ecs describe-services --cluster $CLUSTER --services $SERVICE --query 'services[0].deployments'"
