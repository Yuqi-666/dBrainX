# deploy/AGENTS.md

Scope: the `deploy/` directory.
Parent map: [../AGENTS.md](../AGENTS.md).

This directory holds the container and gateway assets for a server deployment.
The root file `docker-compose.yml` wires the services together.

## Map

| Path | Content |
| --- | --- |
| `pocketbase/Dockerfile` | PocketBase image. It downloads a pinned version and verifies the checksum for each architecture. |
| `pocketbase/entrypoint.sh` | Start script. It refuses to start without an operator account, then applies the account and starts PocketBase. |
| `pocketbase/prepare-migrations.sh` | Builds the durable run directory before PocketBase starts. |
| `update.sh` | Pulls one candidate or release image set, backs up the data volume, and restarts the stack. |
| `updater/` | Separate container that polls successful manually started release candidates every 15 seconds and calls `update.sh`. Its image holds a copy of `watch.sh`. |
| `nginx.conf` | Gateway. It publishes port 8080 and routes `/health`, `/pb/`, `/trpc`, and `/`. |
| `compose.test.yml` | CI-only overlay. It publishes test ports and adds a probe network. |
| `.env.example` | Deployment variables. Copy it and fill real values. |

## Composition

`docker-compose.yml` defines four application services. `compose.updater.yml` defines a separate Compose project for the updater.

| Service | Role | Network |
| --- | --- | --- |
| `pocketbase` | Data and files | `backend` only |
| `server` | Business API and the file gateway | `backend` and `frontend` |
| `web` | Next.js user interface | `frontend` |
| `gateway` | nginx entry point | `frontend` |

Only the gateway publishes a host port.
The `backend` network is internal, so PocketBase is not reachable from the host.
The application images come from `apps/server/Dockerfile` and `apps/web/Dockerfile`.

The gateway sends `/pb/` and `/trpc` to `server:3001`, and all other paths to `web:3000`.
The server owns file authorization, so attachments do not bypass the business rules.

## Rules

1. Keep the PocketBase version and checksums equal in `pocketbase/Dockerfile`, `scripts/release/pocketbase-lock.json`, and the documentation.
2. Do not publish a service port that the gateway already serves. Add a route to `nginx.conf` instead.
3. Use the root `.env.example` for development and `deploy/.env.example` for deployment. Keep the shared keys equal.
4. Pass the operator password through `DBRAINX_ADMIN_PASSWORD_FILE` in production. A plain variable stays visible in the process list.
5. Set `DBRAINX_PB_DATA_DIR` to the same path as the `--dir` argument of the container command.
6. Treat `compose.test.yml` as a CI artifact. Do not use it on a host.
7. Run Compose with the host path of the deployment directory as the project directory. The updater calls `update.sh` inside a container, and a container path there becomes a bind mount source on the host. `update.sh` resolves that path and refuses a Compose file that would resolve a bind mount into the container.
8. Rebuild the updater image after a change to `updater/watch.sh`: `docker compose -f compose.updater.yml up -d --build`. The Dockerfile copies that script into the image, so the deployment directory is not the source of the running updater.
