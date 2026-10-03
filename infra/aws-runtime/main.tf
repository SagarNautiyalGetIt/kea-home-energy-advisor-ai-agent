terraform {
  required_version = ">= 1.6"
  required_providers {
    aws     = { source = "hashicorp/aws", version = "~> 5.0" }
    archive = { source = "hashicorp/archive", version = "~> 2.7" }
  }
}
provider "aws" { region = var.region }
data "aws_caller_identity" "team" {}
data "aws_ssm_parameter" "ami" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64"
}

resource "aws_security_group" "load_balancer" {
  name_prefix = "${var.name}-tls-"
  vpc_id      = var.vpc_id
  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  egress {
    from_port   = 8000
    to_port     = 8000
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
}
resource "aws_security_group" "runtime" {
  name_prefix = "${var.name}-runtime-"
  vpc_id      = var.vpc_id
  ingress {
    from_port       = 8000
    to_port         = 8000
    protocol        = "tcp"
    security_groups = [aws_security_group.load_balancer.id]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}
resource "aws_iam_role" "runtime" {
  name = "${var.name}-runtime"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{
    Effect = "Allow", Principal = { Service = "ec2.amazonaws.com" }, Action = "sts:AssumeRole"
  }] })
}
resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.runtime.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}
resource "aws_iam_role_policy" "runtime" {
  role = aws_iam_role.runtime.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = ["ssm:GetParametersByPath"], Resource = "arn:aws:ssm:${var.region}:${data.aws_caller_identity.team.account_id}:parameter${var.ssm_prefix}/*" },
    { Effect = "Allow", Action = ["ecr:GetAuthorizationToken"], Resource = "*" },
    { Effect = "Allow", Action = ["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer", "ecr:BatchCheckLayerAvailability"], Resource = var.ecr_repository_arn },
    { Effect = "Allow", Action = ["ses:SendEmail"], Resource = aws_sesv2_email_identity.sender.arn },
    { Effect = "Allow", Action = ["ses:GetAccount", "sns:GetSMSAttributes"], Resource = "*" },
    { Effect = "Allow", Action = ["connect:DescribeContactFlow"], Resource = "${var.connect_instance_arn}/contact-flow/*" },
    { Effect = "Allow", Action = ["s3:ListBucket"], Resource = aws_s3_bucket.prompts.arn },
    # Direct SMS Publish does not support a topic resource ARN. Opt-out is read-only.
    { Effect = "Allow", Action = ["sns:Publish", "sns:CheckIfPhoneNumberIsOptedOut"], Resource = "*" },
    { Effect = "Allow", Action = ["connect:StartOutboundVoiceContact"], Resource = "${var.connect_instance_arn}/contact/*" },
    { Effect = "Allow", Action = ["s3:GetObject", "s3:PutObject"], Resource = "${aws_s3_bucket.prompts.arn}/notices/*" }
  ] })
}
resource "aws_iam_instance_profile" "runtime" { role = aws_iam_role.runtime.name }
resource "aws_instance" "runtime" {
  ami                         = data.aws_ssm_parameter.ami.value
  instance_type               = var.instance_type
  subnet_id                   = var.subnet_ids[0]
  associate_public_ip_address = true
  vpc_security_group_ids      = [aws_security_group.runtime.id]
  iam_instance_profile        = aws_iam_instance_profile.runtime.name
  metadata_options {
    http_tokens                 = "required"
    http_put_response_hop_limit = 2
  }
  root_block_device {
    encrypted   = true
    volume_size = 20
  }
  user_data = templatefile("${path.module}/runtime.sh.tftpl", {
    image  = var.api_image_uri, registry = split("/", var.api_image_uri)[0],
    region = var.region, prefix = var.ssm_prefix
  })
  user_data_replace_on_change = true
  tags                        = { Name = var.name, Team = "HAKAS" }
}
resource "aws_lb" "api" {
  name                       = var.name
  load_balancer_type         = "application"
  security_groups            = [aws_security_group.load_balancer.id]
  subnets                    = var.subnet_ids
  idle_timeout               = 120
  enable_deletion_protection = true
}
resource "aws_lb_target_group" "api" {
  name     = var.name
  port     = 8000
  protocol = "HTTP"
  vpc_id   = var.vpc_id
  health_check {
    path    = "/api/health"
    matcher = "200"
  }
}
resource "aws_lb_target_group_attachment" "api" {
  target_group_arn = aws_lb_target_group.api.arn
  target_id        = aws_instance.runtime.id
  port             = 8000
}
resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.api.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.certificate_arn
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }
}
resource "aws_sesv2_email_identity" "sender" { email_identity = var.email_identity }
resource "aws_sesv2_configuration_set" "alerts" { configuration_set_name = "${var.name}-alerts" }

resource "aws_s3_bucket" "prompts" { bucket_prefix = "${var.name}-prompts-" }
resource "aws_s3_bucket_public_access_block" "prompts" {
  bucket                  = aws_s3_bucket.prompts.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
resource "aws_s3_bucket_server_side_encryption_configuration" "prompts" {
  bucket = aws_s3_bucket.prompts.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}
resource "aws_s3_bucket_policy" "connect" {
  bucket = aws_s3_bucket.prompts.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Deny", Principal = "*", Action = "s3:*", Resource = [aws_s3_bucket.prompts.arn, "${aws_s3_bucket.prompts.arn}/*"], Condition = { Bool = { "aws:SecureTransport" = "false" } } },
    { Effect = "Allow", Principal = { Service = "connect.amazonaws.com" }, Action = "s3:GetObject", Resource = "${aws_s3_bucket.prompts.arn}/notices/*", Condition = { StringEquals = { "aws:SourceAccount" = data.aws_caller_identity.team.account_id }, ArnLike = { "aws:SourceArn" = var.connect_instance_arn } } }
  ] })
}

resource "aws_cognito_user_pool" "customers" {
  name                     = var.name
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]
  admin_create_user_config { allow_admin_create_user_only = true }
  schema {
    name                = "account_ref"
    attribute_data_type = "String"
    mutable             = false
    required            = false
    string_attribute_constraints {
      min_length = "1"
      max_length = "64"
    }
  }
  password_policy {
    minimum_length    = 12
    require_lowercase = true
    require_uppercase = true
    require_numbers   = true
    require_symbols   = true
  }
  mfa_configuration = "OPTIONAL"
  software_token_mfa_configuration { enabled = true }
}
resource "aws_cognito_user_pool_client" "mobile" {
  name                                 = "${var.name}-mobile"
  user_pool_id                         = aws_cognito_user_pool.customers.id
  generate_secret                      = false
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email", "profile"]
  supported_identity_providers         = ["COGNITO"]
  callback_urls                        = var.callback_urls
  logout_urls                          = var.logout_urls
  read_attributes                      = ["email", "name", "custom:account_ref"]
  write_attributes                     = ["email", "name"]
  prevent_user_existence_errors        = "ENABLED"
}
resource "aws_cognito_user_pool_domain" "login" {
  domain       = var.login_domain
  user_pool_id = aws_cognito_user_pool.customers.id
}

output "runtime_instance" { value = aws_instance.runtime.id }
output "api_load_balancer" { value = aws_lb.api.dns_name }
output "oidc_issuer" { value = "https://cognito-idp.${var.region}.amazonaws.com/${aws_cognito_user_pool.customers.id}" }
output "oidc_client_id" { value = aws_cognito_user_pool_client.mobile.id }
output "prompt_bucket" { value = aws_s3_bucket.prompts.id }
output "ses_configuration_set" { value = aws_sesv2_configuration_set.alerts.configuration_set_name }
