#!/usr/bin/env bash
set -euo pipefail

: "${AWS_REGION:?AWS_REGION is required}"
: "${PARAMETER_PREFIX:?PARAMETER_PREFIX is required}"
: "${DATA_KMS_KEY_ARN:?DATA_KMS_KEY_ARN is required}"
: "${APP_HOSTNAME:?APP_HOSTNAME is required}"
: "${ASSET_HOSTNAME:?ASSET_HOSTNAME is required}"
: "${OWNER_EMAIL:?OWNER_EMAIL is required}"
: "${GOOGLE_CLIENT_ID:?GOOGLE_CLIENT_ID is required}"
: "${ASSET_BUCKET:?ASSET_BUCKET is required}"
: "${BACKUP_BUCKET:?BACKUP_BUCKET is required}"
: "${CLOUDWATCH_LOG_GROUP:?CLOUDWATCH_LOG_GROUP is required}"
: "${BACKUP_RETENTION_DAYS:?BACKUP_RETENTION_DAYS is required}"

parameter_exists() {
  aws ssm get-parameter --name "${PARAMETER_PREFIX}/$1" >/dev/null 2>&1
}

put_parameter() {
  local name="$1"
  local value="$2"
  local input
  input="$(mktemp)"
  chmod 0600 "$input"
  jq -cn \
    --arg name "${PARAMETER_PREFIX}/${name}" \
    --arg value "$value" \
    --arg key "$DATA_KMS_KEY_ARN" \
    '{Name:$name,Value:$value,Type:"SecureString",KeyId:$key,Overwrite:true}' > "$input"
  aws ssm put-parameter --cli-input-json "file://${input}" >/dev/null
  rm -f "$input"
}

ensure_random_parameter() {
  local name="$1"
  local bytes="$2"
  if ! parameter_exists "$name"; then
    put_parameter "$name" "$(openssl rand -hex "$bytes")"
  fi
}

put_parameter APP_HOSTNAME "$APP_HOSTNAME"
put_parameter ASSET_HOSTNAME "$ASSET_HOSTNAME"
put_parameter OWNER_EMAIL "$OWNER_EMAIL"
put_parameter GOOGLE_CLIENT_ID "$GOOGLE_CLIENT_ID"

if [ -n "${GOOGLE_CLIENT_SECRET:-}" ]; then
  put_parameter GOOGLE_CLIENT_SECRET "$GOOGLE_CLIENT_SECRET"
elif ! parameter_exists GOOGLE_CLIENT_SECRET; then
  echo "CONTEXT_USE_GOOGLE_CLIENT_SECRET is required for the first deployment" >&2
  exit 1
fi

ensure_random_parameter BETTER_AUTH_SECRET 48
ensure_random_parameter POSTGRES_PASSWORD 36
ensure_random_parameter DB_AUTH_PASSWORD 36
ensure_random_parameter DB_DASHBOARD_PASSWORD 36
ensure_random_parameter DB_MCP_PASSWORD 36
ensure_random_parameter DB_PUBLIC_PASSWORD 36
ensure_random_parameter DB_PUBLISHER_PASSWORD 36
ensure_random_parameter DB_BACKUP_PASSWORD 36

put_parameter AWS_REGION "$AWS_REGION"
put_parameter ASSET_BUCKET "$ASSET_BUCKET"
put_parameter BACKUP_BUCKET "$BACKUP_BUCKET"
put_parameter KMS_KEY_ID "$DATA_KMS_KEY_ARN"
put_parameter CLOUDWATCH_LOG_GROUP "$CLOUDWATCH_LOG_GROUP"
put_parameter BACKUP_RETENTION_DAYS "$BACKUP_RETENTION_DAYS"
