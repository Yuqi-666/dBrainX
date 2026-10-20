#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-only

# Run in the directory containing docker-compose.yml and .env.
set -eu
umask 077
target="${1:-}"
case "$target" in
  candidate-*) echo "$target" | grep -Eq '^candidate-[0-9]+-[0-9]+$' || exit 2 ;;
  v*) echo "$target" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.-]+)?$' || exit 2 ;;
  --print-project-directory) ;;
  *) echo 'Usage: sh update.sh candidate-RUN-ATTEMPT | vVERSION | --print-project-directory' >&2; exit 2 ;;
esac
[ -f docker-compose.yml ] && [ -f .env ] || { echo 'Run from the deployment directory with docker-compose.yml and .env' >&2; exit 2; }
here="$(pwd -P)"

# Compose resolves a relative path of a Compose file against the project
# directory and sends the result to the Docker daemon. The updater runs this
# script in a container that mounts this directory at /deployment, where a
# project directory of /deployment would make the daemon create that path on
# the host. The bind mount of nginx.conf would then fail. The project directory
# must be the path of this directory on the host. DBRAIN_DEPLOYMENT_DIR in .env
# wins; otherwise the mount table of the running container answers.
project_directory() {
  configured="$(sed -n 's/^DBRAIN_DEPLOYMENT_DIR=//p' .env | tail -n 1 | tr -d '\r')"
  if [ -n "$configured" ]; then
    case "$configured" in
      /*) printf '%s\n' "$configured" ;;
      *) echo '[update] DBRAIN_DEPLOYMENT_DIR must be an absolute path' >&2; return 2 ;;
    esac
    return 0
  fi
  source_path=''
  mountinfo="${DBRAIN_MOUNTINFO:-/proc/self/mountinfo}"
  if [ -r "$mountinfo" ]; then
    source_path="$(awk -v here="$here" '$5 == here { print $4; exit }' "$mountinfo" 2>/dev/null)" || source_path=''
  fi
  # The mount table escapes a space, a tab, and a backslash in a path.
  source_path="$(printf '%s' "$source_path" | sed -e 's/\\040/ /g' -e 's/\\011/	/g' -e 's/\\134/\\/g')"
  case "$source_path" in
    ''|/) printf '%s\n' "$here" ;;
    *) printf '%s\n' "$source_path" ;;
  esac
}

if [ "$target" = '--print-project-directory' ]; then
  project_directory
  exit 0
fi
project="$(project_directory)"
[ "$project" = "$here" ] || echo "[update] this directory is $project on the host"

mkdir -p backups
exec 9> .update.lock
flock -n 9 || { echo 'Another update is running' >&2; exit 1; }
prefix="$(sed -n 's/^DBRAIN_IMAGE_PREFIX=//p' .env | tail -n 1)"
prefix="${prefix:-ghcr.io/yuqi-666/dbrain}"
echo "$prefix" | grep -Eq '^ghcr\.io/[a-z0-9_.-]+/[a-z0-9_.-]+$' || { echo 'Invalid DBRAIN_IMAGE_PREFIX' >&2; exit 2; }

# One place passes the project directory, so no call resolves a relative path of
# the Compose files against the container path by accident.
compose() {
  docker compose -p dbrain --project-directory "$project" --env-file "$here/.env" -f "$here/docker-compose.yml" "$@"
}

echo "[update] selecting $target"
overlay="compose.current.yml"
tmp="$overlay.tmp.$$"
trap 'rm -f "$tmp"' EXIT HUP INT TERM
printf 'services:\n' > "$tmp"
for service in pocketbase server web; do
  image="$prefix-$service:$target"
  echo "[update] pulling $service"
  docker pull "$image"
  digest="$(docker image inspect --format '{{range .RepoDigests}}{{println .}}{{end}}' "$image" | grep -E "^$prefix-$service@sha256:[a-f0-9]{64}$" | head -n 1)"
  [ -n "$digest" ] || { echo "No registry digest for $image" >&2; exit 1; }
  printf '  %s:\n    image: %s\n' "$service" "$digest" >> "$tmp"
done
rendered="$(compose -f "$tmp" config)" || { echo '[update] the Compose files are invalid' >&2; exit 2; }
if [ "$project" != "$here" ]; then
  case "$rendered" in
    *"source: $here/"*)
      echo "[update] Compose resolves a bind mount below $here; the daemon would create that path on the host" >&2
      echo '[update] set DBRAIN_DEPLOYMENT_DIR in .env to the absolute path of this directory on the host' >&2
      exit 2
      ;;
  esac
fi
echo '[update] stopping writes'
compose stop
pb_container="$(compose ps -aq pocketbase)"
if docker volume inspect dbrain_pb_data >/dev/null 2>&1; then
  if [ -z "$pb_container" ]; then
    compose -f "$tmp" create --no-recreate pocketbase
    pb_container="$(compose ps -aq pocketbase)"
  fi
  [ -n "$pb_container" ] || { echo 'Could not inspect the existing database volume' >&2; exit 1; }
  backup="backups/before-$target-$(date -u +%Y%m%dT%H%M%SZ)"
  mkdir -p "$backup/pb_data"
  docker cp "$pb_container:/pb_data/." "$backup/pb_data/"
  [ -f "$backup/pb_data/data.db" ] || { echo 'Backup has no data.db; update stopped' >&2; exit 1; }
  [ ! -f "$overlay" ] || cp "$overlay" "$backup/compose.current.yml"
  echo "[update] database and files backed up to $backup"
fi
mv "$tmp" "$overlay"
echo '[update] starting selected images; PocketBase applies pending migrations first'
if ! compose -f "$overlay" up --no-build -d --wait --wait-timeout 180; then
  echo '[update] start failed. Keep the stack stopped and restore the matching backup before rollback.' >&2
  compose -f "$overlay" stop || true
  exit 1
fi
printf '%s\n' "$target" > .current-version
echo "[update] $target is healthy"
