# database_url and cloudfront_private_key live in rds.tf / s3-cloudfront.tf,
# colocated with the resources they're derived from. cookie_secret has no
# single obvious owning resource, so it lives here.

resource "random_password" "cookie_secret" {
  length  = 32
  special = false
}

resource "aws_ssm_parameter" "cookie_secret" {
  name  = "/${var.project_name}/cookie_secret"
  type  = "SecureString"
  value = random_password.cookie_secret.result
}
