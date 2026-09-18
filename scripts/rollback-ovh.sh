#!/usr/bin/env bash
set -Eeuo pipefail

# Switches the live web release back to a previously published commit. Only the
# `current` symlink changes; release directories stay read-only and production
# data is untouched. Mirrors release-ovh.sh: the remote step runs as root via
# `sudo -n` and streams scripts/rollback-web-remote.sh over SSH.
#
#   VYBE_OVH_HOST=<ssh alias> VYBE_WEB_HEALTH_URL=https://<origin>/healthz.json \
#     scripts/rollback-ovh.sh <40-char commit sha>
#
# List candidates with: ssh <alias> ls /srv/vybe-consumer/releases

: "${VYBE_OVH_HOST:?set VYBE_OVH_HOST to an SSH destination, for example an SSH config alias}"
commit_sha="${1:?usage: rollback-ovh.sh COMMIT_SHA}"

if [[ ! "$VYBE_OVH_HOST" =~ ^[A-Za-z0-9_.@:-]+$ ]]; then
  echo "VYBE_OVH_HOST contains unsupported characters" >&2
  exit 1
fi
if [[ ! "$commit_sha" =~ ^[0-9a-f]{40}$ ]]; then
  echo "commit SHA must be 40 lowercase hexadecimal characters" >&2
  exit 1
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
release_root="${VYBE_WEB_RELEASE_ROOT:-/srv/vybe-consumer}"
health_url="${VYBE_WEB_HEALTH_URL:-}"

if [[ ! "$release_root" =~ ^/[A-Za-z0-9._/-]+$ ]]; then
  echo "remote paths must be absolute and contain only safe path characters" >&2
  exit 1
fi

printf -v quoted_commit '%q' "$commit_sha"
printf -v quoted_release_root '%q' "$release_root"
printf -v quoted_health_url '%q' "$health_url"

# Every interpolated remote value is printf-%q escaped above.
# shellcheck disable=SC2029
ssh "$VYBE_OVH_HOST" \
  "sudo -n env VYBE_WEB_RELEASE_ROOT=$quoted_release_root VYBE_WEB_HEALTH_URL=$quoted_health_url bash -s -- $quoted_commit" \
  <"$repo_root/scripts/rollback-web-remote.sh"
