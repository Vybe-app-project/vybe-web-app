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
# Where the API's client policy can be read without opening any env file:
# the public capabilities endpoint, by default on the same origin as the
# health check (the web origin proxies /api).
capabilities_url="${VYBE_API_CAPABILITIES_URL:-}"
if [[ -z "$capabilities_url" && "$health_url" =~ ^(https?://[^/]+) ]]; then
  capabilities_url="${BASH_REMATCH[1]}/api/capabilities"
fi

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

# The web version this build will announce in X-Vybe-Client: the package
# MAJOR, then the UTC date and time (MAJOR.YYYYMMDD.HHMM, no leading zero on
# the time). The same rule lives in vite.config.ts, which derives it from its
# own clock when no value is passed; passing it makes the floor check below
# compare the exact version being built.
web_version_for() {
  local package_json="$1" major
  major="$(sed -n 's/^[[:space:]]*"version":[[:space:]]*"\([0-9]\{1,9\}\)\..*/\1/p' "$package_json" | head -n1)"
  if [[ -z "$major" ]]; then
    echo "could not read the package MAJOR version from $package_json" >&2
    return 1
  fi
  printf '%s.%s.%s\n' "$major" "$(date -u +%Y%m%d)" "$((10#$(date -u +%H%M)))"
}

# Refuse to publish a web version below the API's web floor
# (CLIENT_MIN_VERSION_WEB). The floor is read from GET /api/capabilities,
# never from an API env file. A floor above the version going live would put
# every tab on the Reload Vybe screen with nothing newer to reload onto; the
# operator lowers or unsets the floor, restarts the API and deploys again.
check_web_floor() {
  local version="$1" body floor lowest
  if [[ -z "$capabilities_url" ]]; then
    echo "note: no capabilities URL (set VYBE_WEB_HEALTH_URL or VYBE_API_CAPABILITIES_URL); the API web floor was not checked" >&2
    return 0
  fi
  if ! body="$(curl --fail --silent --show-error --retry 3 --retry-delay 1 --max-time 15 "$capabilities_url")"; then
    echo "could not read $capabilities_url to check the API web floor" >&2
    return 1
  fi
  if command -v python3 >/dev/null 2>&1; then
    floor="$(printf '%s' "$body" | python3 -c '
import json, sys
client = json.load(sys.stdin).get("client") or {}
web = (client.get("platforms") or {}).get("web") or {}
value = web.get("minVersion")
print(value if isinstance(value, str) else "")
')"
  else
    floor="$(printf '%s' "$body" | sed -n 's/.*"web":{"minVersion":"\([^"]*\)".*/\1/p' | head -n1)"
  fi
  if [[ -z "$floor" ]]; then
    echo "API web floor: none; publishing web $version"
    return 0
  fi
  if [[ ! "$floor" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "note: API web floor '$floor' is not MAJOR.MINOR.PATCH, so the API compares nothing against it; publishing web $version" >&2
    return 0
  fi
  lowest="$(printf '%s\n%s\n' "$floor" "$version" | sort -V | head -n1)"
  if [[ "$lowest" == "$version" && "$version" != "$floor" ]]; then
    echo "refusing to publish web $version: the API web floor is $floor (CLIENT_MIN_VERSION_WEB), so every tab would land on the Reload Vybe screen with nothing newer to load. Lower or unset the floor, restart the API, then deploy again." >&2
    return 1
  fi
  echo "API web floor $floor; publishing web $version"
}

install -d -m 0755 "$release_root/releases"
exec 9>"$release_root/release.lock"
flock -x 9

release="$release_root/releases/$commit_sha"
current="$release_root/current"

web_version=""
if [[ -e "$release" ]]; then
  if [[ ! -f "$release/release.json" ]] \
    || ! grep -Fq "\"sourceSha256\": \"$expected_checksum\"" "$release/release.json"; then
    echo "refusing to replace an existing immutable release: $release" >&2
    exit 1
  fi
  # Re-pointing at a release built earlier: its version is fixed, so it is
  # checked against today's floor before it goes live again.
  web_version="$(sed -n 's/^[[:space:]]*"webVersion": "\([0-9.]*\)".*/\1/p' "$release/release.json" | head -n1)"
  if [[ -n "$web_version" ]]; then
    check_web_floor "$web_version"
  else
    echo "note: $release/release.json records no webVersion (built before the version rule); the API web floor was not checked" >&2
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

  web_version="$(web_version_for "$job/source/package.json")"
  check_web_floor "$web_version"

  docker buildx build \
    --pull \
    --build-arg "VITE_WEB_BUILD=${commit_sha:0:12}" \
    --build-arg "VITE_WEB_VERSION=$web_version" \
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
  "webVersion": "$web_version",
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
