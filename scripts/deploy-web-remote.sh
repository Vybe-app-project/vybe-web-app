#!/usr/bin/env bash
set -Eeuo pipefail

# Runs on the OVH host. This script builds one exact source archive, publishes
# it to an immutable directory, and atomically advances the `current` symlink.

check_current_release() {
  local expected="$1" current_path="$2" actual
  if [[ "$expected" != "none" && ! "$expected" =~ ^[0-9a-f]{40}$ ]]; then
    echo "expected current release must be a commit SHA or none" >&2
    return 1
  fi
  if [[ -L "$current_path" ]]; then
    actual="$(basename "$(readlink "$current_path")")"
  elif [[ -e "$current_path" ]]; then
    echo "current release is not a symlink" >&2
    return 1
  else
    actual="none"
  fi
  if [[ "$actual" != "$expected" ]]; then
    echo "current release changed: expected $expected, found $actual; refusing to overwrite another deployment" >&2
    return 1
  fi
}

if [[ "${1:-}" == "--check-current" ]]; then
  check_current_release "${2:?missing expected release}" "${3:?missing current symlink}"
  exit
fi

if (( EUID != 0 )); then
  echo "deploy-web-remote.sh must run as root" >&2
  exit 1
fi

archive="${1:?usage: deploy-web-remote.sh ARCHIVE SHA256 COMMIT_SHA EXPECTED_CURRENT}"
expected_checksum="${2:?missing archive SHA-256}"
commit_sha="${3:?missing commit SHA}"
expected_current="${4:?missing expected current release SHA or none}"
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
check_current_release "$expected_current" "$current"

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

# The archive has done its job; the immutable release directory is the record.
rm -f -- "$archive"

# Each release builds in BuildKit and leaves cache behind; keep a week of it
# for fast rebuilds and drop the rest. Release directories are untouched.
docker builder prune -f --filter until=168h >/dev/null 2>&1 || true

echo "published Vybe web commit $commit_sha"
