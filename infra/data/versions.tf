terraform {
  required_version = ">= 1.11.0, < 2.0.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
  backend "s3" {}
}

provider "aws" {
  region = var.aws_region
  default_tags {
    tags = {
      Project      = "context-use"
      Environment  = var.environment
      Installation = var.installation_id
      ManagedBy    = "context-use-cli"
    }
  }
}
