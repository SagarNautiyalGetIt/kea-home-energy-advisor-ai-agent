# Private RDS uses password authentication and the AWS-managed RDS service-linked
# role. No project IAM role, instance profile or Enhanced Monitoring role is used.
variable "db_master_password" {
  type      = string
  sensitive = true
  ephemeral = true
  default   = ""
}
variable "db_instance_class" {
  type    = string
  default = "db.t4g.micro"
}
variable "db_engine_version" {
  type    = string
  default = "16.15"
}
# Either database subnet. AWS can run out of db.t4g.micro capacity in one zone
# (InsufficientDBInstanceCapacity, 2a on 6 Oct 2026); TF_VAR_db_availability_zone
# moves the instance without editing this file.
variable "db_availability_zone" {
  type    = string
  default = "ap-southeast-2a"
  validation {
    condition     = contains(["ap-southeast-2a", "ap-southeast-2b"], var.db_availability_zone)
    error_message = "The database subnets exist only in ap-southeast-2a and ap-southeast-2b."
  }
}

resource "aws_subnet" "database" {
  for_each          = { a = 1, b = 2 }
  vpc_id            = aws_vpc.demo.id
  cidr_block        = cidrsubnet(var.vpc_cidr, 8, each.value)
  availability_zone = "ap-southeast-2${each.key}"
  tags              = { Name = "${local.name}-db-${each.key}" }
}

resource "aws_db_subnet_group" "demo" {
  name        = local.name
  description = "Kea Energy private PostgreSQL subnets"
  subnet_ids  = [for subnet in aws_subnet.database : subnet.id]
}

resource "aws_security_group" "database" {
  name_prefix = "${local.name}-db-"
  description = "PostgreSQL access from the Kea application host only"
  vpc_id      = aws_vpc.demo.id
  ingress {
    description     = "Application PostgreSQL"
    protocol        = "tcp"
    from_port       = 5432
    to_port         = 5432
    security_groups = [aws_security_group.demo.id]
  }
  egress {
    protocol    = "-1"
    from_port   = 0
    to_port     = 0
    cidr_blocks = ["0.0.0.0/0"]
  }
  lifecycle { create_before_destroy = true }
}

resource "aws_db_instance" "demo" {
  identifier                          = local.name
  engine                              = "postgres"
  engine_version                      = var.db_engine_version
  instance_class                      = var.db_instance_class
  allocated_storage                   = 20
  storage_type                        = "gp3"
  storage_encrypted                   = true
  db_name                             = "kea"
  username                            = "kea_admin"
  password_wo                         = var.db_master_password
  password_wo_version                 = 1
  port                                = 5432
  db_subnet_group_name                = aws_db_subnet_group.demo.name
  vpc_security_group_ids              = [aws_security_group.database.id]
  availability_zone                   = var.db_availability_zone
  multi_az                            = false
  publicly_accessible                 = false
  monitoring_interval                 = 0
  iam_database_authentication_enabled = false
  backup_retention_period             = 1
  auto_minor_version_upgrade          = true
  copy_tags_to_snapshot               = true
  deletion_protection                 = false
  # Data is restored from the local export on each deployment. The owner's
  # explicit teardown deletes the database and its automated backups.
  skip_final_snapshot      = true
  delete_automated_backups = true
}

output "db_identifier" { value = aws_db_instance.demo.identifier }
output "db_host" { value = aws_db_instance.demo.address }
