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
variable "route53_zone_id" {
  type    = string
  default = ""
}
variable "data_volume_id" {
  type = string
}
variable "initialize_data_volume" {
  type        = bool
  default     = false
  description = "One-time authorization to initialize the retained data volume during a new installation."
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
