output "api_url" {
  value       = aws_apigatewayv2_api.main.api_endpoint
  description = "Base URL for both the React app and the mobile app. One API, one contract."
}

output "web_url" {
  value       = "https://${aws_cloudfront_distribution.web.domain_name}"
  description = "The React build. Also the only origin the API's CORS allows."
}

output "web_bucket" {
  value       = aws_s3_bucket.web.bucket
  description = "aws s3 sync services/web/dist/ s3://<this>/ --delete"
}

output "cloudfront_distribution_id" {
  value       = aws_cloudfront_distribution.web.id
  description = "Needed for the cache invalidation after a web deploy."
}

output "database_endpoint" {
  value       = aws_db_instance.main.endpoint
  sensitive   = true
  description = "Run `alembic upgrade head` against this before the first request."
}

output "estimated_monthly_cost_note" {
  value = <<-EOT
    ~$0 while the 12-month free tier lasts, then ~$15/month plus Bedrock usage
    (~$3 per 1,000 answers at current Sonnet rates and ~1.5k tokens per answer).

    The free tier is dated from ACCOUNT creation, not from this deploy — a course
    account may already be part-way through it. Check before assuming $0.

    The three things that would change this materially, none of which are here:
    a NAT Gateway ($32/mo), Aurora Serverless v2 ($43/mo idle), and CloudWatch log
    groups with the default never-expire retention.
  EOT
}
