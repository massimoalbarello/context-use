#!/usr/bin/env bash
set -euo pipefail

metadata="${1:?release image metadata path is required}"
requested_key="${2:-NANGO_IMAGE}"
if [ ! -f "${metadata}" ]; then
  echo "Release image metadata is missing" >&2
  exit 1
fi

line_count="$(awk 'END { print NR }' "${metadata}")"
if [ "${line_count}" -ne 2 ]; then
  echo "Release image metadata must contain exactly two lines" >&2
  exit 1
fi

if [ "$(grep -c '^NANGO_IMAGE=' "${metadata}" || true)" -ne 1 ] \
  || [ "$(grep -c '^NANGO_INTEGRATIONS_IMAGE=' "${metadata}" || true)" -ne 1 ]; then
  echo "Release image metadata must contain each expected key exactly once" >&2
  exit 1
fi

nango_line="$(grep '^NANGO_IMAGE=' "${metadata}")"
integrations_line="$(grep '^NANGO_INTEGRATIONS_IMAGE=' "${metadata}")"
if [[ ! "${nango_line}" =~ ^NANGO_IMAGE=(ghcr\.io/massimoalbarello/context-use-nango@sha256:[a-f0-9]{64})$ ]]; then
  echo "Release image metadata contains an invalid Nango image reference" >&2
  exit 1
fi
nango_image="${BASH_REMATCH[1]}"
if [[ ! "${integrations_line}" =~ ^NANGO_INTEGRATIONS_IMAGE=(ghcr\.io/massimoalbarello/context-use-nango@sha256:[a-f0-9]{64})$ ]]; then
  echo "Release image metadata contains an invalid Nango integrations image reference" >&2
  exit 1
fi
integrations_image="${BASH_REMATCH[1]}"
if [ "${nango_image}" = "${integrations_image}" ]; then
  echo "Release image metadata must use distinct Nango runtime and integrations digests" >&2
  exit 1
fi

case "${requested_key}" in
  NANGO_IMAGE) printf '%s\n' "${nango_image}" ;;
  NANGO_INTEGRATIONS_IMAGE) printf '%s\n' "${integrations_image}" ;;
  *) echo "Unknown release image key: ${requested_key}" >&2; exit 1 ;;
esac
