#!/usr/bin/env bash
set -euo pipefail

file=""
metadata=""
trap 'rm -f "${file}" "${metadata}"' EXIT

backup_once() {
  timestamp="$(date -u +%Y-%m-%dT%H-%M-%S-%NZ)"
  file="/tmp/context-use-${timestamp}.sql.gz"
  metadata="/tmp/context-use-${timestamp}.json"
  key="postgres/${timestamp}.sql.gz"
  pg_dump --format=plain --clean --if-exists --no-owner | gzip -9 > "${file}"
  test -s "${file}"
  gzip -t "${file}"
  sha256="$(sha256sum "${file}" | cut -d ' ' -f 1)"
  size="$(wc -c < "${file}" | tr -d ' ')"
  jq -n \
    --arg format context-use-postgres-v1 \
    --arg objectKey "${key}" \
    --arg releaseVersion "${VERSION}" \
    --arg schemaVersion "${SCHEMA_VERSION}" \
    --arg createdAt "${timestamp}" \
    --arg sha256 "${sha256}" \
    --argjson sizeBytes "${size}" \
    '{format:$format,objectKey:$objectKey,releaseVersion:$releaseVersion,schemaVersion:$schemaVersion,createdAt:$createdAt,sha256:$sha256,sizeBytes:$sizeBytes}' \
    > "${metadata}"
  aws s3 cp "${metadata}" "s3://${BACKUP_BUCKET}/${key%.sql.gz}.json" \
    --sse aws:kms --sse-kms-key-id "${KMS_KEY_ID}" --only-show-errors
  aws s3 cp "${file}" "s3://${BACKUP_BUCKET}/${key}" \
    --sse aws:kms --sse-kms-key-id "${KMS_KEY_ID}" --only-show-errors
  rm -f "${file}" "${metadata}"
  file=""
  metadata=""
}

if [ "${1:-}" = "once" ]; then
  backup_once
  exit 0
fi

if [ "${1:-}" = "fetch" ]; then
  key="${2:-}"
  if [[ ! "${key}" =~ ^postgres/[0-9TZ-]+\.sql\.gz$ ]]; then
    echo "Invalid backup key" >&2
    exit 2
  fi
  file="/tmp/context-use-restore.sql.gz"
  metadata="/tmp/context-use-restore.json"
  aws s3 cp "s3://${BACKUP_BUCKET}/${key}" "${file}" --only-show-errors
  aws s3 cp "s3://${BACKUP_BUCKET}/${key%.sql.gz}.json" "${metadata}" --only-show-errors
  jq -e \
    --arg key "${key}" \
    '.format == "context-use-postgres-v1" and .objectKey == $key and (.releaseVersion | type == "string" and length > 0) and (.schemaVersion | type == "string" and length > 0) and (.sha256 | test("^[a-f0-9]{64}$")) and (.sizeBytes | type == "number" and . > 0)' \
    "${metadata}" >/dev/null
  test "$(wc -c < "${file}" | tr -d ' ')" = "$(jq -r .sizeBytes "${metadata}")"
  echo "$(jq -r .sha256 "${metadata}")  ${file}" | sha256sum -c - >/dev/null
  gzip -t "${file}"
  cat "${file}"
  exit 0
fi

while true; do
  backup_once
  sleep 86400
done
