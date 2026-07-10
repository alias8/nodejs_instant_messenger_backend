output "alb_dns_name" {
  value = aws_lb.main.dns_name
}

output "api_url" {
  value = "https://api.${var.domain_name}"
}

output "usera_url" {
  value = "https://usera.${var.domain_name}"
}

output "userb_url" {
  value = "https://userb.${var.domain_name}"
}

output "media_cloudfront_domain" {
  value = aws_cloudfront_distribution.media.domain_name
}

output "ecr_repository_url" {
  value = aws_ecr_repository.backend.repository_url
}

output "ecs_cluster_name" {
  value = aws_ecs_cluster.main.name
}

output "ecs_service_name" {
  value = aws_ecs_service.backend.name
}

output "ecs_task_definition_arn" {
  value = aws_ecs_task_definition.backend.arn
}

output "ecs_public_subnet_ids" {
  value = [aws_subnet.public_a.id, aws_subnet.public_b.id]
}

output "ecs_tasks_security_group_id" {
  value = aws_security_group.ecs_tasks.id
}

output "frontend_usera_bucket" {
  value = aws_s3_bucket.frontend_usera.bucket
}

output "frontend_userb_bucket" {
  value = aws_s3_bucket.frontend_userb.bucket
}

output "frontend_usera_cloudfront_distribution_id" {
  value = aws_cloudfront_distribution.frontend_usera.id
}

output "frontend_userb_cloudfront_distribution_id" {
  value = aws_cloudfront_distribution.frontend_userb.id
}
