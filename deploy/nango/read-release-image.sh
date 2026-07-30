#!/usr/bin/env bash
set -euo pipefail

metadata="${1:?release image metadata path is required}"
if [ ! -f "${metadata}" ]; then
  echo "Release image metadata is missing" >&2
  exit 1
fi

line_count="$(awk 'END { print NR }' "${metadata}")"
if [ "${line_count}" -ne 1 ]; then
  echo "Release image metadata must contain exactly one line" >&2
  exit 1
fi

line="$(sed -n '1p' "${metadata}")"
if [[ ! "${line}" =~ ^NANGO_IMAGE=(ghcr\.io/massimoalbarello/context-use-nango@sha256:[a-f0-9]{64})$ ]]; then
  echo "Release image metadata contains an invalid Nango image reference" >&2
  exit 1
fi

printf '%s\n' "${BASH_REMATCH[1]}"
