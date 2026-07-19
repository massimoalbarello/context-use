#!/usr/bin/env bash
set -uo pipefail

: "${STORAGE_ROLE_ARN:?STORAGE_ROLE_ARN is required}"
: "${BACKUP_ROLE_ARN:?BACKUP_ROLE_ARN is required}"

storage_file=/run/context-use-aws-storage/credentials.json
backup_file=/run/context-use-aws-backup/credentials.json

# Never let a stale credential file make the broker appear healthy after a
# restart. Each consumer starts only after both roles were freshly assumed.
rm -f "${storage_file}" "${backup_file}"

write_credentials() {
  local role_arn="$1"
  local session_name="$2"
  local destination="$3"
  local owner="$4"
  local temporary
  temporary="$(mktemp "${destination}.XXXXXX")" || return 1
  if ! aws sts assume-role \
      --role-arn "${role_arn}" \
      --role-session-name "${session_name}" \
      --duration-seconds 3600 \
      --query Credentials \
      --output json \
    | jq '{Version:1,AccessKeyId,SecretAccessKey,SessionToken,Expiration}' > "${temporary}"; then
    rm -f "${temporary}"
    return 1
  fi
  chmod 0400 "${temporary}"
  chown "${owner}" "${temporary}"
  mv -f "${temporary}" "${destination}"
}

while true; do
  storage_ok=false
  backup_ok=false
  write_credentials "${STORAGE_ROLE_ARN}" context-use-storage "${storage_file}" 1000:1000 && storage_ok=true
  write_credentials "${BACKUP_ROLE_ARN}" context-use-backup "${backup_file}" 0:0 && backup_ok=true
  if "${storage_ok}" && "${backup_ok}"; then
    sleep 1800
  else
    sleep 30
  fi
done
