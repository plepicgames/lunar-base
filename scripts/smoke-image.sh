#!/usr/bin/env bash
# Runs a built image the way the cluster will and checks the contract of the
# Deployment in `hannosirkel/deploys`: user 10001, a read-only root filesystem,
# the log directory as the only writable path, the game under
# `/play/lunar-base`, and a clean stop on SIGTERM.
#
# usage: scripts/smoke-image.sh IMAGE [BUILD]
#
# BUILD, when given, must be the build the server names at its start.
# `CONTAINER_ENGINE` chooses the engine (default `docker`); `SMOKE_PORT` the
# loopback port the game is published on (default 4780).
set -euo pipefail

if [ "$#" -lt 1 ] || [ "$#" -gt 2 ]; then
  printf 'usage: scripts/smoke-image.sh IMAGE [BUILD]\n' >&2
  exit 2
fi
image=$1
build=${2:-}
engine=${CONTAINER_ENGINE:-docker}
port=${SMOKE_PORT:-4780}
base=/play/lunar-base
url="http://127.0.0.1:${port}${base}"
name="lunar-base-smoke-$$"

fail() {
  printf 'smoke failed: %s\n' "$1" >&2
  "$engine" logs "$name" >&2 || true
  exit 1
}

cleanup() {
  "$engine" rm --force --volumes "$name" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# Podman mounts a writable `/tmp` under `--read-only` unless told not to.
read_only=(--read-only)
case "$engine" in
  *podman*) read_only+=(--read-only-tmpfs=false) ;;
esac

# No `TYPESAFE_API_KEY`: the image must start with Jev off.
"$engine" run --detach --name "$name" \
  --user 10001:10001 "${read_only[@]}" --cap-drop ALL --security-opt no-new-privileges \
  --mount type=volume,destination=/var/lib/lunar-base/games \
  --env HOST=0.0.0.0 --env PORT=4780 --env "LUNAR_BASE_PATH=$base" \
  --env LUNAR_LOG_DIR=/var/lib/lunar-base/games \
  --publish "127.0.0.1:${port}:4780" "$image" >/dev/null

status=000
for _ in $(seq 1 60); do
  status=$(curl --silent --output /dev/null --write-out '%{http_code}' "$url/healthz" || true)
  [ "$status" = 200 ] && break
  [ "$("$engine" inspect --format '{{.State.Running}}' "$name")" = true ] || fail 'the server exited'
  sleep 1
done
[ "$status" = 200 ] || fail "GET $base/healthz answered $status, not 200"

status=$(curl --silent --output /dev/null --write-out '%{http_code}' "$url/")
[ "$status" = 200 ] || fail "GET $base/ answered $status, not 200"

"$engine" kill --signal TERM "$name" >/dev/null
code=$(timeout 15 "$engine" wait "$name") || fail 'the server did not stop within 15 seconds of SIGTERM'
[ "$code" = 0 ] || fail "the server exited with code $code after SIGTERM"

logs=$("$engine" logs "$name" 2>&1)
printf '%s\n' "$logs"
case "$logs" in
  *EROFS* | *EACCES*) fail 'the server tried to write where it may not' ;;
esac
if [ -n "$build" ]; then
  grep --quiet --fixed-strings -- "build $build" <<<"$logs" || fail "the server did not name build $build"
fi
printf 'smoke passed: %s\n' "$image"
