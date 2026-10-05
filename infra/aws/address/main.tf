terraform {
  required_version = ">= 1.10, < 2.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

provider "aws" {
  region              = "ap-southeast-2"
  allowed_account_ids = [var.account_id]
  default_tags {
    tags = {
      Project    = "kea-energy"
      CloudOwner = var.cloud_owner
      Lifecycle  = "retained"
      ManagedBy  = "terraform"
    }
  }
}

variable "account_id" { type = string }
variable "cloud_owner" { type = string }

# This state is separate from ec2/ so session teardown cannot release the IP.
resource "aws_eip" "stable" {
  domain = "vpc"
  tags   = { Name = "kea-energy-stable-ip" }
}

output "allocation_id" { value = aws_eip.stable.allocation_id }
output "public_ip" { value = aws_eip.stable.public_ip }
