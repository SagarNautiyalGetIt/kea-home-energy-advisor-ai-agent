# Kea Energy — cost-optimised AWS deployment. See docs/adr/0010-aws-deployment.md.
#
# The design goal is "runs at ~$0 on the free tier, and the bill is legible when it is
# not". Three things are deliberately ABSENT and each one is the expensive default:
#
#   NAT Gateway            $32/month before a byte moves. Lambda runs outside the VPC.
#   Aurora Serverless v2   floors at 0.5 ACU ~ $43/month idle. "Serverless" is not "zero".
#   Secrets Manager        $0.40/secret/month. Parameter Store Standard is free.
#
# Everything here is a basic service on purpose. Nothing needs a support plan to debug.

terraform {
  required_version = ">= 1.6"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project = "kea-energy"
      Team    = "HAKAS"
      Course  = "CS778-S2-2026"
      # Every resource carries this so a runaway cost can be traced to a line item, and
      # so `terraform destroy` leaving something behind is visible in the console.
      Managed = "terraform"
    }
  }
}

locals {
  name = "${var.project}-${var.environment}"

  # Sydney. NZ data residency is a pitch point, and Bedrock model availability differs
  # by region — verify the model is actually served here before deploying.
  bedrock_model = var.bedrock_model
}

# ─────────────────────────── networking ───────────────────────────
#
# Minimal by design. Public subnets only, because there is no NAT Gateway and therefore
# nothing that could reach the internet from a private one. RDS sits in these subnets
# with a security group that permits exactly one source.

resource "aws_vpc" "main" {
  cidr_block           = "10.20.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags                 = { Name = local.name }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = local.name }
}

# Two AZs because RDS requires a subnet group spanning at least two, even for a
# single-AZ instance. This costs nothing — it is a constraint, not a redundancy choice.
resource "aws_subnet" "public" {
  count                   = 2
  vpc_id                  = aws_vpc.main.id
  cidr_block              = cidrsubnet(aws_vpc.main.cidr_block, 8, count.index)
  availability_zone       = data.aws_availability_zones.available.names[count.index]
  map_public_ip_on_launch = true
  tags                    = { Name = "${local.name}-public-${count.index}" }
}

data "aws_availability_zones" "available" {
  state = "available"
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }
  tags = { Name = "${local.name}-public" }
}

resource "aws_route_table_association" "public" {
  count          = length(aws_subnet.public)
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

# ─────────────────────────── database ───────────────────────────

resource "aws_security_group" "db" {
  name        = "${local.name}-db"
  description = "Postgres, reachable only from the allow-listed CIDRs"
  vpc_id      = aws_vpc.main.id

  # The trade documented in ADR-0010: the Lambda is outside the VPC, so access is
  # controlled here rather than by network placement. `var.db_allowed_cidrs` must be
  # set to something narrower than the world before this holds real data — the
  # variable's validation block refuses 0.0.0.0/0 outright.
  ingress {
    description = "PostgreSQL"
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = var.db_allowed_cidrs
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_db_subnet_group" "main" {
  name       = local.name
  subnet_ids = aws_subnet.public[*].id
}

resource "aws_db_instance" "main" {
  identifier     = local.name
  engine         = "postgres"
  engine_version = "16"

  # Graviton. ~20% cheaper than t3.micro at the same performance, and free-tier eligible.
  instance_class = "db.t4g.micro"

  allocated_storage = 20
  storage_type      = "gp3"
  storage_encrypted = true

  db_name  = "kea"
  username = "kea"
  password = var.db_password

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.db.id]
  publicly_accessible    = true

  # Single-AZ. One instance, no failover. Correct for synthetic course data and
  # explicitly wrong for a real retailer — see ADR-0010's consequences.
  multi_az = false

  backup_retention_period = 7
  skip_final_snapshot     = var.environment != "prod"
  deletion_protection     = var.environment == "prod"

  # Off. Performance Insights beyond 7 days and enhanced monitoring both bill, and
  # neither tells us anything CloudWatch's free metrics do not at this scale.
  performance_insights_enabled = false
  monitoring_interval          = 0

  auto_minor_version_upgrade = true
  apply_immediately          = var.environment != "prod"
}

# ─────────────────────────── secrets ───────────────────────────
#
# Parameter Store Standard, not Secrets Manager. Free versus $0.40/secret/month, and the
# only thing Secrets Manager adds that we would use is rotation, which we do not do.

resource "aws_ssm_parameter" "database_url" {
  name  = "/${local.name}/KEA_DATABASE_URL"
  type  = "SecureString"
  value = "postgresql+asyncpg://kea:${var.db_password}@${aws_db_instance.main.endpoint}/kea"
}

resource "aws_ssm_parameter" "gateway_secrets" {
  # The third-party gateway credentials — Resend, Twilio. Empty by default so a deploy
  # succeeds before anyone has an account, and the gateways fall back to the file sink
  # with a warning rather than the API failing to start.
  for_each = var.gateway_secrets

  name  = "/${local.name}/${each.key}"
  type  = "SecureString"
  value = each.value
}

# ─────────────────────────── api ───────────────────────────

data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "api" {
  name               = "${local.name}-api"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_iam_role_policy_attachment" "api_logs" {
  role       = aws_iam_role.api.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

data "aws_iam_policy_document" "api" {
  # Bedrock, scoped to the one model we invoke. A wildcard here would let a compromised
  # function invoke every model in the account, including the expensive ones.
  statement {
    sid       = "InvokeNarrationModel"
    actions   = ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"]
    resources = ["arn:aws:bedrock:${var.region}::foundation-model/${local.bedrock_model}"]
  }

  statement {
    sid       = "ReadOwnParameters"
    actions   = ["ssm:GetParameter", "ssm:GetParameters", "ssm:GetParametersByPath"]
    resources = ["arn:aws:ssm:${var.region}:*:parameter/${local.name}/*"]
  }

  statement {
    sid       = "DecryptParameters"
    actions   = ["kms:Decrypt"]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["ssm.${var.region}.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "api" {
  role   = aws_iam_role.api.id
  policy = data.aws_iam_policy_document.api.json
}

resource "aws_lambda_function" "api" {
  function_name = "${local.name}-api"
  role          = aws_iam_role.api.arn

  # Container image rather than a zip: the dependency set (asyncpg, sqlalchemy, the
  # anthropic SDK) is comfortably over the 250 MB unzipped limit for layers.
  package_type = "Image"
  image_uri    = var.api_image_uri

  # 1024 MB is not about memory. Lambda scales CPU with memory, and at 512 MB the FastAPI
  # cold start roughly doubles — so the larger size is *cheaper per request* despite the
  # higher per-ms rate. Measured, not assumed; re-measure if the import graph changes.
  memory_size = 1024
  timeout     = 30

  environment {
    variables = {
      KEA_PROVIDER      = "bedrock"
      KEA_BEDROCK_MODEL = local.bedrock_model
      KEA_PERSIST       = "1"
      KEA_ALERTS_ENABLED = "1"
      KEA_EMAIL_BACKEND = var.email_backend
      KEA_SMS_BACKEND   = var.sms_backend
      KEA_VOICE_BACKEND = var.voice_backend
      KEA_CORS_ORIGINS  = "https://${aws_cloudfront_distribution.web.domain_name}"
      # Never the demo logins. This flag hands out passwords on an endpoint, and it is
      # acceptable only against synthetic accounts on a laptop.
      KEA_DEMO_LOGINS = "0"
      KEA_SSM_PREFIX  = "/${local.name}"
    }
  }
}

resource "aws_cloudwatch_log_group" "api" {
  name = "/aws/lambda/${aws_lambda_function.api.function_name}"

  # The actual cost lever. CloudWatch's default is "never expire", which is how a $0
  # project quietly becomes a $20/month one after a semester of logs.
  retention_in_days = 7
}

resource "aws_apigatewayv2_api" "main" {
  name          = local.name
  protocol_type = "HTTP"

  # HTTP API, not REST API: ~70% cheaper per request, and everything we use it for is
  # proxying. FastAPI already does the validation REST API would add.
  cors_configuration {
    allow_origins = ["https://${aws_cloudfront_distribution.web.domain_name}"]
    allow_methods = ["GET", "POST", "PUT", "OPTIONS"]
    allow_headers = ["content-type", "authorization"]
    max_age       = 300
  }
}

resource "aws_apigatewayv2_integration" "api" {
  api_id                 = aws_apigatewayv2_api.main.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.api.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "api" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "$default"
  target    = "integrations/${aws_apigatewayv2_integration.api.id}"
}

resource "aws_apigatewayv2_stage" "api" {
  api_id      = aws_apigatewayv2_api.main.id
  name        = "$default"
  auto_deploy = true

  # Throttling is a cost control as much as an availability one: an unthrottled public
  # endpoint in front of a paid model is an unbounded bill.
  default_route_settings {
    throttling_burst_limit = 50
    throttling_rate_limit  = 20
  }
}

resource "aws_lambda_permission" "api_gateway" {
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.main.execution_arn}/*/*"
}

# ─────────────────────────── scheduled bill-shock evaluation ───────────────────────────
#
# `GET /bill-shock` used to dispatch alerts as a side effect of the dashboard polling it,
# which made alerting depend on somebody having the page open. This is the proactive half
# of a proactive product; it cannot be driven by a browser.
#
# Hourly rather than daily because it also releases alerts deferred by a customer's quiet
# hours, and a daily job would hold a 9pm text until the following morning's run.

resource "aws_lambda_function" "evaluator" {
  function_name = "${local.name}-evaluator"
  role          = aws_iam_role.api.arn
  package_type  = "Image"
  image_uri     = var.api_image_uri

  image_config {
    command = ["app.jobs.evaluate_bill_shock.handler"]
  }

  memory_size = 1024
  timeout     = 300

  environment {
    variables = {
      KEA_PROVIDER       = "bedrock"
      KEA_PERSIST        = "1"
      KEA_ALERTS_ENABLED = "1"
      KEA_EMAIL_BACKEND  = var.email_backend
      KEA_SMS_BACKEND    = var.sms_backend
      KEA_VOICE_BACKEND  = var.voice_backend
      KEA_SSM_PREFIX     = "/${local.name}"
    }
  }
}

resource "aws_cloudwatch_log_group" "evaluator" {
  name              = "/aws/lambda/${aws_lambda_function.evaluator.function_name}"
  retention_in_days = 7
}

resource "aws_scheduler_schedule" "bill_shock" {
  name                         = "${local.name}-bill-shock"
  schedule_expression          = "rate(1 hour)"
  schedule_expression_timezone = "Pacific/Auckland"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_lambda_function.evaluator.arn
    role_arn = aws_iam_role.scheduler.arn
  }
}

resource "aws_iam_role" "scheduler" {
  name = "${local.name}-scheduler"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "scheduler.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy" "scheduler" {
  role = aws_iam_role.scheduler.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = "lambda:InvokeFunction"
      Resource = aws_lambda_function.evaluator.arn
    }]
  })
}

# ─────────────────────────── web ───────────────────────────

resource "aws_s3_bucket" "web" {
  bucket = "${local.name}-web"
}

resource "aws_s3_bucket_public_access_block" "web" {
  bucket                  = aws_s3_bucket.web.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Origin Access Control, not a public bucket and not the deprecated OAI. The bucket is
# never directly readable; only CloudFront can fetch from it.
resource "aws_cloudfront_origin_access_control" "web" {
  name                              = "${local.name}-web"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_distribution" "web" {
  enabled             = true
  default_root_object = "index.html"

  # North America + Europe only would be cheaper, but the customers are in New Zealand.
  # PriceClass_All is the correct choice for a product whose users are all in ap-*.
  price_class = "PriceClass_All"

  origin {
    domain_name              = aws_s3_bucket.web.bucket_regional_domain_name
    origin_id                = "s3-web"
    origin_access_control_id = aws_cloudfront_origin_access_control.web.id
  }

  default_cache_behavior {
    target_origin_id       = "s3-web"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true
    # Managed-CachingOptimized.
    cache_policy_id = "658327ea-f89d-4fab-a63d-7e88639e58f6"
  }

  # A single-page app serves index.html for every unmatched path. Without these the React
  # router 403s on a deep link, which is only ever discovered by someone sharing a URL.
  dynamic "custom_error_response" {
    for_each = [403, 404]
    content {
      error_code         = custom_error_response.value
      response_code      = 200
      response_page_path = "/index.html"
    }
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }
}

data "aws_iam_policy_document" "web_bucket" {
  statement {
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.web.arn}/*"]
    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.web.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "web" {
  bucket = aws_s3_bucket.web.id
  policy = data.aws_iam_policy_document.web_bucket.json
}

# ─────────────────────────── cost guard ───────────────────────────
#
# Not optional on a shared course account. The failure this prevents is discovering the
# spend at the end of the month, when it is already spent.

resource "aws_budgets_budget" "monthly" {
  name         = "${local.name}-monthly"
  budget_type  = "COST"
  limit_amount = var.monthly_budget_usd
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  # 80% actual, and 100% *forecast* — the forecast alarm is the one that arrives while
  # there is still time to do something about it.
  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = var.budget_alert_emails
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = var.budget_alert_emails
  }
}
