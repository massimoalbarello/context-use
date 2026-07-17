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
  validation {
    condition     = can(regex("^[a-f0-9]{12}$", var.installation_id))
    error_message = "installation_id must be a 12-character lowercase hexadecimal identifier."
  }
}

variable "data_volume_size_gb" {
  type    = number
  default = 50
  validation {
    condition     = var.data_volume_size_gb >= 20
    error_message = "The data volume must be at least 20 GiB."
  }
}

variable "backup_retention_days" {
  type    = number
  default = 30
}
