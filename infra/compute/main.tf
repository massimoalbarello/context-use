data "aws_ssm_parameter" "al2023" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64"
}

locals { prefix = "context-use-${var.installation_id}-${var.environment}" }

resource "aws_vpc" "main" {
  cidr_block           = "10.42.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags                 = { Name = local.prefix }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = local.prefix }
}

resource "aws_subnet" "public" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = "10.42.1.0/24"
  availability_zone       = var.availability_zone
  map_public_ip_on_launch = true
  tags                    = { Name = "${local.prefix}-public" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }
}

resource "aws_route_table_association" "public" {
  subnet_id      = aws_subnet.public.id
  route_table_id = aws_route_table.public.id
}

resource "aws_security_group" "app" {
  name        = "${local.prefix}-web"
  description = "Only public HTTP and HTTPS; administration uses SSM"
  vpc_id      = aws_vpc.main.id
  ingress {
    description = "HTTP"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  ingress {
    description = "HTTP3"
    from_port   = 443
    to_port     = 443
    protocol    = "udp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  tags = { Name = "${local.prefix}-web" }
}

resource "aws_cloudwatch_log_group" "app" {
  name              = "/context-use/${var.installation_id}/${var.environment}"
  retention_in_days = 30
}

resource "aws_iam_role" "instance" {
  name = "${local.prefix}-instance"
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "ec2.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
}

resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.instance.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_role_policy" "data" {
  name = "${local.prefix}-data"
  role = aws_iam_role.instance.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket", "s3:GetObjectVersion"]
        Resource = [
          "arn:aws:s3:::${var.asset_bucket}", "arn:aws:s3:::${var.asset_bucket}/*",
          "arn:aws:s3:::${var.backup_bucket}", "arn:aws:s3:::${var.backup_bucket}/*"
        ]
      },
      { Effect = "Allow", Action = ["kms:Decrypt", "kms:Encrypt", "kms:GenerateDataKey"], Resource = [var.kms_key_arn] },
      { Effect = "Allow", Action = ["ssm:GetParameter", "ssm:GetParameters", "ssm:GetParametersByPath"], Resource = ["arn:aws:ssm:${var.aws_region}:*:parameter${var.ssm_parameter_prefix}/*"] },
      { Effect = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents", "logs:DescribeLogStreams"], Resource = ["${aws_cloudwatch_log_group.app.arn}:*"] }
    ]
  })
}

resource "aws_iam_instance_profile" "app" {
  name = local.prefix
  role = aws_iam_role.instance.name
}

resource "aws_instance" "app" {
  ami                         = data.aws_ssm_parameter.al2023.value
  instance_type               = var.instance_type
  subnet_id                   = aws_subnet.public.id
  vpc_security_group_ids      = [aws_security_group.app.id]
  iam_instance_profile        = aws_iam_instance_profile.app.name
  associate_public_ip_address = true
  user_data_replace_on_change = true
  user_data = templatefile("${path.module}/user-data.sh.tftpl", {
    volume_id = replace(var.data_volume_id, "-", "")
  })
  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 2
    instance_metadata_tags      = "enabled"
  }
  root_block_device {
    encrypted   = true
    kms_key_id  = var.kms_key_arn
    volume_type = "gp3"
    volume_size = 16
  }
  tags = { Name = local.prefix }
}

resource "aws_volume_attachment" "data" {
  device_name = "/dev/sdf"
  volume_id   = var.data_volume_id
  instance_id = aws_instance.app.id
}

resource "aws_eip" "app" {
  domain     = "vpc"
  instance   = aws_instance.app.id
  depends_on = [aws_internet_gateway.main]
  tags       = { Name = local.prefix }
}

resource "aws_route53_record" "app" {
  count   = var.route53_zone_id == "" ? 0 : 1
  zone_id = var.route53_zone_id
  name    = var.app_hostname
  type    = "A"
  ttl     = 60
  records = [aws_eip.app.public_ip]
}

resource "aws_route53_record" "assets" {
  count   = var.route53_zone_id == "" ? 0 : 1
  zone_id = var.route53_zone_id
  name    = var.asset_hostname
  type    = "A"
  ttl     = 60
  records = [aws_eip.app.public_ip]
}
