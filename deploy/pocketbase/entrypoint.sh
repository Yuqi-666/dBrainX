#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-only

# Container entrypoint: hand the deployment its PocketBase operator account, then
# serve.
#
# Why this exists: PocketBase initialises its own first superuser. On a database
# with no real superuser it inserts a placeholder (`__pbinstaller@example.com`)
# and prints a one-time installer URL into the log — a URL that is useless here,
# because the Dashboard is unreachable through the gateway (`deploy/nginx.conf`
# routes only `/health`, `/pb/`, `/trpc` and `/`) and this container publishes no
# port. A self-hosted deployment therefore has to be *given* its operator account
# before `serve` starts, which also means the placeholder and its token never
# appear at all.
#
# The account is required configuration: without it the container refuses to
# start, rather than serving with an unusable placeholder account. Copy
# `.env.example` to `.env` next to the compose file and set the variables there;
# `docker-compose.yml` also refuses to render without `DBRAINX_ADMIN_EMAIL`.
#
# Declarative by design: whenever the account is configured it is upserted on
# every start, so the password always matches the deployment secret.
#
# `DBRAINX_PB_DATA_DIR` must name the same directory as `--dir` in the image CMD
# (both default to /pb_data); `--dir` is a relative default otherwise, which would
# silently create a second, empty database.
set -e

data_dir="${DBRAINX_PB_DATA_DIR:-/pb_data}"

if [ -z "${DBRAINX_ADMIN_EMAIL:-}" ]; then
  echo "[pocketbase] DBRAINX_ADMIN_EMAIL is not set. The operator account is required configuration: copy .env.example to .env and set DBRAINX_ADMIN_EMAIL plus DBRAINX_ADMIN_PASSWORD (or DBRAINX_ADMIN_PASSWORD_FILE)." >&2
  exit 1
fi

password="${DBRAINX_ADMIN_PASSWORD:-}"
if [ -n "${DBRAINX_ADMIN_PASSWORD_FILE:-}" ]; then
  if [ ! -f "$DBRAINX_ADMIN_PASSWORD_FILE" ]; then
    echo "[pocketbase] DBRAINX_ADMIN_PASSWORD_FILE is not a readable file: $DBRAINX_ADMIN_PASSWORD_FILE" >&2
    exit 1
  fi
  # Secret files are often written with a trailing newline; a password must not.
  password="$(tr -d '\r\n' <"$DBRAINX_ADMIN_PASSWORD_FILE")"
fi

if [ -z "$password" ]; then
  echo "[pocketbase] DBRAINX_ADMIN_EMAIL is set but no password was provided (set DBRAINX_ADMIN_PASSWORD or DBRAINX_ADMIN_PASSWORD_FILE)" >&2
  exit 1
fi

/prepare-migrations.sh
pocketbase superuser upsert "$DBRAINX_ADMIN_EMAIL" "$password" --dir="$data_dir"
echo "[pocketbase] operator account ensured for $DBRAINX_ADMIN_EMAIL"

exec pocketbase "$@"
