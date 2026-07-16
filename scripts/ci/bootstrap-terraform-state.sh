#!/usr/bin/env bash
set -euo pipefail

: "${AWS_REGION:?AWS_REGION is required}"
: "${INSTALLATION_ID:?INSTALLATION_ID is required}"
: "${STATE_BUCKET:?STATE_BUCKET is required}"

alias_name="alias/context-use-${INSTALLATION_ID}-terraform-state"
state_kms_key_arn="$(aws kms describe-key --key-id "$alias_name" --query KeyMetadata.Arn --output text 2>/dev/null || true)"

if [ -z "$state_kms_key_arn" ] || [ "$state_kms_key_arn" = "None" ]; then
  state_kms_key_arn="$(aws kms create-key \
    --description "context-use ${INSTALLATION_ID} Terraform state" \
    --tags Key=Project,Value=context-use Key=Installation,Value="$INSTALLATION_ID" \
    --query KeyMetadata.Arn --output text)"
  aws kms enable-key-rotation --key-id "$state_kms_key_arn"
  aws kms create-alias --alias-name "$alias_name" --target-key-id "$state_kms_key_arn"
fi

if ! aws s3api head-bucket --bucket "$STATE_BUCKET" >/dev/null 2>&1; then
  create_args=(s3api create-bucket --bucket "$STATE_BUCKET")
  if [ "$AWS_REGION" != "us-east-1" ]; then
    create_args+=(--create-bucket-configuration "LocationConstraint=${AWS_REGION}")
  fi
  aws "${create_args[@]}" >/dev/null
fi

aws s3api put-public-access-block --bucket "$STATE_BUCKET" \
  --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws s3api put-bucket-versioning --bucket "$STATE_BUCKET" \
  --versioning-configuration Status=Enabled

encryption="$(jq -cn --arg key "$state_kms_key_arn" \
  '{Rules:[{ApplyServerSideEncryptionByDefault:{SSEAlgorithm:"aws:kms",KMSMasterKeyID:$key},BucketKeyEnabled:true}]}')"
aws s3api put-bucket-encryption --bucket "$STATE_BUCKET" \
  --server-side-encryption-configuration "$encryption"

policy="$(jq -cn --arg bucket "$STATE_BUCKET" --arg key "$state_kms_key_arn" '{
  Version:"2012-10-17",
  Statement:[
    {
      Sid:"DenyInsecureTransport",Effect:"Deny",Principal:"*",Action:"s3:*",
      Resource:["arn:aws:s3:::\($bucket)","arn:aws:s3:::\($bucket)/*"],
      Condition:{Bool:{"aws:SecureTransport":"false"}}
    },
    {
      Sid:"DenyStateWithoutInstallationKMS",Effect:"Deny",Principal:"*",Action:"s3:PutObject",
      Resource:"arn:aws:s3:::\($bucket)/*",
      Condition:{StringNotEquals:{"s3:x-amz-server-side-encryption":"aws:kms"}}
    },
    {
      Sid:"DenyStateWithAnotherKMSKey",Effect:"Deny",Principal:"*",Action:"s3:PutObject",
      Resource:"arn:aws:s3:::\($bucket)/*",
      Condition:{StringNotEquals:{"s3:x-amz-server-side-encryption-aws-kms-key-id":$key}}
    }
  ]
}')"
aws s3api put-bucket-policy --bucket "$STATE_BUCKET" --policy "$policy"

if [ -n "${GITHUB_OUTPUT:-}" ]; then
  echo "state_kms_key_arn=$state_kms_key_arn" >> "$GITHUB_OUTPUT"
else
  echo "$state_kms_key_arn"
fi
