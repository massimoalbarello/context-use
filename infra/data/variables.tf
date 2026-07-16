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

variable "app_hostname" {
  type = string
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

variable "enable_github_deploy" {
  description = "Create the first-party GitHub Actions deployment role and artifact bucket."
  type        = bool
  default     = false
}

variable "github_repo" {
  description = "GitHub repository allowed to assume the deployment role, in owner/repository form."
  type        = string
  default     = ""
  validation {
    condition     = !var.enable_github_deploy || can(regex("^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$", var.github_repo))
    error_message = "github_repo must use owner/repository form when GitHub deployment is enabled."
  }
}

variable "github_branch" {
  description = "GitHub branch allowed to assume the deployment role."
  type        = string
  default     = "main"
  validation {
    condition     = !var.enable_github_deploy || can(regex("^[A-Za-z0-9._/-]+$", var.github_branch))
    error_message = "github_branch contains unsupported characters."
  }
}
