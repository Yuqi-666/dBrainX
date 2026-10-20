# Operations manual

This manual covers the deployment, the update, and the backup of a web deployment.
A deployment has four services: PocketBase, the Node server, the web app, and the gateway. Only the gateway publishes a host port.

## Deploy from source

Configure and start the stack in the repository root.

```bash
cp .env.example .env
# Set DBRAIN_ADMIN_EMAIL and DBRAIN_ADMIN_PASSWORD
# Keep one private Compose project name in all later commands
docker compose -p dbrain config --quiet
docker compose -p dbrain up --build --wait
```

This build uses the current source, not a released image.
Open `http://localhost:3000` and check the pages, the user login, and the file functions.

## Deploy a published release

Download `dbrain-deploy-vVERSION.tar.gz` and `SHA256SUMS` from the release.
Check the archive hash, then extract the archive into the deployment directory.
Keep the files of the archive together.
Run the commands in that directory.

```bash
cp .env.example .env
# Set the operator email and password
# For a private GHCR image, log in first: docker login ghcr.io
docker compose -p dbrain -f docker-compose.yml -f compose.release.yml config --quiet
docker compose -p dbrain -f docker-compose.yml -f compose.release.yml pull
docker compose -p dbrain -f docker-compose.yml -f compose.release.yml up --no-build --wait
```

Use the same digest overlay for later Compose commands: `compose.release.yml`, or `compose.current.yml` after an update.
Keep the deployment directory and the project name stable.
A change creates a new volume by accident.
Complete a deployment verification before important data goes on an internal candidate.

## Update

Keep `docker-compose.yml`, `nginx.conf`, `update.sh`, and `.env` in one deployment directory.
For a private GHCR package, log in to `ghcr.io` first.

```bash
sh update.sh candidate-RUN_ID-ATTEMPT
sh update.sh vVERSION
```

The script pulls the images and resolves their digests. It copies the complete PocketBase volume to `backups/` and writes `compose.current.yml`. Then it starts the stack and waits until every service is healthy.
If the start fails, the stack stays stopped and the script prints the backup location.
Restore the matching database backup before you start an older image. An old image alone cannot reverse a migration.

### Automatic candidate updates

Set `DBRAIN_AUTO_UPDATE=true` in the deployment `.env`, then start the updater in the same directory.

```bash
docker compose -f compose.updater.yml up -d --build
docker compose -f compose.updater.yml logs -f updater
```

The updater checks the latest successful candidate run every 15 seconds and calls `update.sh` for a new candidate.
A failed update pauses the attempts and writes `.auto-update-failed`. Inspect the service, restore the matching backup if necessary, then remove the marker.
Set `DBRAIN_GITHUB_TOKEN` to raise the GitHub API limit.
The updater needs the Docker socket and write access to the deployment directory. Use a trusted host only.

## Ports and external access

Set the gateway host in the deployment `.env`, then run up again. A restart does not apply a new port mapping.

```dotenv
DBRAIN_BIND_HOST=127.0.0.1
DBRAIN_PORT=18080
```

The ports 3001 and 8090 are internal container ports. Do not publish them.
A TLS reverse proxy takes the external traffic. Forward to the gateway, keep the original Host header, support WebSocket, and set the upload limit from the real attachment size.
Set `DBRAIN_PUBLIC_ORIGIN` only when the proxy rewrites the Host header. Use the exact browser origin, without a trailing slash.
Do not publish the PocketBase admin interface. For temporary admin access, use an SSH tunnel and remove the port mapping after the operation.

## Configuration

| Variable | Purpose |
| --- | --- |
| `DBRAIN_ADMIN_EMAIL` | Required. The operator email address. |
| `DBRAIN_ADMIN_PASSWORD` | The operator password. Do not commit it. |
| `DBRAIN_ADMIN_PASSWORD_FILE` | The password file has priority. The container needs a mount for the file. |
| `DBRAIN_BIND_HOST` | The gateway host address. The default is `127.0.0.1`. |
| `DBRAIN_PORT` | The gateway host port. The default is `3000`. |
| `DBRAIN_PUBLIC_ORIGIN` | Usually empty. The exact browser origin when a front proxy rewrites the Host header. |
| `DBRAIN_AUTO_UPDATE` | `true` enables the separate updater. The default is `false`. |
| `DBRAIN_GITHUB_TOKEN` | Optional token for the updater. It raises the GitHub API limit. |
| `DBRAIN_MEDIA_COOKIE_SECRET` | Required in a deployment. Encrypts the saved media-site logins. Keep it stable. A new value makes them unreadable. |

Read the complete list from `.env.example` and `deploy/.env.example`.
The storage limit variables use built-in defaults.
A password file needs a Compose override that mounts the file into the PocketBase service only, read-only.

## Check the service

```bash
docker compose -p dbrain ps
docker compose -p dbrain logs --tail=100 pocketbase server web gateway
curl -fsS http://127.0.0.1:3000/health
```

For a deployment that `update.sh` manages, add `-f docker-compose.yml -f compose.current.yml` to these commands.
The health endpoint shows only that the service is reachable. Check the login, the workspace, the attachments, and the media too.
Logs can contain business information. Remove private data before you share a log.

## Backup and restore

Stop the writes first, then stop the service group. Back up the complete `pb_data` volume in the stopped state. The volume holds the database and the attachments.

```bash
docker compose -p dbrain stop
backup_dir="backups/pb-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$backup_dir"
pb_container=$(docker compose -p dbrain ps -aq pocketbase)
test -n "$pb_container"
docker cp "$pb_container:/pb_data/." "$backup_dir/"
# Check the copy, the database, and the attachments. Save the deployment configuration, then start the stack.
docker compose -p dbrain start
```

Keep the deployment configuration of the same version, the image digests, and the secret configuration with the backup.
Do not put a backup in Git. Move the copy to a backup storage with limited access.
For an image deployment, add `-f docker-compose.yml` and the matching digest overlay to every Compose command.

Before a restore, check the source volume, the target volume, and the backup version.
Restore the complete backup to a dedicated target volume in the stopped state.
Do not mix an old backup with a directory that holds newer data.
Do not run `down -v`. That command removes the data volume.

The upgrade sequence has six steps.

1. Stop the writes.
2. Make a full backup.
3. Test the migration and the permissions of the new version on an isolated copy.
4. Switch to the new release overlay.
5. Start the stack and check the users, the attachments, and the media.
6. Restore the traffic.

A rollback needs the old data and the old image digest.
Run a restore test with a separate project and volume before you operate on the production data.
For the backup of the desktop personal data, see the [usage manual](usage.md).
