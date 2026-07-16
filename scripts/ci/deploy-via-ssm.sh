#!/usr/bin/env bash
set -euo pipefail

: "${AWS_REGION:?AWS_REGION is required}"
: "${INSTANCE_ID:?INSTANCE_ID is required}"
: "${CONTEXT_USE_VERSION:?CONTEXT_USE_VERSION is required}"
: "${CONTEXT_USE_BUNDLE_URL:?CONTEXT_USE_BUNDLE_URL is required}"
: "${CONTEXT_USE_BUNDLE_SHA256:?CONTEXT_USE_BUNDLE_SHA256 is required}"
: "${CONTEXT_USE_APP_IMAGE:?CONTEXT_USE_APP_IMAGE is required}"
: "${CONTEXT_USE_BACKUP_IMAGE:?CONTEXT_USE_BACKUP_IMAGE is required}"
: "${CONTEXT_USE_PARAMETER_PREFIX:?CONTEXT_USE_PARAMETER_PREFIX is required}"

echo "Waiting for ${INSTANCE_ID} to register with SSM..."
ssm_online=false
for _ in $(seq 1 60); do
  ping="$(aws ssm describe-instance-information \
    --filters "Key=InstanceIds,Values=${INSTANCE_ID}" \
    --query 'InstanceInformationList[0].PingStatus' --output text 2>/dev/null || true)"
  if [ "$ping" = Online ]; then
    ssm_online=true
    break
  fi
  sleep 10
done
if [ "$ssm_online" != true ]; then
  echo "Instance ${INSTANCE_ID} did not register with SSM within 10 minutes" >&2
  exit 1
fi

deploy_script="$(base64 < deploy/deploy.sh | tr -d '\n')"
verify_script="$(base64 < scripts/ci/verify-on-instance.sh | tr -d '\n')"
exports="$(jq -rn \
  --arg version "$CONTEXT_USE_VERSION" \
  --arg bundle_url "$CONTEXT_USE_BUNDLE_URL" \
  --arg bundle_sha "$CONTEXT_USE_BUNDLE_SHA256" \
  --arg app_image "$CONTEXT_USE_APP_IMAGE" \
  --arg backup_image "$CONTEXT_USE_BACKUP_IMAGE" \
  --arg prefix "$CONTEXT_USE_PARAMETER_PREFIX" \
  '"export CONTEXT_USE_VERSION=\($version|@sh) CONTEXT_USE_ENVIRONMENT=production CONTEXT_USE_BUNDLE_URL=\($bundle_url|@sh) CONTEXT_USE_BUNDLE_SHA256=\($bundle_sha|@sh) CONTEXT_USE_APP_IMAGE=\($app_image|@sh) CONTEXT_USE_BACKUP_IMAGE=\($backup_image|@sh) CONTEXT_USE_PARAMETER_PREFIX=\($prefix|@sh)"')"

remote_script="$(cat <<REMOTE
set -euo pipefail
cleanup() {
  rm -f /tmp/context-use-deploy.sh /tmp/context-use-verify.sh
}
trap cleanup EXIT
if ! timeout 600 bash -c 'until command -v aws >/dev/null 2>&1 && command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1 && docker compose version >/dev/null 2>&1 && mountpoint -q /data && [ -d /data/context-use ]; do sleep 5; done'; then
  echo 'EC2 bootstrap did not finish within 10 minutes' >&2
  exit 1
fi
if [ -f /data/context-use/secrets/runtime.env ] && [ -f /opt/context-use/deploy/docker-compose.yml ]; then
  cd /opt/context-use/deploy
  docker compose --env-file /data/context-use/secrets/runtime.env run --rm backup once
fi
printf '%s' '${deploy_script}' | base64 -d > /tmp/context-use-deploy.sh
printf '%s' '${verify_script}' | base64 -d > /tmp/context-use-verify.sh
chmod 0700 /tmp/context-use-deploy.sh /tmp/context-use-verify.sh
${exports}
/tmp/context-use-deploy.sh
/tmp/context-use-verify.sh
REMOTE
)"

parameters="$(mktemp)"
trap 'rm -f "$parameters"' EXIT
jq -n --arg script "$remote_script" '{commands:[$script]}' > "$parameters"

command_id="$(aws ssm send-command \
  --document-name AWS-RunShellScript \
  --comment "Deploy ${CONTEXT_USE_VERSION}" \
  --instance-ids "$INSTANCE_ID" \
  --parameters "file://${parameters}" \
  --query Command.CommandId --output text)"
echo "SSM command: $command_id"

status=Pending
for _ in $(seq 1 90); do
  status="$(aws ssm get-command-invocation --command-id "$command_id" --instance-id "$INSTANCE_ID" \
    --query Status --output text 2>/dev/null || echo Pending)"
  case "$status" in
    Success|Failed|Cancelled|TimedOut) break ;;
  esac
  sleep 10
done

aws ssm get-command-invocation --command-id "$command_id" --instance-id "$INSTANCE_ID" \
  --query StandardOutputContent --output text || true
if [ "$status" != Success ]; then
  aws ssm get-command-invocation --command-id "$command_id" --instance-id "$INSTANCE_ID" \
    --query StandardErrorContent --output text || true
  echo "SSM deployment failed with status ${status}" >&2
  exit 1
fi
