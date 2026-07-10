resource "aws_ecs_cluster" "main" {
  name = "${var.project_name}-cluster"
}

resource "aws_cloudwatch_log_group" "backend" {
  name              = "/ecs/${var.project_name}-backend"
  retention_in_days = 3 # cheap, this is a throwaway project
}

resource "aws_ecs_task_definition" "backend" {
  family                   = "${var.project_name}-backend"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "512"  # 0.5 vCPU
  memory                   = "1024" # 1 GB
  execution_role_arn       = aws_iam_role.ecs_execution_role.arn
  task_role_arn            = aws_iam_role.ecs_task_role.arn

  container_definitions = jsonencode([
    {
      name      = "backend"
      image     = "${aws_ecr_repository.backend.repository_url}:latest"
      essential = true
      portMappings = [
        { containerPort = 3000, protocol = "tcp" },
      ]

      # Plain, non-sensitive config — bucket names/CF domains/key-pair-ids
      # aren't secrets, so these skip the SSM round-trip.
      environment = [
        { name = "NODE_ENV", value = "production" },
        { name = "PORT", value = "3000" },
        { name = "S3_BUCKET_NAME", value = aws_s3_bucket.media.bucket },
        { name = "CLOUDFRONT_DOMAIN", value = aws_cloudfront_distribution.media.domain_name },
        { name = "CLOUDFRONT_KEY_PAIR_ID", value = aws_cloudfront_public_key.media.id },
        { name = "REDIS_URL", value = "redis://${aws_elasticache_cluster.redis.cache_nodes[0].address}:6379" },
        { name = "CORS_ORIGINS", value = "https://usera.${var.domain_name},https://userb.${var.domain_name}" },
      ]

      # Actual secrets — SSM SecureString, injected at container start.
      secrets = [
        { name = "DATABASE_URL", valueFrom = aws_ssm_parameter.database_url.arn },
        { name = "COOKIE_SECRET", valueFrom = aws_ssm_parameter.cookie_secret.arn },
        { name = "CLOUDFRONT_PRIVATE_KEY", valueFrom = aws_ssm_parameter.cloudfront_private_key.arn },
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.backend.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "backend"
        }
      }
    }
  ])
}

resource "aws_ecs_service" "backend" {
  name            = "${var.project_name}-backend"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.backend.arn
  # 2 tasks deliberately, not 1 — this is what proves the Redis pub/sub
  # cross-instance message fan-out for real in the deployed environment.
  desired_count = 2
  launch_type   = "FARGATE"

  network_configuration {
    subnets          = [aws_subnet.public_a.id, aws_subnet.public_b.id]
    security_groups  = [aws_security_group.ecs_tasks.id]
    assign_public_ip = true
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.backend.arn
    container_name   = "backend"
    container_port   = 3000
  }

  depends_on = [aws_lb_listener.https]
}
