#!/usr/bin/env bash
set -euo pipefail

: "${CONTEXT_USE_VERSION:?CONTEXT_USE_VERSION is required}"
: "${CONTEXT_USE_ENVIRONMENT:=production}"
: "${CONTEXT_USE_BUNDLE_URL:?CONTEXT_USE_BUNDLE_URL is required}"
: "${CONTEXT_USE_BUNDLE_SHA256:?CONTEXT_USE_BUNDLE_SHA256 is required}"
: "${CONTEXT_USE_APP_IMAGE:?CONTEXT_USE_APP_IMAGE is required}"
: "${CONTEXT_USE_BACKUP_IMAGE:?CONTEXT_USE_BACKUP_IMAGE is required}"
: "${CONTEXT_USE_PARAMETER_PREFIX:?CONTEXT_USE_PARAMETER_PREFIX is required}"

root=/opt/context-use
secrets=/data/context-use/secrets
mountpoint -q /data || { echo "Retained data volume is not mounted" >&2; exit 1; }
[ -s /data/context-use/.volume-id ] || { echo "Retained data volume marker is missing" >&2; exit 1; }
mkdir -p "${root}" "${secrets}" /data/context-use/{postgres,caddy/data,caddy/config}
chmod 0700 "${secrets}"
chown 70:70 /data/context-use/postgres
chmod 0700 /data/context-use/postgres

archive="/tmp/context-use-deployment-${CONTEXT_USE_VERSION}.tar.gz"
curl --proto '=https' --tlsv1.2 -fsSL "${CONTEXT_USE_BUNDLE_URL}" -o "${archive}"
echo "${CONTEXT_USE_BUNDLE_SHA256}  ${archive}" | sha256sum -c -
tar -xzf "${archive}" -C "${root}"

parameter_prefix="${CONTEXT_USE_PARAMETER_PREFIX}"
get_secret() {
  aws ssm get-parameter --name "${parameter_prefix}/$1" --with-decryption --query Parameter.Value --output text
}

umask 077
cat > "${secrets}/runtime.env" <<EOF
VERSION=${CONTEXT_USE_VERSION}
APP_IMAGE=${CONTEXT_USE_APP_IMAGE}
BACKUP_IMAGE=${CONTEXT_USE_BACKUP_IMAGE}
APP_HOSTNAME=$(get_secret APP_HOSTNAME)
ASSET_HOSTNAME=$(get_secret ASSET_HOSTNAME)
PUBLIC_MCP_HOSTNAME=$(get_secret PUBLIC_MCP_HOSTNAME)
OWNER_EMAIL=$(get_secret OWNER_EMAIL)
OWNER_SETUP_TOKEN_HASH=$(get_secret OWNER_SETUP_TOKEN_HASH)
BETTER_AUTH_SECRET=$(get_secret BETTER_AUTH_SECRET)
POSTGRES_PASSWORD=$(get_secret POSTGRES_PASSWORD)
DB_AUTH_PASSWORD=$(get_secret DB_AUTH_PASSWORD)
DB_DASHBOARD_PASSWORD=$(get_secret DB_DASHBOARD_PASSWORD)
DB_MCP_PASSWORD=$(get_secret DB_MCP_PASSWORD)
DB_PUBLIC_PASSWORD=$(get_secret DB_PUBLIC_PASSWORD)
DB_PUBLIC_MCP_PASSWORD=$(get_secret DB_PUBLIC_MCP_PASSWORD)
DB_PUBLISHER_PASSWORD=$(get_secret DB_PUBLISHER_PASSWORD)
DB_BACKUP_PASSWORD=$(get_secret DB_BACKUP_PASSWORD)
AWS_REGION=$(get_secret AWS_REGION)
ASSET_BUCKET=$(get_secret ASSET_BUCKET)
BACKUP_BUCKET=$(get_secret BACKUP_BUCKET)
KMS_KEY_ID=$(get_secret KMS_KEY_ID)
CLOUDWATCH_LOG_GROUP=$(get_secret CLOUDWATCH_LOG_GROUP)
BACKUP_RETENTION_DAYS=$(get_secret BACKUP_RETENTION_DAYS)
EOF

cd "${root}/deploy"
docker compose --env-file "${secrets}/runtime.env" pull --quiet
docker compose --env-file "${secrets}/runtime.env" --profile migration run --rm migrate
docker compose --env-file "${secrets}/runtime.env" up -d --remove-orphans
docker compose --env-file "${secrets}/runtime.env" ps
