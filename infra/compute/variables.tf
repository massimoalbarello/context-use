variable "aws_region" {
  type = string
}
variable "availability_zone" {
  type = string
}
variable "environment" {
  type    = string
  default = "production"
}
variable "installation_id" {
  type = string
}
variable "instance_type" {
  type    = string
  default = "t3.small"
}
variable "app_hostname" {
  type = string
}
variable "asset_hostname" {
  type = string
}
variable "public_mcp_hostname" {
  type = string
}
variable "route53_zone_id" {
  type    = string
  default = ""
}
variable "data_volume_id" {
  type = string
}
variable "kms_key_arn" {
  type = string
}
variable "asset_bucket" {
  type = string
}
variable "backup_bucket" {
  type = string
}
variable "ssm_parameter_prefix" {
  type = string
}
