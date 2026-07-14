resource "random_id" "suffix" {
  byte_length = 4
}

data "aws_cloudfront_cache_policy" "caching_optimized" {
  name = "Managed-CachingOptimized"
}

# ---------------------------------------------------------------------------
# userA / userB static frontend sites
# ---------------------------------------------------------------------------

resource "aws_s3_bucket" "frontend_usera" {
  bucket        = "${var.project_name}-frontend-usera-${random_id.suffix.hex}"
  force_destroy = true
}

resource "aws_s3_bucket" "frontend_userb" {
  bucket        = "${var.project_name}-frontend-userb-${random_id.suffix.hex}"
  force_destroy = true
}

resource "aws_s3_bucket_public_access_block" "frontend_usera" {
  bucket                  = aws_s3_bucket.frontend_usera.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_public_access_block" "frontend_userb" {
  bucket                  = aws_s3_bucket.frontend_userb.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_cloudfront_origin_access_control" "frontend_usera" {
  name                              = "${var.project_name}-usera-oac"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_origin_access_control" "frontend_userb" {
  name                              = "${var.project_name}-userb-oac"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_distribution" "frontend_usera" {
  enabled             = true
  default_root_object = "index.html"
  aliases             = ["usera.${var.domain_name}"]

  origin {
    domain_name              = aws_s3_bucket.frontend_usera.bucket_regional_domain_name
    origin_id                = "s3-usera"
    origin_access_control_id = aws_cloudfront_origin_access_control.frontend_usera.id
  }

  default_cache_behavior {
    target_origin_id       = "s3-usera"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    cache_policy_id        = data.aws_cloudfront_cache_policy.caching_optimized.id
  }

  # SPA fallback: BrowserRouter client-side routes (e.g. /chat) have no
  # matching S3 object, so a 403/404 at the origin must still serve
  # index.html with a 200 so React Router can take over client-side.
  custom_error_response {
    error_code         = 403
    response_code      = 200
    response_page_path = "/index.html"
  }
  custom_error_response {
    error_code         = 404
    response_code      = 200
    response_page_path = "/index.html"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn = aws_acm_certificate.main.arn
    ssl_support_method  = "sni-only"
  }

  depends_on = [aws_acm_certificate_validation.main]
}

resource "aws_cloudfront_distribution" "frontend_userb" {
  enabled             = true
  default_root_object = "index.html"
  aliases             = ["userb.${var.domain_name}"]

  origin {
    domain_name              = aws_s3_bucket.frontend_userb.bucket_regional_domain_name
    origin_id                = "s3-userb"
    origin_access_control_id = aws_cloudfront_origin_access_control.frontend_userb.id
  }

  default_cache_behavior {
    target_origin_id       = "s3-userb"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    cache_policy_id        = data.aws_cloudfront_cache_policy.caching_optimized.id
  }

  custom_error_response {
    error_code         = 403
    response_code      = 200
    response_page_path = "/index.html"
  }
  custom_error_response {
    error_code         = 404
    response_code      = 200
    response_page_path = "/index.html"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn = aws_acm_certificate.main.arn
    ssl_support_method  = "sni-only"
  }

  depends_on = [aws_acm_certificate_validation.main]
}

# Standard OAC bucket policy pattern: only this specific CloudFront
# distribution (by ARN) may read from its bucket.
data "aws_iam_policy_document" "frontend_usera_bucket" {
  statement {
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.frontend_usera.arn}/*"]
    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.frontend_usera.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "frontend_usera" {
  bucket = aws_s3_bucket.frontend_usera.id
  policy = data.aws_iam_policy_document.frontend_usera_bucket.json
}

data "aws_iam_policy_document" "frontend_userb_bucket" {
  statement {
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.frontend_userb.arn}/*"]
    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.frontend_userb.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "frontend_userb" {
  bucket = aws_s3_bucket.frontend_userb.id
  policy = data.aws_iam_policy_document.frontend_userb_bucket.json
}

# ---------------------------------------------------------------------------
# Media upload bucket — private, CloudFront signed URLs (matches media.ts)
# ---------------------------------------------------------------------------

resource "aws_s3_bucket" "media" {
  bucket        = "${var.project_name}-media-${random_id.suffix.hex}"
  force_destroy = true
}

resource "aws_s3_bucket_public_access_block" "media" {
  bucket                  = aws_s3_bucket.media.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# The frontend uploads files with a browser PUT straight to this bucket via a
# presigned URL (see media.ts) — reads go through CloudFront instead, but the
# upload path needs its own CORS rule or the browser's preflight fails.
resource "aws_s3_bucket_cors_configuration" "media" {
  bucket = aws_s3_bucket.media.id

  cors_rule {
    allowed_methods = ["PUT"]
    allowed_origins = ["https://usera.${var.domain_name}", "https://userb.${var.domain_name}"]
    allowed_headers = ["*"]
    expose_headers  = ["ETag"]
    max_age_seconds = 3000
  }
}

resource "tls_private_key" "cloudfront_signer" {
  algorithm = "RSA"
  rsa_bits  = 2048
}

resource "aws_cloudfront_public_key" "media" {
  name        = "${var.project_name}-media-signer"
  encoded_key = tls_private_key.cloudfront_signer.public_key_pem
}

resource "aws_cloudfront_key_group" "media" {
  name  = "${var.project_name}-media-key-group"
  items = [aws_cloudfront_public_key.media.id]
}

resource "aws_cloudfront_origin_access_control" "media" {
  name                              = "${var.project_name}-media-oac"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_distribution" "media" {
  enabled = true

  origin {
    domain_name              = aws_s3_bucket.media.bucket_regional_domain_name
    origin_id                = "s3-media"
    origin_access_control_id = aws_cloudfront_origin_access_control.media.id
  }

  default_cache_behavior {
    target_origin_id       = "s3-media"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    cache_policy_id        = data.aws_cloudfront_cache_policy.caching_optimized.id
    trusted_key_groups     = [aws_cloudfront_key_group.media.id] # enforces signed URLs
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  # No custom domain needed — the backend only ever constructs URLs against
  # CLOUDFRONT_DOMAIN (the *.cloudfront.net domain works fine here), which
  # also avoids consuming another SAN on the shared cert.
  viewer_certificate {
    cloudfront_default_certificate = true
  }
}

data "aws_iam_policy_document" "media_bucket" {
  statement {
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.media.arn}/*"]
    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.media.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "media" {
  bucket = aws_s3_bucket.media.id
  policy = data.aws_iam_policy_document.media_bucket.json
}

resource "aws_ssm_parameter" "cloudfront_private_key" {
  name  = "/${var.project_name}/cloudfront_private_key"
  type  = "SecureString"
  value = tls_private_key.cloudfront_signer.private_key_pem
}
