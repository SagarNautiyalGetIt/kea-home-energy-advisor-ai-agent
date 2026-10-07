terraform {
  required_version = ">= 1.11, < 2.0"
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
      Session    = var.session_id
      CloudOwner = var.cloud_owner
      Lifecycle  = "disposable"
      ManagedBy  = "terraform"
    }
  }
}

variable "account_id" { type = string }
variable "cloud_owner" { type = string }
variable "session_id" { type = string }
variable "ami_id" { type = string }
variable "elastic_ip_allocation_id" {
  type    = string
  default = "" # Existing sessions keep their original auto-assigned public IP.
}
variable "ssh_public_key_path" { type = string }
variable "ssh_cidr" { type = string }
variable "web_cidrs" {
  type = list(string)
  # Current public demo uses 0.0.0.0/0; choose narrower CIDRs for private tests.
}
variable "instance_type" {
  type = string
  # 4 GiB: Metabase's 1 GiB heap does not fit beside the API on t3.small.
  default = "t3.medium"
}
variable "resource_name" {
  type        = string
  default     = ""
  description = "Optional existing deployment name when adopting verified resources."
}
variable "vpc_cidr" {
  type    = string
  default = "10.42.0.0/16"
}

locals {
  name = var.resource_name == "" ? "kea-energy-${var.session_id}" : var.resource_name
}

data "aws_ami" "pinned" {
  owners = ["amazon"]
  filter {
    name   = "image-id"
    values = [var.ami_id]
  }
  filter {
    name   = "architecture"
    values = ["x86_64"]
  }
}

data "aws_eip" "stable" {
  count = var.elastic_ip_allocation_id == "" ? 0 : 1
  id    = var.elastic_ip_allocation_id
}

resource "aws_vpc" "demo" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags                 = { Name = local.name }
}

resource "aws_internet_gateway" "demo" {
  vpc_id = aws_vpc.demo.id
}

resource "aws_subnet" "demo" {
  vpc_id                  = aws_vpc.demo.id
  cidr_block              = cidrsubnet(var.vpc_cidr, 8, 0)
  availability_zone       = "ap-southeast-2a"
  map_public_ip_on_launch = var.elastic_ip_allocation_id == ""
  tags                    = { Name = local.name }
}

resource "aws_route_table" "demo" {
  vpc_id = aws_vpc.demo.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.demo.id
  }
}

resource "aws_route_table_association" "demo" {
  subnet_id      = aws_subnet.demo.id
  route_table_id = aws_route_table.demo.id
}

resource "aws_security_group" "demo" {
  name_prefix = "${local.name}-"
  description = "Short-lived Kea Energy rehearsal host"
  vpc_id      = aws_vpc.demo.id

  ingress {
    description = "Owner SSH"
    protocol    = "tcp"
    from_port   = 22
    to_port     = 22
    cidr_blocks = [var.ssh_cidr]
  }
  ingress {
    description = "Public ACME HTTP-01 validation"
    protocol    = "tcp"
    from_port   = 80
    to_port     = 80
    cidr_blocks = ["0.0.0.0/0"]
  }
  ingress {
    description = "HTTPS rehearsal clients"
    protocol    = "tcp"
    from_port   = 443
    to_port     = 443
    cidr_blocks = var.web_cidrs
  }
  egress {
    protocol    = "-1"
    from_port   = 0
    to_port     = 0
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_key_pair" "demo" {
  key_name   = local.name
  public_key = file(var.ssh_public_key_path)
  lifecycle {
    # Imported key pairs do not round-trip the original public-key text.
    # Session keys are immutable; keep the existing key when adopting a host.
    ignore_changes = [public_key]
  }
}

resource "aws_instance" "demo" {
  ami                                  = data.aws_ami.pinned.id
  instance_type                        = var.instance_type
  subnet_id                            = aws_subnet.demo.id
  associate_public_ip_address          = var.elastic_ip_allocation_id == ""
  vpc_security_group_ids               = [aws_security_group.demo.id]
  key_name                             = aws_key_pair.demo.key_name
  user_data                            = file("${path.module}/bootstrap.sh")
  user_data_replace_on_change          = true
  instance_initiated_shutdown_behavior = "terminate"

  metadata_options {
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
  }
  credit_specification {
    cpu_credits = "standard"
  }
  root_block_device {
    volume_size           = 20
    volume_type           = "gp3"
    encrypted             = true
    delete_on_termination = true
  }
  lifecycle {
    # User data bootstraps new hosts only. Runtime maintenance uses the deployment
    # steps, so bootstrap edits must not replace a running application host.
    ignore_changes = [user_data]
  }
  tags       = { Name = local.name }
  depends_on = [aws_route_table_association.demo]
}

# The address itself belongs to address/ and survives session teardown.
resource "aws_eip_association" "demo" {
  count               = var.elastic_ip_allocation_id == "" ? 0 : 1
  allocation_id       = var.elastic_ip_allocation_id
  instance_id         = aws_instance.demo.id
  allow_reassociation = false
  depends_on          = [aws_internet_gateway.demo]
}

output "instance_id" { value = aws_instance.demo.id }
output "public_ip" {
  value = var.elastic_ip_allocation_id == "" ? aws_instance.demo.public_ip : data.aws_eip.stable[0].public_ip
}
output "security_group_id" { value = aws_security_group.demo.id }
output "vpc_id" { value = aws_vpc.demo.id }
