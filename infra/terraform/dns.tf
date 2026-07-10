# Assumes you've already registered the domain manually via the Route 53
# console — this just references the resulting hosted zone.
data "aws_route53_zone" "main" {
  name         = var.domain_name
  private_zone = false
}

# One certificate covers the ALB (api subdomain) and both CloudFront
# distributions (usera/userb subdomains) — us-east-1 is required for
# CloudFront regardless, and since the whole stack is in us-east-1 anyway,
# the ALB's listener can use this same cert with no second provider alias.
resource "aws_acm_certificate" "main" {
  domain_name               = "api.${var.domain_name}"
  subject_alternative_names = ["usera.${var.domain_name}", "userb.${var.domain_name}"]
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "cert_validation" {
  for_each = {
    for dvo in aws_acm_certificate.main.domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  }

  zone_id = data.aws_route53_zone.main.zone_id
  name    = each.value.name
  type    = each.value.type
  ttl     = 60
  records = [each.value.record]
}

resource "aws_acm_certificate_validation" "main" {
  certificate_arn         = aws_acm_certificate.main.arn
  validation_record_fqdns = [for r in aws_route53_record.cert_validation : r.fqdn]
}

resource "aws_route53_record" "api" {
  zone_id = data.aws_route53_zone.main.zone_id
  name    = "api.${var.domain_name}"
  type    = "A"

  alias {
    name                   = aws_lb.main.dns_name
    zone_id                = aws_lb.main.zone_id
    evaluate_target_health = true
  }
}

resource "aws_route53_record" "usera" {
  zone_id = data.aws_route53_zone.main.zone_id
  name    = "usera.${var.domain_name}"
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.frontend_usera.domain_name
    zone_id                = aws_cloudfront_distribution.frontend_usera.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "userb" {
  zone_id = data.aws_route53_zone.main.zone_id
  name    = "userb.${var.domain_name}"
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.frontend_userb.domain_name
    zone_id                = aws_cloudfront_distribution.frontend_userb.hosted_zone_id
    evaluate_target_health = false
  }
}
