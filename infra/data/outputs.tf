output "kms_key_arn" { value = aws_kms_key.data.arn }
output "kms_key_id" { value = aws_kms_key.data.key_id }
output "data_volume_id" { value = aws_ebs_volume.data.id }
output "asset_bucket" { value = aws_s3_bucket.assets.id }
output "backup_bucket" { value = aws_s3_bucket.backups.id }
