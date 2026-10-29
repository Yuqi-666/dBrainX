# apps/desktop/AGENTS.md

Scope: the `apps/desktop` package.
Parent map: [../AGENTS.md](../AGENTS.md).

This package is a Tauri 2 desktop shell.
It runs the full backend and PocketBase on the device.
It renders the web interface from a static export.
The user can work offline. No cloud session exists.

## Entry points

`next.config.ts`, `src-tauri/tauri.conf.json`, `src-tauri/src/main.rs`, `src-tauri/src/lib.rs`, `src-tauri/src/local_backend.rs`, `scripts/prepare-runtime.mjs`, and `app/providers.tsx`.

## Map

| Path | Content |
| --- | --- |
| `app/` | Nine Next.js files. Most route files are one-line re-exports of `apps/web`. |
| `scripts/` | `prepare-runtime.mjs` and the smoke scripts |
| `src-tauri/src/` | The Rust shell |
| `src-tauri/capabilities/` | The Tauri permission file |
| `src-tauri/icons/` | The application icons |
| `src-tauri/runtime/` | The generated runtime. Not tracked in Git. |
| `.runtime-staging/` | A generated staging directory |

## Mechanisms

`next.config.ts` sets `output: "export"`, `trailingSlash`, and unoptimized images.
`tauri.conf.json` points `frontendDist` at `../out`.

`app/providers.tsx` calls `initializeDesktopBackend` from `packages/api-client`.
That function invokes the Tauri command `start_local_backend`.

The shared tRPC client uses `wsLink` to call the local Node backend.
Procedures and subscriptions use the same router and application services as the web app.
The local PocketBase stores entity records, identity, and files.
`packages/api-client/src/trpc/client.ts` selects the local backend address and token.

`local_backend.rs` spawns `runtime/node runtime/backend.mjs <dataDir> <readyFile>`.
It waits up to 45 seconds for the ready file and stops the child on exit.

`apps/server/src/desktop/runtime.ts` builds that backend bundle.
At run time it selects a free loopback port, starts PocketBase, writes `local-identity.json`, and serves `/health`, `POST /session`, and a `/session/<secret>` file gateway.
`apps/server/src/desktop/security.ts` holds the origin allowlist.
`apps/server/src/desktop/pb_hooks/local.pb.js` requires the internal request header.

`scripts/prepare-runtime.mjs` builds the runtime into `src-tauri/runtime/`.
The Rust shell checks the latest published release at startup with Tauri updater. Signed updater assets are built only for signed candidates. The release workflow publishes `latest.json` with the accepted installers.

## Commands

| Command | Action |
| --- | --- |
| `pnpm dev` | The static front end on port 3002 |
| `pnpm build` | The static front end only. This is not a native build. |
| `pnpm desktop:dev` | Tauri development run. It prepares the runtime first. |
| `pnpm desktop:build` | A native bundle for the current platform |
| `pnpm runtime:prepare` | Build the runtime resources only |

## Desktop checks

```bash
pnpm --filter desktop runtime:prepare
node apps/desktop/scripts/backend-smoke.mjs
cargo test --locked --release --lib --manifest-path apps/desktop/src-tauri/Cargo.toml
```

## Rules

1. Edit `apps/web` for a shared page. The files under `app/(main)/` and `app/login/page.tsx` are re-exports.
2. Do not edit a generated directory: `src-tauri/runtime/`, `src-tauri/target/`, `src-tauri/gen/`, `.runtime-staging/`, or `out/`.
3. Keep the origin allowlist in `apps/server/src/desktop/security.ts` equal to the Tauri origin.
4. Prepare the runtime on the target platform. The native libraries and the binaries must match the build machine.
5. Update `Cargo.lock` after a Rust dependency change.
