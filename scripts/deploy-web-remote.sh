#!/usr/bin/env bash
set -Eeuo pipefail

# Runs on the OVH host. This script builds one exact source archive, publishes
# it to an immutable directory, and atomically advances the `current` symlink.

if (( EUID != 0 )); then
  echo "deploy-web-remote.sh must run as root" >&2
  exit 1
fi

archive="${1:?usage: deploy-web-remote.sh ARCHIVE SHA256 COMMIT_SHA}"
expected_checksum="${2:?missing archive SHA-256}"
commit_sha="${3:?missing commit SHA}"
release_root="${VYBE_WEB_RELEASE_ROOT:-/srv/vybe-consumer}"
health_url="${VYBE_WEB_HEALTH_URL:-}"

if [[ ! "$commit_sha" =~ ^[0-9a-f]{40}$ ]]; then
  echo "commit SHA must be 40 lowercase hexadecimal characters" >&2
  exit 1
fi
if [[ ! "$expected_checksum" =~ ^[0-9a-f]{64}$ ]]; then
  echo "archive checksum must be 64 lowercase hexadecimal characters" >&2
  exit 1
fi
if [[ ! -f "$archive" ]]; then
  echo "source archive does not exist: $archive" >&2
  exit 1
fi

actual_checksum="$(sha256sum "$archive" | awk '{print $1}')"
if [[ "$actual_checksum" != "$expected_checksum" ]]; then
  echo "source archive checksum mismatch" >&2
  exit 1
fi

install -d -m 0755 "$release_root/releases"
exec 9>"$release_root/release.lock"
flock -x 9

release="$release_root/releases/$commit_sha"
current="$release_root/current"

if [[ -e "$release" ]]; then
  if [[ ! -f "$release/release.json" ]] \
    || ! grep -Fq "\"sourceSha256\": \"$expected_checksum\"" "$release/release.json"; then
    echo "refusing to replace an existing immutable release: $release" >&2
    exit 1
  fi
else
  job="$(mktemp -d "/var/tmp/vybe-web-${commit_sha}.XXXXXX")"
  stage="$release_root/releases/.${commit_sha}.stage.$$"
  cleanup() {
    rm -rf -- "$job"
    if [[ -n "${stage:-}" && -d "$stage" ]]; then
      rm -rf -- "$stage"
    fi
  }
  trap cleanup EXIT

  mkdir -p "$job/source" "$job/artifact"
  tar -xzf "$archive" -C "$job/source" --no-same-owner

  docker buildx build \
    --pull \
    --target artifact \
    --output "type=local,dest=$job/artifact" \
    --file "$job/source/Dockerfile.release" \
    "$job/source"

  site="$job/artifact/site"
  test -s "$site/index.html"
  test -s "$site/manifest.webmanifest"
  test -d "$site/assets"

  install -d -m 0755 "$stage"
  cp -a "$site/." "$stage/"
  cat >"$stage/release.json" <<EOF
{
  "commit": "$commit_sha",
  "sourceSha256": "$expected_checksum",
  "builtAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
  chmod -R a-w "$stage"
  mv "$stage" "$release"
fi

previous=""
if [[ -L "$current" ]]; then
  previous="$(readlink -f "$current")"
fi

next="$release_root/.current.next.$$"
ln -s "$release" "$next"
mv -Tf "$next" "$current"

if [[ -n "$health_url" ]] && ! curl --fail --silent --show-error \
  --retry 8 --retry-delay 1 --max-time 15 "$health_url" >/dev/null; then
  echo "public health check failed; restoring previous web release" >&2
  if [[ -n "$previous" && -d "$previous" ]]; then
    rollback_next="$release_root/.current.rollback.$$"
    ln -s "$previous" "$rollback_next"
    mv -Tf "$rollback_next" "$current"
  fi
  exit 1
fi

echo "published Vybe web commit $commit_sha"
