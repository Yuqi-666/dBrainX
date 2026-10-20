#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-only

set -eu

# The compose file sets this working directory. A test overrides it.
cd "${DBRAIN_DEPLOYMENT_PATH:-/deployment}"
interval=15
state_dir="${TMPDIR:-/tmp}/dbrain-watch"
etag_file="$state_dir/etag"
body_file="$state_dir/runs.json"
header_file="$state_dir/headers"
auth_file="$state_dir/auth.conf"
api='https://api.github.com/repos/Yuqi-666/dBrain/actions/workflows/release-candidate.yml/runs?event=push&status=success&per_page=1'

env_value() {
  [ -f .env ] || return 0
  sed -n "s/^$1=//p" .env | tail -n 1 | tr -d '\r'
}

enabled() {
  case "$(env_value DBRAIN_AUTO_UPDATE)" in
    true) return 0 ;;
    false|'') return 1 ;;
    *) echo '[updater] DBRAIN_AUTO_UPDATE must be true or false' >&2; return 1 ;;
  esac
}

candidate_number() {
  case "$1" in
    candidate-[0-9]*-[0-9]*)
      printf '%s\n' "$1" | sed -n 's/^candidate-\([0-9][0-9]*\)-\([0-9][0-9]*\)$/\1 \2/p'
      ;;
  esac
}

header_value() {
  tr 'A-Z' 'a-z' < "$header_file" | sed -n "s/^$1:[[:space:]]*//p" | tr -d '\r' | tail -n 1
}

# A conditional request replaces a full poll. GitHub answers 304 when the
# result did not change. A token raises the API limit from 60 to 5000 requests
# per hour; without one, a 15 second interval pauses at the limit.
fetch_runs() {
  : > "$header_file"
  status="$(curl -sS -o "$body_file" -D "$header_file" -w '%{http_code}' \
    --connect-timeout 10 --max-time 30 --retry 2 \
    --etag-compare "$etag_file" --etag-save "$etag_file" \
    -K "$auth_file" \
    -H 'Accept: application/vnd.github+json' "$api")" || status=000
  case "$status" in
    200) return 0 ;;
    304) return 3 ;;
  esac
  return 1
}

# Wait for the reset of the hourly API limit. An unauthenticated host has 60
# requests per hour, so this interval must pause instead of failing every check.
rate_limit_wait() {
  remaining="$(header_value 'x-ratelimit-remaining')"
  reset="$(header_value 'x-ratelimit-reset')"
  case "$remaining" in ''|*[!0-9]*) return 1 ;; esac
  case "$reset" in ''|*[!0-9]*) return 1 ;; esac
  [ "$remaining" -le 2 ] || return 1
  now="$(date +%s)"
  [ "$reset" -gt "$now" ] || return 1
  wait_seconds=$((reset - now + 5))
  echo "[updater] GitHub API limit reached; next check in ${wait_seconds}s" >&2
  sleep "$wait_seconds"
  return 0
}

check_once() {
  [ ! -f .auto-update-failed ] || return 0
  fetch_status=0
  fetch_runs || fetch_status=$?
  [ "$fetch_status" -ne 3 ] || return 0
  [ "$fetch_status" -eq 0 ] || return 1
  result="$(jq -er '.workflow_runs[0] | select(.conclusion == "success" and .event == "push") | "\(.id) \(.run_attempt)"' "$body_file")" || return 1
  read -r run attempt <<EOF
$result
EOF
  case "$run:$attempt" in
    *[!0-9:]*|:*|*:) echo '[updater] invalid candidate run identity' >&2; return 1 ;;
  esac
  target="candidate-$run-$attempt"
  current="$(cat .current-version 2>/dev/null || true)"
  [ "$current" != "$target" ] || return 0

  previous="$(candidate_number "$current")"
  if [ -z "$previous" ] && [ -f .auto-update-last-run ]; then
    previous="$(candidate_number "$(cat .auto-update-last-run)")"
  fi
  if [ -n "$previous" ]; then
    read -r old_run old_attempt <<EOF
$previous
EOF
    if [ "$run" -lt "$old_run" ] || { [ "$run" -eq "$old_run" ] && [ "$attempt" -le "$old_attempt" ]; }; then
      return 0
    fi
  elif [ -n "$current" ]; then
    # A manual release has no candidate run ID. Record the current candidate run as
    # the starting point so that the watcher cannot replace it with an older candidate.
    printf '%s\n' "$target" > .auto-update-last-run
    echo "[updater] tracking from $target; waiting for a newer run"
    return 0
  fi

  echo "[updater] new successful tag candidate: $target"
  if sh update.sh "$target"; then
    printf '%s\n' "$target" > .auto-update-last-run
    echo "[updater] deployed $target"
  else
    printf '%s\n' "$target" > .auto-update-failed
    echo '[updater] update failed; automatic updates paused. Recover the application and remove .auto-update-failed to resume' >&2
    return 1
  fi
}

mkdir -p "$state_dir"
touch "$etag_file"
: > "$auth_file"
github_token="$(env_value DBRAIN_GITHUB_TOKEN)"
[ -z "$github_token" ] || printf 'header = "Authorization: Bearer %s"\n' "$github_token" > "$auth_file"

[ -f .env ] && [ -f update.sh ] || { echo '[updater] deployment files missing' >&2; exit 1; }
if [ "${1:-}" = '--once' ]; then
  if enabled; then check_once || true; fi
  exit 0
fi
if [ -z "$github_token" ]; then
  echo '[updater] no DBRAIN_GITHUB_TOKEN; the GitHub API allows 60 requests per hour' >&2
fi
echo "[updater] watching successful tag candidates every ${interval}s"
last_state=''
while :; do
  if enabled; then
    if [ "$last_state" != enabled ]; then echo '[updater] automatic updates enabled'; fi
    last_state=enabled
    check_once || rate_limit_wait || echo '[updater] check failed; will retry' >&2
  else
    if [ "$last_state" != disabled ]; then echo '[updater] automatic updates disabled'; fi
    last_state=disabled
  fi
  sleep "$interval"
done
