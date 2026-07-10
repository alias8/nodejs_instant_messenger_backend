variable "domain_name" {
  description = "Registrable domain you've already registered manually (e.g. via Route 53 console), with an existing public hosted zone. Subdomains api/usera/userb are managed under this."
  type        = string
}

variable "aws_region" {
  description = "Single region for the whole stack (CloudFront/ACM already require us-east-1 regardless, so everything else lives here too to avoid a second provider alias)."
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Short name used as a prefix/tag for all resources."
  type        = string
  default     = "instant-messenger"
}
