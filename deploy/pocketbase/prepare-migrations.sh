#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-only

set -eu
data_dir="${DBRAIN_PB_DATA_DIR:-/pb_data}"
run_dir="$data_dir/pb_migrations"
state_file="$run_dir/.dbrain-migration-origin"
mkdir -p "$run_dir"
if [ ! -f "$state_file" ]; then
  if [ -f "$data_dir/data.db" ] || find "$run_dir" -maxdepth 1 -name '*.js' -print -quit | grep -q .; then
    echo '[migrations] existing data predates the migration baseline; restore or migrate it explicitly' >&2
    exit 1
  fi
  origin=base
  cutoff=0
  for file in /pb_migrations_changes/*.js; do
    [ -f "$file" ] || continue
    name="${file##*/}"
    number="${name%%_*}"
    [ "$number" -gt "$cutoff" ] && cutoff="$number"
  done
  set -- /pb_migrations_base/*.js
  [ "$#" -eq 1 ] && [ -f "$1" ] || { echo '[migrations] expected one base script' >&2; exit 1; }
  base_file="${1##*/}"
  base_sha="$(sha256sum "$1" | cut -d ' ' -f 1)"
  cp "$1" "$run_dir/$base_file"
  printf '%s %s %s %s\n' "$origin" "$cutoff" "$base_file" "$base_sha" > "$state_file.tmp"
  mv "$state_file.tmp" "$state_file"
fi
read -r origin cutoff base_file base_sha < "$state_file"
set -- /pb_migrations_base/*.js
[ "$#" -eq 1 ] && [ -f "$1" ] || { echo '[migrations] expected one base script' >&2; exit 1; }
if [ "$origin" != base ] || [ "$base_file" != "${1##*/}" ]; then
  echo '[migrations] data predates the migration baseline; restore or migrate it explicitly' >&2
  exit 1
fi
[ "$(sha256sum "$run_dir/$base_file" | cut -d ' ' -f 1)" = "$base_sha" ] || { echo '[migrations] installed base changed' >&2; exit 1; }
added=0
for file in /pb_migrations_changes/*.js; do
  [ -f "$file" ] || continue
  name="${file##*/}"
  number="${name%%_*}"
  [ "$number" -gt "$cutoff" ] || continue
  if [ -f "$run_dir/$name" ]; then
    cmp -s "$file" "$run_dir/$name" || { echo "[migrations] installed change differs: $name" >&2; exit 1; }
  else
    cp "$file" "$run_dir/$name"
    added=$((added + 1))
  fi
done
echo "[migrations] $origin database; $added change script(s) added"
