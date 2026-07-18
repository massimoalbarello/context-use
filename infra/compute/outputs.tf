output "instance_id" { value = aws_instance.app.id }
output "public_ip" { value = aws_eip.app.public_ip }
output "app_url" { value = "https://${var.app_hostname}" }
output "asset_url" { value = "https://${var.asset_hostname}" }
output "public_mcp_url" { value = "https://${var.public_mcp_hostname}/mcp" }
output "cloudwatch_log_group" { value = aws_cloudwatch_log_group.app.name }
