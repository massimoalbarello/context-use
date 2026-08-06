#!/usr/bin/env bash
set -euo pipefail

deploy_dir=${1:-.}
# shellcheck source=compose-env.sh
source "${deploy_dir}/compose-env.sh"

temporary_dir="$(mktemp -d)"
cleanup() {
  rm -rf -- "${temporary_dir}"
}
trap cleanup EXIT HUP INT TERM

email="o'brien+\$USER\${OTHER}@example.com"
printf 'OWNER_EMAIL=%s\n' "$(compose_env_literal "${email}")" > "${temporary_dir}/runtime.env"
printf '%s\n' \
  'services:' \
  '  test:' \
  '    image: scratch' \
  '    environment:' \
  '      OWNER_EMAIL: ${OWNER_EMAIL}' \
  > "${temporary_dir}/compose.yml"

# The explicit test file must be the only source for this variable even when
# the surrounding CI or operator environment also defines OWNER_EMAIL.
unset OWNER_EMAIL

compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose "$@"
  else
    docker-compose "$@"
  fi
}

parsed="$(compose -f "${temporary_dir}/compose.yml" --env-file "${temporary_dir}/runtime.env" config --environment \
  | sed -n 's/^OWNER_EMAIL=//p')"
if [ "${parsed}" != "${email}" ]; then
  echo 'Compose env literal encoding changed the owner email' >&2
  exit 1
fi

echo 'Compose env literal encoding passed'
