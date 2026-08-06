#!/usr/bin/env bash
set -euo pipefail

: "${CONTEXT_USE_VERSION:?CONTEXT_USE_VERSION is required}"
: "${CONTEXT_USE_ENVIRONMENT:=production}"
: "${CONTEXT_USE_BUNDLE_URL:?CONTEXT_USE_BUNDLE_URL is required}"
: "${CONTEXT_USE_BUNDLE_SHA256:?CONTEXT_USE_BUNDLE_SHA256 is required}"
: "${CONTEXT_USE_APP_IMAGE:?CONTEXT_USE_APP_IMAGE is required}"
: "${CONTEXT_USE_BACKUP_IMAGE:?CONTEXT_USE_BACKUP_IMAGE is required}"
: "${CONTEXT_USE_OAUTH2_PROXY_IMAGE:=quay.io/oauth2-proxy/oauth2-proxy:v7.15.2@sha256:aa0bd8dd5ab0c78e4c91c92755ad573a5f92241f88138b4141b8ec803463b4fd}"
: "${CONTEXT_USE_PARAMETER_PREFIX:?CONTEXT_USE_PARAMETER_PREFIX is required}"
: "${CONTEXT_USE_STORAGE_ROLE_ARN:?CONTEXT_USE_STORAGE_ROLE_ARN is required}"
: "${CONTEXT_USE_BACKUP_ROLE_ARN:?CONTEXT_USE_BACKUP_ROLE_ARN is required}"
: "${CONTEXT_USE_RECOVERY_BACKUP_KEY:=}"
: "${CONTEXT_USE_RECOVERY_NANGO_BACKUP_KEY:=}"

if [[ ! "${CONTEXT_USE_OAUTH2_PROXY_IMAGE}" =~ @sha256:[0-9a-f]{64}$ ]]; then
  echo "CONTEXT_USE_OAUTH2_PROXY_IMAGE must be pinned by sha256 digest" >&2
  exit 2
fi

if [ -n "${CONTEXT_USE_RECOVERY_BACKUP_KEY}" ] && [[ ! "${CONTEXT_USE_RECOVERY_BACKUP_KEY}" =~ ^postgres/[0-9TZ-]+\.sql\.gz$ ]]; then
  echo "Invalid recovery backup key" >&2
  exit 2
fi
if [ -n "${CONTEXT_USE_RECOVERY_NANGO_BACKUP_KEY}" ] && [[ ! "${CONTEXT_USE_RECOVERY_NANGO_BACKUP_KEY}" =~ ^nango-postgres/[0-9TZ-]+\.sql\.gz$ ]]; then
  echo "Invalid Nango recovery backup key" >&2
  exit 2
fi

root=/opt/context-use
secrets=/data/context-use/secrets
mountpoint -q /data || { echo "Retained data volume is not mounted" >&2; exit 1; }
[ -s /data/context-use/.volume-id ] || { echo "Retained data volume marker is missing" >&2; exit 1; }
mkdir -p "${root}" "${secrets}" /data/context-use/{postgres,backup-tmp,nango-backup-tmp,nango-integrations,caddy/data,caddy/config}
chmod 0700 "${secrets}"
chmod 0700 /data/context-use/backup-tmp /data/context-use/nango-backup-tmp /data/context-use/nango-integrations
chown 70:70 /data/context-use/postgres
chmod 0700 /data/context-use/postgres

archive="/tmp/context-use-deployment-${CONTEXT_USE_VERSION}.tar.gz"
curl --proto '=https' --tlsv1.2 -fsSL "${CONTEXT_USE_BUNDLE_URL}" -o "${archive}"
echo "${CONTEXT_USE_BUNDLE_SHA256}  ${archive}" | sha256sum -c -
# Do not let a malformed bundle inherit an image pin from a previous release.
rm -f "${root}/deploy/release-images.env"
tar -xzf "${archive}" -C "${root}"
nango_image="$(bash "${root}/deploy/nango/read-release-image.sh" "${root}/deploy/release-images.env" NANGO_IMAGE)"
nango_integrations_image="$(bash "${root}/deploy/nango/read-release-image.sh" "${root}/deploy/release-images.env" NANGO_INTEGRATIONS_IMAGE)"

parameter_prefix="${CONTEXT_USE_PARAMETER_PREFIX}"
get_secret() {
  aws ssm get-parameter --name "${parameter_prefix}/$1" --with-decryption --query Parameter.Value --output text
}
get_secret_if_present() {
  aws ssm get-parameter --name "${parameter_prefix}/$1" --with-decryption --query Parameter.Value --output text 2>/dev/null || true
}

umask 077
owner_email="$(get_secret OWNER_EMAIL)"
app_hostname="$(get_secret APP_HOSTNAME)"
asset_hostname="$(get_secret ASSET_HOSTNAME)"
nango_hostname="$(get_secret NANGO_HOSTNAME)"
nango_dashboard_username="$(get_secret NANGO_DASHBOARD_USERNAME)"
nango_dashboard_password="$(get_secret NANGO_DASHBOARD_PASSWORD)"
case "${owner_email}${nango_dashboard_username}${nango_dashboard_password}" in
  *$'\n'*) echo "Identity and Nango dashboard credentials must be single-line values" >&2; exit 2 ;;
esac
case "${nango_dashboard_username}" in
  *:*) echo "Nango dashboard username cannot contain a colon" >&2; exit 2 ;;
esac
nango_dashboard_basic="$(printf '%s:%s' "${nango_dashboard_username}" "${nango_dashboard_password}" | base64 | tr -d '\n')"
printf '%s\n' "${owner_email}" > "${secrets}/nango-owner-email"
# The parent secrets directory remains 0700. Read-only world permission on the
# bind-mounted file lets OAuth2 Proxy's non-root image user read only this email.
chmod 0444 "${secrets}/nango-owner-email"

# Config validation runs with no network before the active edge is stopped.
# Keep its environment minimal and use only non-production placeholder secrets.
oauth2_validation_env="${secrets}/oauth2-proxy-validation.env"
printf '%s\n' \
  'OAUTH2_PROXY_HTTP_ADDRESS=0.0.0.0:4180' \
  'OAUTH2_PROXY_PROVIDER=oidc' \
  'OAUTH2_PROXY_PROVIDER_DISPLAY_NAME=Context Use passkey' \
  "OAUTH2_PROXY_OIDC_ISSUER_URL=https://${app_hostname}" \
  'OAUTH2_PROXY_SKIP_OIDC_DISCOVERY=true' \
  "OAUTH2_PROXY_LOGIN_URL=https://${app_hostname}/api/auth/oauth2/authorize" \
  'OAUTH2_PROXY_REDEEM_URL=http://auth:3002/api/auth/oauth2/token' \
  'OAUTH2_PROXY_OIDC_JWKS_URL=http://auth:3002/api/auth/jwks' \
  'OAUTH2_PROXY_OIDC_ENABLED_SIGNING_ALGS=EdDSA' \
  'OAUTH2_PROXY_SKIP_CLAIMS_FROM_PROFILE_URL=true' \
  'OAUTH2_PROXY_CLIENT_ID=validation-client' \
  'OAUTH2_PROXY_CLIENT_SECRET=validation-secret' \
  "OAUTH2_PROXY_REDIRECT_URL=https://${nango_hostname}/_context-use-auth/callback" \
  'OAUTH2_PROXY_SCOPE=openid email' \
  'OAUTH2_PROXY_CODE_CHALLENGE_METHOD=S256' \
  'OAUTH2_PROXY_INSECURE_OIDC_SKIP_NONCE=false' \
  'OAUTH2_PROXY_INSECURE_OIDC_ALLOW_UNVERIFIED_EMAIL=false' \
  'OAUTH2_PROXY_AUTHENTICATED_EMAILS_FILE=/etc/oauth2-proxy/authorized-emails' \
  'OAUTH2_PROXY_PROXY_PREFIX=/_context-use-auth' \
  'OAUTH2_PROXY_UPSTREAMS=static://202' \
  'OAUTH2_PROXY_SKIP_PROVIDER_BUTTON=true' \
  'OAUTH2_PROXY_REVERSE_PROXY=true' \
  'OAUTH2_PROXY_TRUSTED_PROXY_IPS=172.30.254.2/32,172.30.254.11/32' \
  "OAUTH2_PROXY_WHITELIST_DOMAINS=${nango_hostname}" \
  'OAUTH2_PROXY_SESSION_STORE_TYPE=cookie' \
  'OAUTH2_PROXY_COOKIE_NAME=__Host-context-use-nango' \
  'OAUTH2_PROXY_COOKIE_SECRET=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' \
  'OAUTH2_PROXY_COOKIE_SECURE=true' \
  'OAUTH2_PROXY_COOKIE_HTTPONLY=true' \
  'OAUTH2_PROXY_COOKIE_SAMESITE=strict' \
  'OAUTH2_PROXY_COOKIE_PATH=/' \
  'OAUTH2_PROXY_COOKIE_EXPIRE=10m' \
  'OAUTH2_PROXY_COOKIE_REFRESH=0' \
  'OAUTH2_PROXY_COOKIE_CSRF_PER_REQUEST=true' \
  'OAUTH2_PROXY_COOKIE_CSRF_PER_REQUEST_LIMIT=8' \
  'OAUTH2_PROXY_COOKIE_CSRF_EXPIRE=5m' \
  'OAUTH2_PROXY_SET_XAUTHREQUEST=true' \
  'OAUTH2_PROXY_PASS_ACCESS_TOKEN=true' \
  'OAUTH2_PROXY_SET_AUTHORIZATION_HEADER=false' \
  'OAUTH2_PROXY_PASS_AUTHORIZATION_HEADER=false' \
  'OAUTH2_PROXY_PASS_BASIC_AUTH=false' \
  'OAUTH2_PROXY_PASS_USER_HEADERS=false' \
  'OAUTH2_PROXY_SKIP_AUTH_STRIP_HEADERS=false' \
  'OAUTH2_PROXY_SKIP_AUTH_PREFLIGHT=false' \
  'OAUTH2_PROXY_SKIP_JWT_BEARER_TOKENS=false' \
  'OAUTH2_PROXY_PROXY_WEBSOCKETS=false' \
  'OAUTH2_PROXY_REQUEST_LOGGING=false' \
  'OAUTH2_PROXY_AUTH_LOGGING=false' \
  'OAUTH2_PROXY_STANDARD_LOGGING=true' \
  'OAUTH2_PROXY_SILENCE_PING_LOGGING=true' \
  'OAUTH2_PROXY_SHOW_DEBUG_ON_ERROR=false' \
  > "${oauth2_validation_env}"
chmod 0600 "${oauth2_validation_env}"

cat > "${secrets}/runtime.env" <<EOF
VERSION=${CONTEXT_USE_VERSION}
APP_IMAGE=${CONTEXT_USE_APP_IMAGE}
BACKUP_IMAGE=${CONTEXT_USE_BACKUP_IMAGE}
OAUTH2_PROXY_IMAGE=${CONTEXT_USE_OAUTH2_PROXY_IMAGE}
NANGO_IMAGE=${nango_image}
NANGO_INTEGRATIONS_IMAGE=${nango_integrations_image}
APP_HOSTNAME=${app_hostname}
ASSET_HOSTNAME=${asset_hostname}
NANGO_HOSTNAME=${nango_hostname}
OWNER_EMAIL=${owner_email}
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
NANGO_DB_PASSWORD=$(get_secret NANGO_DB_PASSWORD)
NANGO_BACKUP_DB_PASSWORD=$(get_secret NANGO_BACKUP_DB_PASSWORD)
NANGO_ENCRYPTION_KEY=$(get_secret NANGO_ENCRYPTION_KEY)
NANGO_ADMIN_KEY=$(get_secret NANGO_ADMIN_KEY)
NANGO_DASHBOARD_USERNAME=${nango_dashboard_username}
NANGO_DASHBOARD_PASSWORD=${nango_dashboard_password}
NANGO_DASHBOARD_BASIC=${nango_dashboard_basic}
NANGO_OAUTH_CLIENT_ID=$(get_secret NANGO_OAUTH_CLIENT_ID)
NANGO_OAUTH_CLIENT_SECRET=$(get_secret NANGO_OAUTH_CLIENT_SECRET)
NANGO_AUTH_COOKIE_SECRET=$(get_secret NANGO_AUTH_COOKIE_SECRET)
NANGO_PIPELINE_API_KEY=$(get_secret_if_present NANGO_PIPELINE_API_KEY)
MCP_ASSET_CAPABILITY_SECRET=$(get_secret MCP_ASSET_CAPABILITY_SECRET)
CONFIRMATION_GATEWAY_TOKEN=$(get_secret CONFIRMATION_GATEWAY_TOKEN)
AUTH_DASHBOARD_TOKEN=$(get_secret AUTH_DASHBOARD_TOKEN)
AUTH_MCP_TOKEN=$(get_secret AUTH_MCP_TOKEN)
AUTH_NANGO_TOKEN=$(get_secret AUTH_NANGO_TOKEN)
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
sh ./validate-nango-edge.sh .
docker compose --env-file "${secrets}/runtime.env" pull --quiet
# Validate every Caddyfile and every OAuth2 Proxy option before disconnecting
# the currently running edge. These commands do not publish ports or contact
# an upstream service.
caddy_image='caddy:2.10.2-alpine@sha256:4c6e91c6ed0e2fa03efd5b44747b625fec79bc9cd06ac5235a779726618e530d'
for caddyfile in Caddyfile.nango-public Caddyfile.nango-auth Caddyfile; do
  docker run --rm --network none --read-only --cap-drop ALL --cap-add NET_BIND_SERVICE --security-opt no-new-privileges \
    --tmpfs /tmp:rw,noexec,nosuid,size=8m \
    --tmpfs /data:rw,noexec,nosuid,size=8m \
    --tmpfs /config:rw,noexec,nosuid,size=8m \
    -e APP_HOSTNAME="${app_hostname}" \
    -e ASSET_HOSTNAME="${asset_hostname}" \
    -e NANGO_HOSTNAME="${nango_hostname}" \
    -e AUTH_NANGO_TOKEN=validation-only \
    -e NANGO_DASHBOARD_BASIC=dmFsaWRhdGlvbjpvbmx5 \
    -v "${root}/deploy/${caddyfile}:/etc/caddy/Caddyfile:ro" \
    "${caddy_image}" caddy validate --config /etc/caddy/Caddyfile
done
docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges \
  --tmpfs /tmp:rw,noexec,nosuid,size=8m \
  --env-file "${oauth2_validation_env}" \
  -v "${secrets}/nango-owner-email:/etc/oauth2-proxy/authorized-emails:ro" \
  "${CONTEXT_USE_OAUTH2_PROXY_IMAGE}" --config-test
docker compose --env-file "${secrets}/runtime.env" stop caddy
docker compose --env-file "${secrets}/runtime.env" stop \
  nango-auth-gateway nango-public-gateway oauth2-proxy nango-sso-redis \
  nango-jobs nango-backup nango-server nango-persist nango-orchestrator nango-redis
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
# The primary Context Use edge is independent from Nango. Bring it back after
# its own migration/restore so a later Nango failure cannot leave the main
# dashboard, MCP endpoint, or public pages offline.
docker compose --env-file "${secrets}/runtime.env" up -d caddy
docker compose --env-file "${secrets}/runtime.env" --profile nango-init run --rm nango-db-init
if [ -n "${CONTEXT_USE_RECOVERY_NANGO_BACKUP_KEY}" ]; then
  export PGPASSWORD="$(get_secret POSTGRES_PASSWORD)"
  docker compose --env-file "${secrets}/runtime.env" up -d postgres aws-credential-broker
  docker compose --env-file "${secrets}/runtime.env" exec -T -e PGPASSWORD postgres \
    psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres \
    -c 'DROP DATABASE IF EXISTS nango WITH (FORCE)'
  docker compose --env-file "${secrets}/runtime.env" --profile nango-init run --rm nango-db-init
  export PGPASSWORD="$(get_secret NANGO_DB_PASSWORD)"
  docker compose --env-file "${secrets}/runtime.env" run --rm --no-deps -T nango-backup \
    fetch "${CONTEXT_USE_RECOVERY_NANGO_BACKUP_KEY}" \
    | gunzip \
    | docker compose --env-file "${secrets}/runtime.env" exec -T -e PGPASSWORD postgres \
      psql -X --single-transaction -v ON_ERROR_STOP=1 -U nango_app -d nango
  docker compose --env-file "${secrets}/runtime.env" --profile nango-init run --rm nango-db-init
fi
docker compose --env-file "${secrets}/runtime.env" up -d --wait \
  postgres nango-redis nango-server
docker compose --env-file "${secrets}/runtime.env" up -d --wait \
  nango-orchestrator nango-persist nango-jobs
docker compose --env-file "${secrets}/runtime.env" up -d --wait \
  nango-sso-redis oauth2-proxy nango-public-gateway nango-auth-gateway
# Reconcile the read-only backup grants after Nango has applied every upstream
# migration, and set default grants for relations created between releases.
docker compose --env-file "${secrets}/runtime.env" --profile nango-init run --rm nango-db-init
docker compose --env-file "${secrets}/runtime.env" up -d --remove-orphans
# Compose does not recreate a service when only bind-mounted file contents
# change. Recreate Caddy so every release loads the newly extracted Caddyfile.
docker compose --env-file "${secrets}/runtime.env" up -d --force-recreate --no-deps caddy
docker compose --env-file "${secrets}/runtime.env" ps
