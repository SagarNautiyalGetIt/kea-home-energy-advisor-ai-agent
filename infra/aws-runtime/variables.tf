variable "region" {
  type    = string
  default = "ap-southeast-2"
}
variable "name" {
  type    = string
  default = "kea-team-release"
}
variable "vpc_id" {
  type = string
}
variable "subnet_ids" {
  type = list(string)
  validation {
    condition     = length(var.subnet_ids) >= 2
    error_message = "Provide two public subnets in distinct AZs."
  }
}
variable "certificate_arn" {
  type = string
}
variable "api_image_uri" {
  type = string
  validation {
    condition     = can(regex("@sha256:[a-f0-9]{64}$", var.api_image_uri))
    error_message = "Pin the reviewed API image by digest."
  }
}
variable "ecr_repository_arn" {
  type = string
}
variable "instance_type" {
  type    = string
  default = "t3.small"
}
variable "ssm_prefix" {
  type = string
  validation {
    condition     = startswith(var.ssm_prefix, "/kea/") && length(var.ssm_prefix) > 5
    error_message = "Use an isolated /kea/ deployment prefix."
  }
}
variable "email_identity" {
  type = string
}
variable "connect_instance_arn" {
  type = string
}
variable "login_domain" {
  type = string
}
variable "callback_urls" {
  type = list(string)
}
variable "logout_urls" {
  type = list(string)
}
variable "api_url" {
  type = string
  validation {
    condition     = startswith(var.api_url, "https://")
    error_message = "Use the public HTTPS API hostname matching the certificate."
  }
}
variable "care_queue_arn" {
  type = string
}
variable "sms_delivery_log_group" {
  type        = string
  description = "Existing CloudWatch SMS delivery group after SNS success/failure logging is enabled."
}
