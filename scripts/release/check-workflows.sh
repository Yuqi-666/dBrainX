#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only

set -euo pipefail
# Version and digests come from the official rhysd/actionlint release assets.
# Linux amd64 validation tool; container arm64 jobs do not invoke it.
#
# The script caches the binary under .cache/actionlint. CI runs this on every
# push, and a download takes minutes on a slow network. Both digests are
# pinned, so a changed cache is refused and replaced. The variable
# DBRAINX_ACTIONLINT_CACHE moves the cache.
version=1.7.12
archive_digest=8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8
binary_digest=c872d6db8c6bf83a8eaa704fc93999f027d55dffbc63b8a6abdccb47df5f4cd4
cache="${DBRAINX_ACTIONLINT_CACHE:-.cache/actionlint}"
binary="$cache/actionlint-$version-linux-amd64"

check() {
  printf '%s  %s\n' "$1" "$2" | sha256sum --check --status 2>/dev/null
}

if ! check "$binary_digest" "$binary"; then
  mkdir -p "$cache"
  tools=$(mktemp -d)
  trap 'rm -rf "$tools"' EXIT
  url="https://github.com/rhysd/actionlint/releases/download/v$version/actionlint_${version}_linux_amd64.tar.gz"
  curl -fsSL --retry 3 "$url" -o "$tools/actionlint.tar.gz"
  check "$archive_digest" "$tools/actionlint.tar.gz"
  tar -xzf "$tools/actionlint.tar.gz" -C "$tools" actionlint
  check "$binary_digest" "$tools/actionlint"
  install -m 0755 "$tools/actionlint" "$binary"
fi

"$binary" -shellcheck="" .github/workflows/*.yml
