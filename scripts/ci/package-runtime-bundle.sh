#!/usr/bin/env bash
set -euo pipefail

output_path="${1:?Usage: package-runtime-bundle.sh OUTPUT_PATH}"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

mkdir -p "$(dirname "$output_path")"
tar -czf "$output_path" -C "$repo_root" \
  deploy/Caddyfile \
  deploy/deploy.sh \
  deploy/docker-compose.yml
