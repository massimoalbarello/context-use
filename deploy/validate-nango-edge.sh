#!/bin/sh
set -eu

deploy_dir=${1:-.}
edge_config="${deploy_dir}/Caddyfile"
auth_config="${deploy_dir}/Caddyfile.nango-auth"
public_config="${deploy_dir}/Caddyfile.nango-public"
deploy_script="${deploy_dir}/deploy.sh"

require_line() {
  file=$1
  expected=$2
  if ! grep -Fq -- "${expected}" "${file}"; then
    echo "Nango edge invariant missing from ${file}: ${expected}" >&2
    exit 1
  fi
}

reject_line() {
  file=$1
  forbidden=$2
  if grep -Fq -- "${forbidden}" "${file}"; then
    echo "Forbidden Nango edge configuration in ${file}: ${forbidden}" >&2
    exit 1
  fi
}

require_count() {
  file=$1
  expected=$2
  count=$3
  actual=$(grep -Fc -- "${expected}" "${file}" || true)
  if [ "${actual}" -ne "${count}" ]; then
    echo "Expected ${count} occurrences in ${file}, found ${actual}: ${expected}" >&2
    exit 1
  fi
}

# OAuth2 Proxy returns a raw token. It must be copied into a private temporary
# header and explicitly wrapped in Bearer before Context Use sees it.
require_line "${auth_config}" "copy_headers X-Auth-Request-Access-Token>X-Context-Use-Access-Token"
require_line "${auth_config}" 'request_header Authorization "Bearer {http.request.header.X-Context-Use-Access-Token}"'
reject_line "${auth_config}" "copy_headers X-Auth-Request-Access-Token>Authorization"

# The browser-facing edge must not reach Nango or OAuth2 Proxy's token-bearing
# /auth endpoint directly. Both inner gateways independently default-deny.
reject_line "${edge_config}" "reverse_proxy nango-server:"
reject_line "${edge_config}" "/_context-use-auth/auth"
require_line "${public_config}" 'respond "Not found" 404'
require_line "${public_config}" "path /connect-ui/*"
require_line "${public_config}" "path /connect/ws"
require_line "${public_config}" 'vars_regexp connect_session_token {query.connect_session_token} ^nango_connect_session_[a-f0-9]{64}$'
reject_line "${public_config}" 'query connect_session_token=nango_connect_session_*'
require_count "${public_config}" 'vars_regexp connect_bearer {http.request.header.Authorization} "^Bearer nango_connect_session_[a-f0-9]{64}$"' 3
require_count "${public_config}" 'header_up Authorization "{re.connect_bearer.0}"' 3
reject_line "${public_config}" 'header Authorization "Bearer nango_connect_session_*"'
require_line "${edge_config}" "@public_connect_ui"
require_line "${edge_config}" "@public_connect_socket"
require_line "${edge_config}" 'rewrite * {path}?'
require_line "${public_config}" 'rewrite * {path}?'
require_line "${auth_config}" "/connect-ui /connect-ui/* /connect/ws"

# Runtime proxy errors include request.uri unless every Caddy logger filters it.
# Strip all query values because provider-specific parameter names are unbounded.
for config in "${edge_config}" "${auth_config}" "${public_config}"; do
  require_line "${config}" 'request>uri regexp \?.*$ ?redacted'
  for tracing_header in \
    Baggage Traceparent Tracestate Uber-Trace-Id X-Amzn-Trace-Id \
    X-Datadog-Trace-Id X-Datadog-Parent-Id X-Datadog-Sampling-Priority \
    X-Datadog-Origin X-Datadog-Tags
  do
    require_line "${config}" "request_header -${tracing_header}"
  done
done

# Neither the OIDC ticket nor its bearer token may cross into Nango.
require_line "${auth_config}" "header_up -Cookie"
require_line "${auth_config}" 'header_up Authorization "Basic {$NANGO_DASHBOARD_BASIC}"'
require_line "${auth_config}" "header_up -X-Context-Use-Access-Token"
require_line "${auth_config}" "@non_dashboard_namespace"
require_line "${public_config}" "__Host-context-use-nango"

# The official Caddy binary carries cap_net_bind_service as a file capability.
# The production preflight must retain that one bounding-set capability and
# invoke the binary explicitly, just like CI and the gateway services.
require_line "${deploy_script}" "--cap-add NET_BIND_SERVICE"
require_line "${deploy_script}" '"${caddy_image}" caddy validate --config /etc/caddy/Caddyfile'
