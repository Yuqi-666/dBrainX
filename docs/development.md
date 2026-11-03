# Development manual

## Environment

| Tool             | Requirement                                                                             |
| ---------------- | --------------------------------------------------------------------------------------- |
| Node             | The version in `.node-version`, currently 24.21.0                                       |
| pnpm             | 9.0.0                                                                                   |
| FFmpeg / FFprobe | The media functions                                                                     |
| C++ toolchain    | `python3`, `make`, and a C++ compiler, when pnpm builds `node-pty` or koffi from source |
| Docker Compose   | The container build and the deployment                                                  |
| Rust             | The version in `rust-toolchain.toml`. The desktop app only.                             |

Node 24.21.0 is deliberate. The MXC sandbox SDK needs Node 24 or newer, and its native stdio path on Windows needs 24.21.0. `pnpm release:check` fails when a Dockerfile Node version drifts from `.node-version`.

```bash
pnpm install --frozen-lockfile
```

Do not commit `node_modules`, build output, runtime resources, a real `.env`, or a local database.

## Start the development stack

```bash
cp .env.example .env
# Set DBRAINX_ADMIN_EMAIL and DBRAINX_ADMIN_PASSWORD
pnpm dev
```

`pnpm dev` starts PocketBase, the web app, and the server on this machine.
The first run downloads PocketBase into `pb/` and yt-dlp into `.cache/yt-dlp/`.
`pnpm dev:remote` adds the development gateway for a public domain.

| Service                     | Variable               | Default        | Address                              |
| --------------------------- | ---------------------- | -------------- | ------------------------------------ |
| Web                         | `DBRAINX_WEB_PORT`     | 3000           | <http://localhost:3000>              |
| Server                      | `DBRAINX_SERVER_PORT`  | 3001           | <http://localhost:3001>              |
| PocketBase                  | `DBRAINX_PB_HTTP`      | 127.0.0.1:8090 | <http://127.0.0.1:8090>              |
| Gateway (`dev:remote` only) | `DBRAINX_GATEWAY_PORT` | 8080           | <https://p8080>.<development domain> |

The ports come from the root `.env`. A shell variable of the same name has priority.
Development data goes to `pb/pb_data`.
Run one package with `pnpm --filter <package> <script>`.

## Packages

The execution engine added five workspace packages. A node type or an operation belongs to the plugin package that owns it, not to `backend/domain` or `packages/interfaces`.

| Package               | Content                                                                                |
| --------------------- | -------------------------------------------------------------------------------------- |
| `backend/plugin-host` | Manifest gate, trust checks, dependency closure, contribution snapshot, worker bridge. |
| `backend/sandbox`     | MXC execution, path and quota policy, sandbox lifecycle.                               |
| `packages/plugin-sdk` | The contract a plugin compiles against: manifests, node types, operations, UI entries. |
| `plugins/builtin`     | The built-in node types and operations that ship with the app.                         |
| `plugins/counter`     | The signed test fixture. Its key is test-only.                                         |

Only `apps/server` imports `plugins/**` in production code. A test may import a plugin package or a fixture directly to exercise it.

## Sandbox

`backend/sandbox` runs plugin code in an MXC container, not in the server process. `@microsoft/mxc-sdk` stays outside the esbuild bundle and ships with this platform's native helpers. A host without a usable backend does not fail: the sandbox answers `SANDBOX_UNAVAILABLE` with a named reason, and reading, writing, the graph, and the editor keep working.

```bash
node scripts/sandbox-probe.mjs
pnpm sandbox:real
```

The probe exits 0 with or without a backend. It prints one row per backend, the host facts, and a `codes:` line for every capability this host lacks. `pnpm sandbox:real` runs only the negatives the host can enforce and skips the rest with a named reason. A skip is not a pass.

Sandbox files live under `DBRAINX_SANDBOX_ROOT`, or `<upload spool>/sandbox-storage` when it is empty. The root must be absolute. A relative value disables the sandbox cleanup and prints a warning.

## Desktop app

```bash
pnpm dev:desktop
pnpm build:desktop
```

A native build needs Rust and the runtime of the platform.
On Ubuntu, install the dependencies of the workflow.

```bash
sudo apt-get update
sudo apt-get install -y libwebkit2gtk-4.1-dev libgtk-3-dev libssl-dev librsvg2-dev build-essential patchelf ffmpeg gstreamer1.0-tools gstreamer1.0-plugins-base gstreamer1.0-plugins-good gstreamer1.0-libav
```

The app finds PocketBase at `pb/pocketbase` and FFmpeg and FFprobe in PATH.
Set `DBRAINX_POCKETBASE_PATH`, `FFMPEG_PATH`, or `FFPROBE_PATH` to other paths.
The prepared runtime carries the backend bundle, the PocketBase hooks, the plugin manifests, and the MXC package with this platform's native helpers. Prepare it on the target platform, so the helpers and the runtime hashes match that machine. `prepare-runtime.mjs` verifies every hash before it exits.
The installers are in `apps/desktop/src-tauri/target/release/bundle`.
The release targets are Linux x64, Windows x64, and macOS x64 / arm64.

## Checks before a commit

```bash
pnpm release:check
pnpm check-types
pnpm lint:gate
pnpm test:release
pnpm test:ui
pnpm --filter @workspace/services test
pnpm build
pnpm smoke:server
bash scripts/release/check-workflows.sh
```

`pnpm lint:gate` blocks new diagnostics against the stored baseline.
`pnpm test:release` runs the explicit list in [`test-manifest.mjs`](../scripts/release/test-manifest.mjs). A new test file that is neither in `testFiles` nor in `skippableTests` fails the gate, so add it to the manifest with its runner or its reason.
`pnpm test:ui` compiles the JSX test files with esbuild. The services test bundles `packages/services/test`.
The server smoke test needs isolated test data. Build before the smoke test.
For a desktop change, also run the checks in [the desktop instructions](../apps/desktop/AGENTS.md).

## Plugin manifests

A plugin manifest carries a `checksum` and a `signature`.
Run the commands from the repository root.

```bash
node scripts/plugin-sign.mjs --test-key plugins/counter
node scripts/plugin-sign.mjs --verify plugins/counter
```

Rerun the first command after you change a file in the plugin.
The second command reports `UNTRUSTED_PLUGIN` when a file does not match the checksum, when the signature does not verify, or when one of the two fields is missing.

`plugins/counter` is a test fixture.
The repository key that signs it is test-only.
Its id is `dbrainx.test-key`, and the loader refuses it unless a test allows test keys.
Do not add it to `DBRAINX_PLUGIN_TRUSTED_KEYS`.
A deployment supplies its own public keys in `DBRAINX_PLUGIN_TRUSTED_KEYS`, as a JSON object that maps a key id to a base64 public key.
The signing key of a deployment stays outside this repository.

## Planned plugin context contract

This contract is planned, not implemented. The running code provides only what the second bullet lists.

- **Status.** Planned. Nothing described in this section is on `OperationContext` today, and the executor does not assemble it.
- **Data envelope today.** [`OperationContext`](../backend/domain/src/ports/operation-context.ts) carries the data envelope only: `actor`, `effectsActor`, `workspaceId`, `scope`, `target`, `node`, `correlationId`, `runId`, `eventId`.
- **Missing from the domain type.** `pluginId`, the `event` object with `eventId` / `eventType` / `payload` / `sourceNodeId`, the host ports `http`, `media`, `notify`, `sandbox`, `secret`, and the node methods `readNode`, `writeNode`, `invokeNode`, `createNode`, `deleteNode`, `emit`.
- **Where the capability surface lives today.** Only on `PluginWorkerContext` in [`worker-context.ts`](../backend/plugin-host/src/worker-context.ts). An author who writes an `OperationRun` gets the domain `OperationContext`, so calling a capability through the SDK type needs a cast.
- **Planned target.** The full §4.4.2 contract, published through `backend/domain` and re-exported from `packages/plugin-sdk`. The executor assembles it for both in-process and worker handlers. The worker keeps a `requestId` request/reply table: functions and `ExecutionScope.allows` never cross that boundary, and the worker rebuilds `allows` from the scope data it receives.

## Release

The owner commits to `develop` directly or through an internal `feature/*` or `fix/*` branch.
A version tag on `develop` starts the candidate build.
The owner merges `develop` to `main` with a merge commit and publishes the drafted release.
See [CI/CD and releases](ci-cd.md).

Keep this manual and `ci-cd.md` in step with `.github/workflows/ci.yml`.

## Database migrations

A schema change touches two files.

1. Update `pb/pb_migrations_base/0000000001_base_schema.js`, so a new database starts with the new shape.
2. Add one numbered file to `pb/pb_migrations_changes/`, so an existing database reaches the same shape.

The base script runs once, when a database is created, and its sha256 is recorded in `.dbrainx-migration-origin`. An installed database upgrades through the change scripts alone. The highest released change is `0000000014_automation_timestamps.js`, so the next change starts at `0015`.

Never edit a released change migration. PocketBase applies a migration by filename, so an edited file either does not run or runs differently from the database it already shaped. Test the upgrade against a copy of old data before you release the new file.

## Maintain the repository

Update the lockfile with a dependency.
Test the native runtime and the backup and restore behavior on a changed platform.
