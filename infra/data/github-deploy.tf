data "aws_iam_openid_connect_provider" "github" {
  count = var.enable_github_deploy ? 1 : 0
  url   = "https://token.actions.githubusercontent.com"
}

data "aws_iam_policy_document" "github_deploy_assume" {
  count = var.enable_github_deploy ? 1 : 0

  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [data.aws_iam_openid_connect_provider.github[0].arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_repo}:ref:refs/heads/${var.github_branch}"]
    }
  }
}

resource "aws_iam_role" "github_deploy" {
  count              = var.enable_github_deploy ? 1 : 0
  name               = "${local.prefix}-github-deploy"
  assume_role_policy = data.aws_iam_policy_document.github_deploy_assume[0].json
}

resource "aws_s3_bucket" "deployment_artifacts" {
  count         = var.enable_github_deploy ? 1 : 0
  bucket        = "${local.bucket_prefix}-deploy"
  force_destroy = true
}

resource "aws_s3_bucket_public_access_block" "deployment_artifacts" {
  count                   = var.enable_github_deploy ? 1 : 0
  bucket                  = aws_s3_bucket.deployment_artifacts[0].id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "deployment_artifacts" {
  count  = var.enable_github_deploy ? 1 : 0
  bucket = aws_s3_bucket.deployment_artifacts[0].id
  rule { object_ownership = "BucketOwnerEnforced" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "deployment_artifacts" {
  count  = var.enable_github_deploy ? 1 : 0
  bucket = aws_s3_bucket.deployment_artifacts[0].id
  rule {
    apply_server_side_encryption_by_default {
      kms_master_key_id = aws_kms_key.data.arn
      sse_algorithm     = "aws:kms"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "deployment_artifacts" {
  count  = var.enable_github_deploy ? 1 : 0
  bucket = aws_s3_bucket.deployment_artifacts[0].id
  rule {
    id     = "expire-deployment-artifacts"
    status = "Enabled"
    filter { prefix = "deployments/" }
    expiration { days = 30 }
  }
}

data "aws_iam_policy_document" "deployment_artifacts" {
  count = var.enable_github_deploy ? 1 : 0

  statement {
    sid     = "DenyInsecureTransport"
    effect  = "Deny"
    actions = ["s3:*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    resources = [
      aws_s3_bucket.deployment_artifacts[0].arn,
      "${aws_s3_bucket.deployment_artifacts[0].arn}/*",
    ]
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
    resources = ["${aws_s3_bucket.deployment_artifacts[0].arn}/*"]
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
    resources = ["${aws_s3_bucket.deployment_artifacts[0].arn}/*"]
    condition {
      test     = "StringNotEquals"
      variable = "s3:x-amz-server-side-encryption-aws-kms-key-id"
      values   = [aws_kms_key.data.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "deployment_artifacts" {
  count  = var.enable_github_deploy ? 1 : 0
  bucket = aws_s3_bucket.deployment_artifacts[0].id
  policy = data.aws_iam_policy_document.deployment_artifacts[0].json
}

data "aws_iam_policy_document" "github_deploy" {
  count = var.enable_github_deploy ? 1 : 0

  statement {
    sid = "DeploymentArtifacts"
    actions = [
      "s3:ListBucket",
      "s3:ListBucketMultipartUploads",
    ]
    resources = [aws_s3_bucket.deployment_artifacts[0].arn]
  }

  statement {
    sid = "DeploymentArtifactObjects"
    actions = [
      "s3:AbortMultipartUpload",
      "s3:GetObject",
      "s3:ListMultipartUploadParts",
      "s3:PutObject",
    ]
    resources = ["${aws_s3_bucket.deployment_artifacts[0].arn}/deployments/*"]
  }

  statement {
    sid = "DeploymentArtifactKMS"
    actions = [
      "kms:Decrypt",
      "kms:DescribeKey",
      "kms:Encrypt",
      "kms:GenerateDataKey",
      "kms:ReEncryptFrom",
      "kms:ReEncryptTo",
    ]
    resources = [aws_kms_key.data.arn]
  }

  statement {
    sid     = "RunDeployment"
    actions = ["ssm:SendCommand"]
    resources = [
      "arn:aws:ec2:${var.aws_region}:${data.aws_caller_identity.current.account_id}:instance/*",
      "arn:aws:ssm:${var.aws_region}::document/AWS-RunShellScript",
    ]
  }

  statement {
    sid = "ObserveDeployment"
    actions = [
      "ssm:DescribeInstanceInformation",
      "ssm:GetCommandInvocation",
      "ssm:ListCommandInvocations",
      "ssm:ListCommands",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "github_deploy" {
  count  = var.enable_github_deploy ? 1 : 0
  name   = "${local.prefix}-deploy"
  role   = aws_iam_role.github_deploy[0].id
  policy = data.aws_iam_policy_document.github_deploy[0].json
}
