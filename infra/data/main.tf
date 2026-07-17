data "aws_caller_identity" "current" {}

locals {
  prefix        = "context-use-${var.installation_id}-${var.environment}"
  bucket_prefix = "cu-${data.aws_caller_identity.current.account_id}-${var.aws_region}-${var.installation_id}"
}

resource "aws_kms_key" "data" {
  description             = "context-use ${var.environment} data encryption"
  enable_key_rotation     = true
  deletion_window_in_days = 30
}

resource "aws_kms_alias" "data" {
  name          = "alias/${local.prefix}"
  target_key_id = aws_kms_key.data.key_id
}

resource "aws_ebs_volume" "data" {
  availability_zone = var.availability_zone
  size              = var.data_volume_size_gb
  type              = "gp3"
  encrypted         = true
  kms_key_id        = aws_kms_key.data.arn
  tags              = { Name = "${local.prefix}-data" }
}

resource "aws_s3_bucket" "assets" {
  bucket        = "${local.bucket_prefix}-assets"
  force_destroy = false
}

resource "aws_s3_bucket" "backups" {
  bucket        = "${local.bucket_prefix}-backups"
  force_destroy = false
}

resource "aws_s3_bucket_public_access_block" "private" {
  for_each = {
    assets  = aws_s3_bucket.assets.id
    backups = aws_s3_bucket.backups.id
  }
  bucket                  = each.value
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "private" {
  for_each = {
    assets  = aws_s3_bucket.assets.id
    backups = aws_s3_bucket.backups.id
  }
  bucket = each.value
  rule { object_ownership = "BucketOwnerEnforced" }
}

resource "aws_s3_bucket_versioning" "private" {
  for_each = {
    assets  = aws_s3_bucket.assets.id
    backups = aws_s3_bucket.backups.id
  }
  bucket = each.value
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "private" {
  for_each = {
    assets  = aws_s3_bucket.assets.id
    backups = aws_s3_bucket.backups.id
  }
  bucket = each.value
  rule {
    apply_server_side_encryption_by_default {
      kms_master_key_id = aws_kms_key.data.arn
      sse_algorithm     = "aws:kms"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "backups" {
  bucket = aws_s3_bucket.backups.id
  rule {
    id     = "backup-retention"
    status = "Enabled"
    filter { prefix = "postgres/" }
    expiration { days = var.backup_retention_days }
    noncurrent_version_expiration { noncurrent_days = 7 }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "assets" {
  bucket = aws_s3_bucket.assets.id
  rule {
    id     = "retain-recoverable-noncurrent-assets"
    status = "Enabled"
    filter {}
    noncurrent_version_expiration { noncurrent_days = 30 }
  }
}

data "aws_iam_policy_document" "tls_only" {
  for_each = {
    assets  = aws_s3_bucket.assets.arn
    backups = aws_s3_bucket.backups.arn
  }
  statement {
    sid     = "DenyInsecureTransport"
    effect  = "Deny"
    actions = ["s3:*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    resources = [each.value, "${each.value}/*"]
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
  statement {
    sid     = "DenyUploadsWithoutInstallationKMS"
    effect  = "Deny"
    actions = ["s3:PutObject"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    resources = ["${each.value}/*"]
    condition {
      test     = "StringNotEquals"
      variable = "s3:x-amz-server-side-encryption"
      values   = ["aws:kms"]
    }
  }
  statement {
    sid     = "DenyUploadsWithAnotherKMSKey"
    effect  = "Deny"
    actions = ["s3:PutObject"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    resources = ["${each.value}/*"]
    condition {
      test     = "StringNotEquals"
      variable = "s3:x-amz-server-side-encryption-aws-kms-key-id"
      values   = [aws_kms_key.data.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "tls_only" {
  for_each = {
    assets  = aws_s3_bucket.assets.id
    backups = aws_s3_bucket.backups.id
  }
  bucket = each.value
  policy = data.aws_iam_policy_document.tls_only[each.key].json
}
