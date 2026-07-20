#!/usr/bin/env bash
set -euo pipefail

: "${CONTEXT_USE_VERSION:?CONTEXT_USE_VERSION is required}"
: "${CONTEXT_USE_ENVIRONMENT:=production}"
: "${CONTEXT_USE_BUNDLE_URL:?CONTEXT_USE_BUNDLE_URL is required}"
: "${CONTEXT_USE_BUNDLE_SHA256:?CONTEXT_USE_BUNDLE_SHA256 is required}"
: "${CONTEXT_USE_APP_IMAGE:?CONTEXT_USE_APP_IMAGE is required}"
: "${CONTEXT_USE_BACKUP_IMAGE:?CONTEXT_USE_BACKUP_IMAGE is required}"
: "${CONTEXT_USE_PARAMETER_PREFIX:?CONTEXT_USE_PARAMETER_PREFIX is required}"
: "${CONTEXT_USE_STORAGE_ROLE_ARN:?CONTEXT_USE_STORAGE_ROLE_ARN is required}"
: "${CONTEXT_USE_BACKUP_ROLE_ARN:?CONTEXT_USE_BACKUP_ROLE_ARN is required}"
: "${CONTEXT_USE_RECOVERY_BACKUP_KEY:=}"

if [ -n "${CONTEXT_USE_RECOVERY_BACKUP_KEY}" ] && [[ ! "${CONTEXT_USE_RECOVERY_BACKUP_KEY}" =~ ^postgres/[0-9TZ-]+\.sql\.gz$ ]]; then
  echo "Invalid recovery backup key" >&2
  exit 2
fi

root=/opt/context-use
secrets=/data/context-use/secrets
mountpoint -q /data || { echo "Retained data volume is not mounted" >&2; exit 1; }
[ -s /data/context-use/.volume-id ] || { echo "Retained data volume marker is missing" >&2; exit 1; }
mkdir -p "${root}" "${secrets}" /data/context-use/{postgres,backup-tmp,caddy/data,caddy/config}
chmod 0700 "${secrets}"
chmod 0700 /data/context-use/backup-tmp
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
OWNER_EMAIL=$(get_secret OWNER_EMAIL)
OWNER_SETUP_TOKEN_HASH=$(get_secret OWNER_SETUP_TOKEN_HASH)
BETTER_AUTH_SECRET=$(get_secret BETTER_AUTH_SECRET)
POSTGRES_PASSWORD=$(get_secret POSTGRES_PASSWORD)
DB_AUTH_PASSWORD=$(get_secret DB_AUTH_PASSWORD)
DB_DASHBOARD_PASSWORD=$(get_secret DB_DASHBOARD_PASSWORD)
DB_MCP_PASSWORD=$(get_secret DB_MCP_PASSWORD)
DB_PUBLIC_PASSWORD=$(get_secret DB_PUBLIC_PASSWORD)
DB_CONFIRMATION_PASSWORD=$(get_secret DB_CONFIRMATION_PASSWORD)
DB_STORAGE_PASSWORD=$(get_secret DB_STORAGE_PASSWORD)
DB_BACKUP_PASSWORD=$(get_secret DB_BACKUP_PASSWORD)
MCP_ASSET_CAPABILITY_SECRET=$(get_secret MCP_ASSET_CAPABILITY_SECRET)
CONFIRMATION_GATEWAY_TOKEN=$(get_secret CONFIRMATION_GATEWAY_TOKEN)
AUTH_DASHBOARD_TOKEN=$(get_secret AUTH_DASHBOARD_TOKEN)
AUTH_MCP_TOKEN=$(get_secret AUTH_MCP_TOKEN)
CONFIRMATION_DASHBOARD_TOKEN=$(get_secret CONFIRMATION_DASHBOARD_TOKEN)
STORAGE_DASHBOARD_TOKEN=$(get_secret STORAGE_DASHBOARD_TOKEN)
STORAGE_MCP_TOKEN=$(get_secret STORAGE_MCP_TOKEN)
STORAGE_PUBLIC_TOKEN=$(get_secret STORAGE_PUBLIC_TOKEN)
AWS_REGION=$(get_secret AWS_REGION)
ASSET_BUCKET=$(get_secret ASSET_BUCKET)
BACKUP_BUCKET=$(get_secret BACKUP_BUCKET)
KMS_KEY_ID=$(get_secret KMS_KEY_ID)
CLOUDWATCH_LOG_GROUP=$(get_secret CLOUDWATCH_LOG_GROUP)
STORAGE_ROLE_ARN=${CONTEXT_USE_STORAGE_ROLE_ARN}
BACKUP_ROLE_ARN=${CONTEXT_USE_BACKUP_ROLE_ARN}
EOF

cd "${root}/deploy"
docker compose --env-file "${secrets}/runtime.env" pull --quiet
docker compose --env-file "${secrets}/runtime.env" --profile migration run --rm migrate
if [ -n "${CONTEXT_USE_RECOVERY_BACKUP_KEY}" ]; then
  export PGPASSWORD="$(get_secret POSTGRES_PASSWORD)"
  docker compose --env-file "${secrets}/runtime.env" up -d postgres aws-credential-broker
  # Historical dumps contain grants to this retired role. Recreate it without
  # login authority only for the stopped restore, then let the cleanup
  # migration remove it before any application service starts.
  docker compose --env-file "${secrets}/runtime.env" exec -T -e PGPASSWORD postgres \
    psql -v ON_ERROR_STOP=1 -U postgres -d context_use \
    -c 'DROP ROLE IF EXISTS context_use_public_mcp; CREATE ROLE context_use_public_mcp NOLOGIN'
  docker compose --env-file "${secrets}/runtime.env" run --rm -T backup fetch "${CONTEXT_USE_RECOVERY_BACKUP_KEY}" \
    | gunzip \
    | docker compose --env-file "${secrets}/runtime.env" exec -T -e PGPASSWORD postgres psql --single-transaction -v ON_ERROR_STOP=1 -U postgres -d context_use
  docker compose --env-file "${secrets}/runtime.env" --profile migration run --rm migrate
  docker compose --env-file "${secrets}/runtime.env" exec -T -e PGPASSWORD postgres \
    psql -v ON_ERROR_STOP=1 -U postgres -d context_use \
    -c 'DROP ROLE IF EXISTS context_use_public_mcp'
fi
docker compose --env-file "${secrets}/runtime.env" up -d --remove-orphans
# Compose does not recreate a service when only bind-mounted file contents
# change. Recreate Caddy so every release loads the newly extracted Caddyfile.
docker compose --env-file "${secrets}/runtime.env" up -d --force-recreate --no-deps caddy
docker compose --env-file "${secrets}/runtime.env" ps
