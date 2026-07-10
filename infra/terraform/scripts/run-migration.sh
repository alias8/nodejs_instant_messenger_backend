#!/usr/bin/env bash
# One-off ECS task: same image/task definition as the running service, but
# with the container command overridden to run migrations instead of
# starting the server. RDS is in an isolated private subnet with no NAT, so
# this reuses the ECS tasks' existing network access instead of a bastion.
#
# Run this after any deploy that changes the Prisma schema. Requires the AWS
# CLI, jq, and to be run from infra/terraform/ (or pass TF_DIR).
set -euo pipefail

TF_DIR="${TF_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
cd "$TF_DIR"

CLUSTER=$(terraform output -raw ecs_cluster_name)
TASK_DEF=$(terraform output -raw ecs_task_definition_arn)
SUBNETS=$(terraform output -json ecs_public_subnet_ids | jq -c .)
SG=$(terraform output -raw ecs_tasks_security_group_id)

echo "Running 'npx prisma migrate deploy' as a one-off Fargate task..."
TASK_ARN=$(aws ecs run-task \
  --cluster "$CLUSTER" \
  --task-definition "$TASK_DEF" \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=$SUBNETS,securityGroups=[$SG],assignPublicIp=ENABLED}" \
  --overrides '{"containerOverrides":[{"name":"backend","command":["npx","prisma","migrate","deploy"]}]}' \
  --query 'tasks[0].taskArn' --output text)

echo "Task started: $TASK_ARN"
echo "Waiting for it to finish..."
aws ecs wait tasks-stopped --cluster "$CLUSTER" --tasks "$TASK_ARN"

EXIT_CODE=$(aws ecs describe-tasks --cluster "$CLUSTER" --tasks "$TASK_ARN" \
  --query 'tasks[0].containers[0].exitCode' --output text)

if [ "$EXIT_CODE" != "0" ]; then
  echo "Migration task exited with code $EXIT_CODE — check the CloudWatch Logs group for the backend service."
  exit 1
fi

echo "Migration completed successfully."
