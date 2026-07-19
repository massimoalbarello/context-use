#!/usr/bin/env bash
set -euo pipefail

file=""
trap 'if [ -n "${file}" ]; then rm -f "${file}"; fi' EXIT

backup_once() {
  timestamp="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
  file="/tmp/context-use-${timestamp}.sql.gz"
  pg_dump --format=plain --clean --if-exists --no-owner | gzip -9 > "${file}"
  test -s "${file}"
  gzip -t "${file}"
  aws s3 cp "${file}" "s3://${BACKUP_BUCKET}/postgres/${timestamp}.sql.gz" \
    --sse aws:kms --sse-kms-key-id "${KMS_KEY_ID}" --only-show-errors
  rm -f "${file}"
  file=""
  cutoff="$(date -u -d "-${RETENTION_DAYS:-30} days" +%s 2>/dev/null || date -u -v-30d +%s)"
  aws s3api list-objects-v2 --bucket "${BACKUP_BUCKET}" --prefix postgres/ --output json \
    | jq -r '.Contents[]? | [.Key,.LastModified] | @tsv' 2>/dev/null \
    | while IFS=$'\t' read -r key modified; do
        modified_epoch="$(date -u -d "${modified}" +%s 2>/dev/null || echo 0)"
        if [ "${modified_epoch}" -gt 0 ] && [ "${modified_epoch}" -lt "${cutoff}" ]; then
          aws s3api delete-object --bucket "${BACKUP_BUCKET}" --key "${key}" >/dev/null
        fi
      done
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
  aws s3 cp "s3://${BACKUP_BUCKET}/${key}" - --only-show-errors
  exit 0
fi

while true; do
  backup_once
  sleep 86400
done
