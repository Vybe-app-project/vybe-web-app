#!/usr/bin/env bash
set -Eeuo pipefail

# Builds and publishes on OVH without a GitHub Actions runner. Only committed,
# clean source is archived, checksummed, uploaded, and handed to the remote
# transactional deploy script.

: "${VYBE_OVH_HOST:?set VYBE_OVH_HOST to an SSH destination, for example an SSH config alias}"

if [[ ! "$VYBE_OVH_HOST" =~ ^[A-Za-z0-9_.@:-]+$ ]]; then
  echo "VYBE_OVH_HOST contains unsupported characters" >&2
  exit 1
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

if [[ -n "$(git status --porcelain --untracked-files=normal)" ]]; then
  echo "refusing to release a dirty worktree; commit or stash every change first" >&2
  exit 1
fi

commit_sha="$(git rev-parse --verify HEAD)"
if [[ ! "$commit_sha" =~ ^[0-9a-f]{40}$ ]]; then
  echo "could not resolve an exact commit SHA" >&2
  exit 1
fi

work="$(mktemp -d "${TMPDIR:-/tmp}/vybe-web-release.XXXXXX")"
cleanup() { rm -rf -- "$work"; }
trap cleanup EXIT

archive="$work/$commit_sha.tar.gz"
git archive --format=tar HEAD | gzip -n -9 >"$archive"
checksum="$(shasum -a 256 "$archive" | awk '{print $1}')"

remote_incoming="${VYBE_WEB_INCOMING_ROOT:-/opt/vybe-web-builder/incoming}"
remote_archive="$remote_incoming/$commit_sha.tar.gz"
release_root="${VYBE_WEB_RELEASE_ROOT:-/srv/vybe-consumer}"
health_url="${VYBE_WEB_HEALTH_URL:-}"

if [[ ! "$remote_incoming" =~ ^/[A-Za-z0-9._/-]+$ ]] \
  || [[ ! "$release_root" =~ ^/[A-Za-z0-9._/-]+$ ]]; then
  echo "remote paths must be absolute and contain only safe path characters" >&2
  exit 1
fi

printf -v quoted_incoming '%q' "$remote_incoming"
printf -v quoted_archive '%q' "$remote_archive"
printf -v quoted_checksum '%q' "$checksum"
printf -v quoted_commit '%q' "$commit_sha"
printf -v quoted_release_root '%q' "$release_root"
printf -v quoted_health_url '%q' "$health_url"

# Capture the release base before uploading; the remote transaction checks it
# again under the deployment lock so another release cannot be overwritten.
expected_current="$(ssh "$VYBE_OVH_HOST" \
  "if test -L $quoted_release_root/current; then basename \"\$(readlink $quoted_release_root/current)\"; elif test -e $quoted_release_root/current; then echo 'current release is not a symlink' >&2; exit 1; else printf 'none\n'; fi")"
if [[ "$expected_current" != "none" && ! "$expected_current" =~ ^[0-9a-f]{40}$ ]]; then
  echo "could not identify the current production release" >&2
  exit 1
fi
if [[ "$expected_current" != "none" ]] \
  && ! git merge-base --is-ancestor "$expected_current" "$commit_sha"; then
  echo "release source does not contain current production commit $expected_current; integrate it first, or use the explicit rollback command" >&2
  exit 1
fi
printf -v quoted_expected_current '%q' "$expected_current"

# The remote steps need root: the incoming directory lives under /opt and the
# release root under /srv, and deploy-web-remote.sh refuses to run otherwise.
# The SSH user is an ordinary account with passwordless sudo, so every remote
# privileged step goes through `sudo -n` and fails fast if a password would be
# required. The incoming directory is handed to the SSH user so scp can write
# the archive without root.
#
# Every interpolated remote value is printf-%q escaped above.
# shellcheck disable=SC2029
ssh "$VYBE_OVH_HOST" \
  "sudo -n install -d -m 0755 \"\$(dirname $quoted_incoming)\" && sudo -n install -d -m 0700 -o \"\$(id -un)\" -g \"\$(id -gn)\" $quoted_incoming"
scp -q "$archive" "$VYBE_OVH_HOST:$remote_archive"
# Every interpolated remote value is printf-%q escaped above.
# shellcheck disable=SC2029
ssh "$VYBE_OVH_HOST" \
  "sudo -n env VYBE_WEB_RELEASE_ROOT=$quoted_release_root VYBE_WEB_HEALTH_URL=$quoted_health_url bash -s -- $quoted_archive $quoted_checksum $quoted_commit $quoted_expected_current" \
  <"$repo_root/scripts/deploy-web-remote.sh"

echo "release=$commit_sha sha256=$checksum"
