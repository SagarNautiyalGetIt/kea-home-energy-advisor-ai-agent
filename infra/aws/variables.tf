# Inputs. Every default is the cheap, safe one — a `terraform apply` with no tfvars
# beyond the two required secrets produces the free-tier deployment described in
# docs/adr/0010-aws-deployment.md.

variable "project" {
  type    = string
  default = "kea"
}

variable "environment" {
  type        = string
  default = "dev"
  description = "dev | prod. Controls deletion protection and final snapshots only."

  validation {
    condition     = contains(["dev", "prod"], var.environment)
    error_message = "environment must be dev or prod."
  }
}

variable "region" {
  type        = string
  default     = "ap-southeast-2"
  description = <<-EOT
    Sydney. NZ data residency is a pitch point, and it is the nearest region with
    Bedrock. Check the model is actually served here before deploying — availability
    differs by region and a model that works in us-east-1 may not be offered in ap-*.
  EOT
}

variable "bedrock_model" {
  type    = string
  default = "anthropic.claude-sonnet-5"

  validation {
    # Bedrock model ids carry an `anthropic.` prefix. A first-party id returns 400 with
    # a message that does not obviously say why, and the IAM policy is scoped to this
    # exact string — so a typo here fails as AccessDenied, which is worse.
    condition     = startswith(var.bedrock_model, "anthropic.")
    error_message = "Bedrock model ids are prefixed, e.g. anthropic.claude-sonnet-5."
  }
}

variable "api_image_uri" {
  type        = string
  description = "ECR image for the FastAPI Lambda. Built by .github/workflows/deploy.yml."
}

variable "db_password" {
  type      = string
  sensitive = true

  validation {
    condition     = length(var.db_password) >= 16
    error_message = "Use at least 16 characters. Generate it; do not choose it."
  }
}

variable "db_allowed_cidrs" {
  type        = list(string)
  description = <<-EOT
    Who may reach Postgres on 5432. The Lambda runs outside the VPC (there is no NAT
    Gateway — see ADR-0010), so this security group is the access control rather than
    network placement.

    Set it to the egress addresses that actually need it. The validation below refuses
    0.0.0.0/0 outright: an open Postgres port is found by scanners within hours, and
    "temporarily" open is how it stays.
  EOT

  validation {
    condition     = !contains(var.db_allowed_cidrs, "0.0.0.0/0")
    error_message = "Refusing 0.0.0.0/0 on the database security group. Narrow it."
  }
}

variable "gateway_secrets" {
  type        = map(string)
  sensitive   = true
  default     = {}
  description = <<-EOT
    Third-party gateway credentials, written to Parameter Store — KEA_RESEND_API_KEY,
    KEA_TWILIO_AUTH_TOKEN and so on. Empty by default so a deploy succeeds before anyone
    has an account: the gateways fall back to the file sink with a warning, and /health
    reports which backend each channel resolved to.
  EOT
}

variable "email_backend" {
  type        = string
  default     = "file"
  description = "file | smtp | resend. The university account cannot use SES."
}

variable "sms_backend" {
  type        = string
  default     = "file"
  description = "file | textbelt | twilio. The university account cannot use SNS."
}

variable "voice_backend" {
  type        = string
  default     = "file"
  description = "file | twilio. The university account cannot use Connect."
}

variable "monthly_budget_usd" {
  type        = string
  default     = "20"
  description = "Budget alarm threshold. Not optional on a shared course account."
}

variable "budget_alert_emails" {
  type        = list(string)
  description = "Who hears about the spend. At least two people, so one holiday is not a gap."

  validation {
    condition     = length(var.budget_alert_emails) > 0
    error_message = "Set at least one address, or the budget alarm alerts nobody."
  }
}
