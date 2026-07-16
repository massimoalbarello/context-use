#!/usr/bin/env bash
set -euo pipefail

: "${APP_HOSTNAME:?APP_HOSTNAME is required}"
origin="https://${APP_HOSTNAME}"

healthy=false
for _ in $(seq 1 60); do
  if curl --proto '=https' --tlsv1.2 -fsS "${origin}/api/health" >/dev/null; then
    healthy=true
    break
  fi
  sleep 3
done
if [ "$healthy" != true ]; then
  echo "Deployment did not become healthy at ${origin}" >&2
  exit 1
fi

curl --proto '=https' --tlsv1.2 -fsS "${origin}/.well-known/oauth-protected-resource/mcp" >/dev/null

dashboard_status="$(curl --proto '=https' --tlsv1.2 -sS -o /dev/null -w '%{http_code}' \
  -H 'Authorization: Bearer invalid' "${origin}/api/dashboard/pages")"
test "$dashboard_status" = 401

mcp_status="$(curl --proto '=https' --tlsv1.2 -sS -o /dev/null -w '%{http_code}' \
  -X POST -H 'Cookie: better-auth.session_token=invalid' -H 'Content-Type: application/json' \
  --data '{}' "${origin}/mcp")"
test "$mcp_status" = 401
