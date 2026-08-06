#!/bin/sh
set -eu

deploy_dir=${1:-.}
caddy_image=${2:-caddy:2.10.2-alpine@sha256:4c6e91c6ed0e2fa03efd5b44747b625fec79bc9cd06ac5235a779726618e530d}
deploy_dir=$(CDPATH= cd "${deploy_dir}" && pwd)
probe_id="nango-edge-probe-$$"
network_name="${probe_id}"
container_name="${probe_id}"

cleanup() {
  docker rm --force "${container_name}" >/dev/null 2>&1 || true
  docker network rm "${network_name}" >/dev/null 2>&1 || true
}
trap cleanup EXIT HUP INT TERM

docker network create "${network_name}" >/dev/null
docker run --detach --name "${container_name}" --network "${network_name}" \
  --network-alias nango-server \
  --publish 127.0.0.1::3000 \
  --read-only --cap-drop ALL --cap-add NET_BIND_SERVICE \
  --security-opt no-new-privileges \
  --tmpfs /tmp:rw,noexec,nosuid,size=8m \
  --tmpfs /data:rw,noexec,nosuid,size=8m \
  --tmpfs /config:rw,noexec,nosuid,size=8m \
  --volume "${deploy_dir}/Caddyfile.nango-public:/etc/caddy/Caddyfile:ro" \
  --env NANGO_HOSTNAME=nango.context.example.com \
  "${caddy_image}" caddy run --config /etc/caddy/Caddyfile >/dev/null

published_port=$(docker port "${container_name}" 3000/tcp | sed -n '1{s/.*://;p;}')
base_url="http://127.0.0.1:${published_port}"

ready=false
attempt=0
while [ "${attempt}" -lt 10 ]; do
  if [ "$(curl --http1.1 --silent --output /dev/null --write-out '%{http_code}' "${base_url}/healthz" || true)" = 200 ]; then
    ready=true
    break
  fi
  attempt=$((attempt + 1))
  sleep 1
done
if [ "${ready}" != true ]; then
  docker logs "${container_name}" >&2
  echo "Nango public gateway did not become ready" >&2
  exit 1
fi

probe_status() {
  expected=$1
  description=$2
  shift 2
  actual=$(curl --http1.1 --silent --output /dev/null --write-out '%{http_code}' "$@" "${base_url}/integrations")
  if [ "${actual}" != "${expected}" ]; then
    echo "Nango edge probe failed (${description}): expected ${expected}, got ${actual}" >&2
    exit 1
  fi
}

connect_token=nango_connect_session_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
connect_auth="Authorization: Bearer ${connect_token}"
api_key_auth='Authorization: Bearer nango_sk_test_api_key'

# An allowed request reaches the deliberately absent test upstream, whose dial
# failure the gateway's maintenance handler reports as 503. All ambiguous
# variants must instead stop at the gateway's default-deny 404. A denial is a
# response rather than an error, so it never reaches that handler and 503
# remains an unambiguous signal that the request was routed.
probe_status 503 'one Connect bearer is routed' --header "${connect_auth}"
probe_status 404 'an API key is rejected' --header "${api_key_auth}"
probe_status 404 'API key then Connect bearer is rejected' --header "${api_key_auth}" --header "${connect_auth}"
probe_status 404 'Connect bearer then API key is rejected' --header "${connect_auth}" --header "${api_key_auth}"
probe_status 404 'comma-joined API key then Connect bearer is rejected' --header "Authorization: Bearer nango_sk_test_api_key, Bearer ${connect_token}"
probe_status 404 'comma-joined Connect bearer then API key is rejected' --header "Authorization: Bearer ${connect_token}, Bearer nango_sk_test_api_key"
probe_status 404 'duplicate Connect bearers are rejected' --header "${connect_auth}" --header "${connect_auth}"

echo "Nango public gateway Authorization probes passed"
