#!/usr/bin/env bash
set -Eeuo pipefail

if (( EUID != 0 )); then
  echo "rollback-web-remote.sh must run as root" >&2
  exit 1
fi

commit_sha="${1:?usage: rollback-web-remote.sh COMMIT_SHA}"
release_root="${VYBE_WEB_RELEASE_ROOT:-/srv/vybe-consumer}"
health_url="${VYBE_WEB_HEALTH_URL:-}"

if [[ ! "$commit_sha" =~ ^[0-9a-f]{40}$ ]]; then
  echo "commit SHA must be 40 lowercase hexadecimal characters" >&2
  exit 1
fi

release="$release_root/releases/$commit_sha"
current="$release_root/current"
test -s "$release/index.html"
test -s "$release/release.json"

exec 9>"$release_root/release.lock"
flock -x 9
previous=""
if [[ -L "$current" ]]; then
  previous="$(readlink -f "$current")"
fi

next="$release_root/.current.rollback.$$"
ln -s "$release" "$next"
mv -Tf "$next" "$current"

if [[ -n "$health_url" ]] && ! curl --fail --silent --show-error \
  --retry 8 --retry-delay 1 --max-time 15 "$health_url" >/dev/null; then
  if [[ -n "$previous" && -d "$previous" ]]; then
    restore="$release_root/.current.restore.$$"
    ln -s "$previous" "$restore"
    mv -Tf "$restore" "$current"
  fi
  echo "rollback health check failed; restored the prior release" >&2
  exit 1
fi

echo "rolled Vybe web back to $commit_sha"
