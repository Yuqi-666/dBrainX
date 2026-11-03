# Operations manual

This manual covers the deployment, the update, and the backup of a web deployment.
A deployment has four services: PocketBase, the Node server, the web app, and the gateway. Only the gateway publishes a host port.

## Deploy from source

Configure and start the stack in the repository root.

```bash
cp .env.example .env
# Set DBRAINX_ADMIN_EMAIL and DBRAINX_ADMIN_PASSWORD
# Keep one private Compose project name in all later commands
docker compose -p dbrainx config --quiet
docker compose -p dbrainx up --build --wait
```

This build uses the current source, not a released image.
Open `http://localhost:3000` and check the pages, the user login, and the file functions.

## Deploy a published release

Download `dbrainx-deploy-vVERSION.tar.gz` and `SHA256SUMS` from the release.
Check the archive hash, then extract the archive into the deployment directory.
Keep the files of the archive together.
Run the commands in that directory.

```bash
cp .env.example .env
# Set the operator email and password
# For a private GHCR image, log in first: docker login ghcr.io
docker compose -p dbrainx -f docker-compose.yml -f compose.release.yml config --quiet
docker compose -p dbrainx -f docker-compose.yml -f compose.release.yml pull
docker compose -p dbrainx -f docker-compose.yml -f compose.release.yml up --no-build --wait
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

Set `DBRAINX_AUTO_UPDATE=true` in the deployment `.env`, then start the updater in the same directory.

```bash
docker compose -f compose.updater.yml up -d --build
docker compose -f compose.updater.yml logs -f updater
```

The updater checks the latest successful candidate run every 15 seconds and calls `update.sh` for a new candidate.
A failed update pauses the attempts and writes `.auto-update-failed`. Inspect the service, restore the matching backup if necessary, then remove the marker.
Set `DBRAINX_GITHUB_TOKEN` to raise the GitHub API limit.
The updater needs the Docker socket and write access to the deployment directory. Use a trusted host only.

## Ports and external access

Set the gateway host in the deployment `.env`, then run up again. A restart does not apply a new port mapping.

```dotenv
DBRAINX_BIND_HOST=127.0.0.1
DBRAINX_PORT=18080
```

The ports 3001 and 8090 are internal container ports. Do not publish them.
A TLS reverse proxy takes the external traffic. Forward to the gateway, keep the original Host header, support WebSocket, and set the upload limit from the real attachment size.
Set `DBRAINX_PUBLIC_ORIGIN` only when the proxy rewrites the Host header. Use the exact browser origin, without a trailing slash.
Do not publish the PocketBase admin interface. For temporary admin access, use an SSH tunnel and remove the port mapping after the operation.

## Configuration

| Variable | Purpose |
| --- | --- |
| `DBRAINX_ADMIN_EMAIL` | Required. The operator email address. |
| `DBRAINX_ADMIN_PASSWORD` | The operator password. Do not commit it. |
| `DBRAINX_ADMIN_PASSWORD_FILE` | The password file has priority. The container needs a mount for the file. |
| `DBRAINX_BIND_HOST` | The gateway host address. The default is `127.0.0.1`. |
| `DBRAINX_PORT` | The gateway host port. The default is `3000`. |
| `DBRAINX_PUBLIC_ORIGIN` | Usually empty. The exact browser origin when a front proxy rewrites the Host header. |
| `DBRAINX_AUTO_UPDATE` | `true` enables the separate updater. The default is `false`. |
| `DBRAINX_GITHUB_TOKEN` | Optional token for the updater. It raises the GitHub API limit. |
| `DBRAINX_MEDIA_COOKIE_SECRET` | Required in a deployment. Encrypts the saved media-site logins. Keep it stable. A new value makes them unreadable. |
| `DBRAINX_SECRET_KEY` | The key material for the plugin secret cipher, which seals with AES-256-GCM. The cipher refuses to build without it, and there is no plaintext fallback. Keep it stable: a new value makes the stored frames unreadable until they are sealed again. |
| `DBRAINX_SANDBOX_ROOT` | The absolute directory for sandbox files. The default is `sandbox-storage` under the upload spool. A relative value disables the sandbox cleanup. |

The server process needs `DBRAINX_ADMIN_EMAIL` together with `DBRAINX_ADMIN_PASSWORD` or `DBRAINX_ADMIN_PASSWORD_FILE` to compose the engine, the sandbox cleanup, and the plugin grant table.
The bundled `docker-compose.yml` passes that pair to the PocketBase service only, and it does not pass the `DBRAINX_ENGINE_*` settings, `DBRAINX_SECRET_KEY`, or `DBRAINX_SANDBOX_ROOT` to the server service. The bundled container therefore composes none of them. Pass the same variables to the server service when a deployment needs them.

Read the complete list from `.env.example` and `deploy/.env.example`.
The storage limit variables use built-in defaults.
A password file needs a Compose override that mounts the file into the PocketBase service only, read-only.

## Operation engine

The engine claims scheduled jobs and event deliveries, runs each operation handler, and writes one `operation_runs` row per attempt. It composes only in a process that has the PocketBase operator credential. The server prints one line at startup, so the effective policy is visible:

```text
[engine] enabled owner=<hostname>:<pid> poll=500ms idle=1000..30000ms drain=30000ms jobs=10/2 deliveries=20/2 lease=30000ms attempts=5 cleanup=3600000ms retention=604800000ms batch=100
```

Without the credential the line says `[engine] not composed: ...`, `run.engineStatus` answers `available: false`, and the desktop settings switch stays disabled. Reading, writing, the graph, and the editor do not need the engine. `DBRAINX_ENGINE_ENABLED=0` starts the server without claiming work, and a local backend can switch a running engine at `/settings/engine`.

### Engine settings

| Variable | Default | Purpose |
| --- | --- | --- |
| `DBRAINX_ENGINE_ENABLED` | `1` | Start the worker. The local switch can turn it off at run time. |
| `DBRAINX_ENGINE_WORKER_ID` | `<hostname>:<pid>` | The lease owner recorded on every claim and completion. |
| `DBRAINX_ENGINE_POLL_MS` | `500` | Pause after a tick that claimed work. |
| `DBRAINX_ENGINE_IDLE_BACKOFF_MS` | `1000` | First pause after a tick that claimed nothing. It doubles per idle tick. |
| `DBRAINX_ENGINE_IDLE_BACKOFF_MAX_MS` | `30000` | The upper bound of the idle pause. |
| `DBRAINX_ENGINE_DRAIN_MS` | `30000` | How long a shutdown waits for in-flight runs. The process exits 1 when the deadline expires with work still running. |
| `DBRAINX_ENGINE_CONCURRENCY` | `2` | Job firings one tick runs at once, and workspace buckets one dispatch tick drains. Read once at start-up; change it with a restart. |
| `DBRAINX_ENGINE_LEASE_MS` | `30000` | The delivery and job lease. |
| `DBRAINX_ENGINE_CLAIM_LIMIT` | `20` | Delivery rows one claim may take. |
| `DBRAINX_ENGINE_JOB_LIMIT` | `10` | Jobs one tick may claim. |
| `DBRAINX_ENGINE_MAX_ATTEMPTS` | `5` | Delivery attempts before the dead letter. |
| `DBRAINX_ENGINE_CLEANUP_INTERVAL_MS` | `3600000` | Pause between retention runs. `0` turns the timer off and leaves `engine.cleanup` available. |
| `DBRAINX_ENGINE_EVENT_RETENTION_MS` | `604800000` | A `done` event older than this is reclaimed. |
| `DBRAINX_ENGINE_SANDBOX_IDLE_MS` | `604800000` | A ready sandbox unused this long expires. |
| `DBRAINX_ENGINE_CLEANUP_BATCH` | `100` | Rows one cleanup stage may touch per run. |

A malformed value stops the server at startup. An engine that silently runs with a 1 ms poll or a 0 ms drain deadline is worse than one that refuses to start.

### Metrics

`engine.metrics` is a tRPC query. The input is `{ workspaceId, windowMs?, scanLimit? }`. Any member of the workspace may read it, because the numbers describe a workspace the caller already reads. The result is `{ available: true, metrics }`, or `{ available: false, reason }` when this process composed no engine.

| Field | Meaning |
| --- | --- |
| `events.pendingCount` | Events with a pending delivery, counted from the queue head. |
| `events.pendingDeliveryCount` | Pending delivery rows. An exact count. |
| `events.oldestPendingAgeMs` | How long the oldest claimable event has waited. `null` on an empty queue. |
| `events.deadLetterCount` | Delivery rows in the dead letter. |
| `events.cascadeDepth.distribution` | Runs by cascade depth, with `scanned` and `truncated`. |
| `runs.successRate` | `succeeded / (succeeded + failed + dead)`. A running row is not in the denominator. |
| `runs.latencyMs.p50`, `p95` | Nearest-rank latency. `null` on an empty sample. |
| `runs.failuresByPlugin`, `failuresByOperation` | Failure counts, largest first. |
| `runs.operationsPerPluginPerMinute` | Operation count and rate per plugin. |
| `deliveries` | `pending`, `processing`, `done`, `failed`, `dead`. |

`windowMs` and `scanLimit` are clamped to the service limits. The two distributions are bounded scans and set `truncated` when they stopped early. No number in this view comes from a log line.

### Retention and cleanup

Retention runs on its own timer, outside the worker loop, so a large batch never delays a claim. A batch that outlives the interval produces a skipped tick, not two runs on the same rows. Each run prints one JSON line with the run's own counters:

```text
{"event":"engine.cleanup","ok":true,"startedAt":"...","finishedAt":"...","retentionMs":604800000,"cutoff":"...","candidates":4,"deleted":2,"skipped":2,"deliveriesDeleted":3,"truncated":false,"scopeRowsDeleted":0,"sandboxesExpired":0,"sandboxFilesSoftDeleted":0,"failures":[]}
```

One run reclaims `done` events older than the retention period, removes automation-scope rows whose automation no longer exists, and expires a ready sandbox that was idle for the idle period. It skips an event that a delivery which is not `done` still references, and names the blocking status. It never deletes a soft-deleted node. A failed stage is reported in `failures` and does not report the run as clean.

`engine.cleanup` is the same service as a tRPC mutation with the input `{ workspaceId }`. It answers `{ available: true, result }` or `{ available: false, reason }`. It is available only on a local backend (`DBRAINX_DESKTOP=1`, `DBRAINX_LOCAL_MODE=1`, or `NODE_ENV` other than `production`) and only to the workspace owner. A shared deployment runs retention on the timer, not on a user request.

## Error codes

A client switches on the code string, not on the HTTP status.
`operation.invoke` keeps the code in the message prefix and also sets a tRPC code.
`run.replay` returns a refusal as data: `{ kind: "refused", code, message }`.
A sandbox code appears in `operation_runs.error` and `sandbox_calls.errorCode`.

### Operation codes

| Code | tRPC code | When the server returns it |
| --- | --- | --- |
| `OPERATION_NOT_FOUND` | `NOT_FOUND` | The operation is not registered, or it does not apply to this node type. |
| `TARGET_NOT_FOUND` | `NOT_FOUND` | The target is absent or in another workspace. |
| `FORBIDDEN` | `FORBIDDEN` | The user role, the node permission, or a system operation refuses the call. |
| `CAPABILITY_DENIED` | `FORBIDDEN` | No grant covers the required capability. |
| `OUT_OF_SCOPE` | `FORBIDDEN` | A node target is outside the run's execution scope. |
| `RATE_LIMITED` | `TOO_MANY_REQUESTS` | A high-risk capability used up its token bucket. |
| `TARGET_KIND_UNSUPPORTED` | `NOT_IMPLEMENTED` | This process has no access policy for an edge or view target. |
| `CAPABILITY_POLICY_UNAVAILABLE` | `PRECONDITION_FAILED` | This process has no capability policy source. |
| `SCHEMA_INVALID` | `BAD_REQUEST` | The input does not match the operation schema. |
| `VERSION_CONFLICT` | `CONFLICT` | `expectedVersion` is not the current record version. |
| `OPERATION_TIMEOUT` | `TIMEOUT` | The handler did not finish within its timeout. |
| `OPERATION_FAILED` | `INTERNAL_SERVER_ERROR` | The handler threw. Read `failureCode` for the stable cause. |
| `RUN_CONFLICT` | `CONFLICT` | The idempotency key already names a run that this call cannot continue. |
| `AUDIT_FAILED` | `INTERNAL_SERVER_ERROR` | The server could not write the run row or move it to its final state. |

### Run replay refusals

| Code | When `run.replay` returns it |
| --- | --- |
| `RUN_NOT_FOUND` | The run is absent or in another workspace. |
| `RUN_ALREADY_SUCCEEDED` | The run succeeded. A replay would apply the effect again. |
| `RUN_IN_PROGRESS` | The run is still running. |
| `RUN_TERMINAL` | The run is in the dead letter. That state is final. |
| `OPERATION_NOT_FOUND` | The run's operation is no longer registered. |
| `OPERATION_NOT_IDEMPOTENT` | The operation does not declare `idempotent: true`. |
| `REPLAY_UNAVAILABLE` | This process has no engine executor. |
| `REPLAY_DENIED` | The run was denied, or the gate denied the replay. |

### Sandbox codes

The sandbox runtime is `@microsoft/mxc-sdk` **1.0.0**.
Do not upgrade to 1.0.1 on arm64: its `libmxc_ffi.so` segfaults inside `mxc_sandbox_warnings_json` after a successful spawn, so every exec kills the process.
Verify a host with `node scripts/release/sandbox-real.mjs`; it exits 0 when every runnable case passes.

| Code | When it appears |
| --- | --- |
| `SANDBOX_UNAVAILABLE` | No MXC backend is available, or the backend lacks the policy. |
| `SANDBOX_POLICY_DENIED` | A grant does not cover the path, the executable, or the network range. |
| `SANDBOX_PATH_ESCAPE` | A path or symlink leaves the sandbox root. |
| `SANDBOX_PATH_INVALID` | A path is malformed, or it does not name a regular file. |
| `SANDBOX_PATH_RESERVED` | A path segment is a Windows device name. |
| `SANDBOX_QUOTA_EXCEEDED` | A file, byte, process, or output quota is over its limit. |
| `SANDBOX_TIMEOUT` | The command passed its timeout. |
| `SANDBOX_EXEC_FAILED` | The command failed, MXC did not start, or the result is unreadable. |
| `SANDBOX_OUTPUT_TRUNCATED` | The output passed `maxOutputBytes` and was cut. |

## Check the service

```bash
docker compose -p dbrainx ps
docker compose -p dbrainx logs --tail=100 pocketbase server web gateway
curl -fsS http://127.0.0.1:3000/health
```

For a deployment that `update.sh` manages, add `-f docker-compose.yml -f compose.current.yml` to these commands.
The health endpoint shows only that the service is reachable. Check the login, the workspace, the attachments, and the media too.
Logs can contain business information. Remove private data before you share a log.

## Backup and restore

Stop the writes first, then stop the service group. Back up the complete `pb_data` volume in the stopped state. The volume holds the database and the attachments.

```bash
docker compose -p dbrainx stop
backup_dir="backups/pb-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$backup_dir"
pb_container=$(docker compose -p dbrainx ps -aq pocketbase)
test -n "$pb_container"
docker cp "$pb_container:/pb_data/." "$backup_dir/"
# Check the copy, the database, and the attachments. Save the deployment configuration, then start the stack.
docker compose -p dbrainx start
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

## Database migrations and rollback

PocketBase applies the files in `pb/pb_migrations_changes/` in filename order when it starts. The base script in `pb/pb_migrations_base/` runs only when a database is created, so an existing deployment upgrades through the change files alone. Never edit a released change file; a new shape is a new number.

The migration runs during `update.sh`, after the script has copied the complete PocketBase volume to `backups/` and before the stack is healthy. A failed start leaves the stack stopped and prints the backup path.

An older image does not reverse a migration. A rollback is a restore: stop the stack, restore the matching database backup into the volume, switch back to the old image digest, and start it. Some changes are one way by design. `0000000007_webpage_object_storage.js` moves an inline page source into the files collection, and a downgrade keeps the blob in the library instead of restoring it inline.

Run a restore test with a separate project and volume before you operate on the production data.
For the backup of the desktop personal data, see the [usage manual](usage.md).
