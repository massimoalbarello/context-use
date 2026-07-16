output "kms_key_arn" { value = aws_kms_key.data.arn }
output "kms_key_id" { value = aws_kms_key.data.key_id }
output "data_volume_id" { value = aws_ebs_volume.data.id }
output "asset_bucket" { value = aws_s3_bucket.assets.id }
output "backup_bucket" { value = aws_s3_bucket.backups.id }
output "deployment_artifact_bucket" {
  value = var.enable_github_deploy ? aws_s3_bucket.deployment_artifacts[0].id : ""
}
output "github_deploy_role_arn" {
  value = var.enable_github_deploy ? aws_iam_role.github_deploy[0].arn : ""
}
