resource "aws_db_subnet_group" "main" {
  name       = "${var.project_name}-db-subnets"
  subnet_ids = [aws_subnet.private_a.id, aws_subnet.private_b.id]
}

resource "random_password" "db_password" {
  length  = 24
  special = false # avoid URL-encoding headaches inside DATABASE_URL
}

resource "aws_db_instance" "main" {
  identifier        = "${var.project_name}-db"
  engine            = "postgres"
  engine_version    = "16"
  instance_class    = "db.t4g.micro" # cheapest current-gen burstable class
  allocated_storage = 20
  storage_type      = "gp3"
  db_name           = "instant_messenger"
  username          = "app_user"
  password          = random_password.db_password.result

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  multi_az               = false
  publicly_accessible    = false

  # Clean-teardown settings for a temporary project.
  skip_final_snapshot     = true
  deletion_protection     = false
  backup_retention_period = 0

  apply_immediately = true

  tags = { Name = "${var.project_name}-db" }
}

resource "aws_ssm_parameter" "database_url" {
  name  = "/${var.project_name}/database_url"
  type  = "SecureString"
  value = "postgresql://${aws_db_instance.main.username}:${random_password.db_password.result}@${aws_db_instance.main.endpoint}/${aws_db_instance.main.db_name}"
}
