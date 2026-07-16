#!/usr/bin/env bash
set -euo pipefail

plan_file="${1:-tfplan}"
if [ ! -f "$plan_file" ]; then
  echo "Usage: $0 <terraform-plan-file>" >&2
  exit 2
fi

plan_directory="$(dirname "$plan_file")"
plan_basename="$(basename "$plan_file")"

destroyed_addresses=()
while IFS= read -r address; do
  if [ -n "$address" ]; then destroyed_addresses+=("$address"); fi
done < <(
  terraform -chdir="$plan_directory" show -json "$plan_basename" \
    | jq -r '.resource_changes[]? | select(.change.actions | index("delete")) | .address' \
    | sort -u
)

if [ "${#destroyed_addresses[@]}" -eq 0 ]; then
  exit 0
fi

{
  echo '## Destructive Terraform plan blocked'
  echo
  echo 'The plan would destroy or replace:'
  echo '```'
  printf '%s\n' "${destroyed_addresses[@]}"
  echo '```'
  echo
  # The backticks below are Markdown, not command substitution.
  # shellcheck disable=SC2016
  echo 'If this is intentional, rerun the workflow manually with `allow_destroy` enabled.'
} >> "${GITHUB_STEP_SUMMARY:-/dev/stderr}"

echo "::error title=Destructive Terraform plan blocked::Plan contains delete actions"
exit 1
