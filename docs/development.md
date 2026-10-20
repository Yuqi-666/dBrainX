# Development manual

## Environment

| Tool | Requirement |
| --- | --- |
| Node | The version in `.node-version`, currently 24.15.0 |
| pnpm | 9.0.0 |
| FFmpeg / FFprobe | The media functions |
| Docker Compose | The container build and the deployment |
| Rust | The version in `rust-toolchain.toml`. The desktop app only. |

```bash
pnpm install --frozen-lockfile
```

Do not commit `node_modules`, build output, runtime resources, a real `.env`, or a local database.

## Start the development stack

```bash
cp .env.example .env
# Set DBRAIN_ADMIN_EMAIL and DBRAIN_ADMIN_PASSWORD
pnpm dev
```

`pnpm dev` starts PocketBase, the web app, and the server on this machine.
The first run downloads PocketBase into `pb/` and yt-dlp into `.cache/yt-dlp/`.
`pnpm dev:remote` adds the development gateway for a public domain.

| Service | Variable | Default | Address |
| --- | --- | --- | --- |
| Web | `DBRAIN_WEB_PORT` | 3000 | <http://localhost:3000> |
| Server | `DBRAIN_SERVER_PORT` | 3001 | <http://localhost:3001> |
| PocketBase | `DBRAIN_PB_HTTP` | 127.0.0.1:8090 | <http://127.0.0.1:8090> |
| Gateway (`dev:remote` only) | `DBRAIN_GATEWAY_PORT` | 8080 | <https://p8080>.<development domain> |

The ports come from the root `.env`. A shell variable of the same name has priority.
Development data goes to `pb/pb_data`.
Run one package with `pnpm --filter <package> <script>`.

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
Set `DBRAIN_POCKETBASE_PATH`, `FFMPEG_PATH`, or `FFPROBE_PATH` to other paths.
The installers are in `apps/desktop/src-tauri/target/release/bundle`.
The release targets are Linux x64, Windows x64, and macOS x64 / arm64.

## Checks before a commit

```bash
pnpm release:check
pnpm check-types
pnpm lint:gate
pnpm test:release
pnpm build
pnpm smoke:server
```

`pnpm lint:gate` blocks new diagnostics against the stored baseline.
The server smoke test needs isolated test data. Build before the smoke test.
For a desktop change, also run the checks in [the desktop instructions](../apps/desktop/AGENTS.md).

## Release

The owner commits to `develop` directly or through an internal `feature/*` or `fix/*` branch.
A version tag on `develop` starts the candidate build.
The owner merges `develop` to `main` with a merge commit and publishes the drafted release.
See [CI/CD and releases](ci-cd.md).

Keep this manual and `ci-cd.md` in step with `.github/workflows/ci.yml`.

## Maintain the repository

Update the lockfile with a dependency.
Add a migration for a schema change. Do not edit a released migration.
Test the native runtime and the backup and restore behavior on a changed platform.
