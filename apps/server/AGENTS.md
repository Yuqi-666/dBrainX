# apps/server/AGENTS.md

Scope: the `apps/server` package.
Parent map: [../AGENTS.md](../AGENTS.md).

This package is the long-running server process.
It hosts the tRPC router from `backend/adapter-front`.
It also serves an authenticated PocketBase file gateway.
It contains no business logic.

## Entry points

`src/index.ts`, `src/origin.ts`, `scripts/build.mjs`, and `Dockerfile`.

## Map

| Path | Content |
| --- | --- |
| `src/index.ts` | The HTTP and WebSocket server |
| `src/origin.ts` | The same-origin check |
| `src/upload/routes.ts` | The resumable upload endpoints and the session sweeper, shared by both listeners |
| `src/desktop/` | The local mode for the desktop app: `runtime.ts`, `security.ts`, `upgrade-backup.ts`, and `pb_hooks/local.pb.js` |
| `src/*.test.ts` | Tests for the origin check and the desktop security rules |
| `scripts/build.mjs` | The esbuild bundle step |

## Mechanisms

`src/index.ts` creates a `node:http` server.
It answers `/health`.
It forwards `/pb/*` only after `allowedFileRequest`, `sameOrigin`, and `verifyToken` all pass. The allowlist admits reading one blob, the `files` records list, the direct upload, and the rename/delete of one file record; PocketBase rules scope every row to the caller.
It serves `/pb/upload/*` itself, after `sameOrigin` and `verifyToken`: the chunks are spooled on this host and only the assembled file reaches PocketBase.
It serves the tRPC WebSocket at `/trpc` through `createWSServer` in `noServer` mode.

At start the server waits up to 30 seconds for `PB_URL/api/health`.
Then it calls `AppContainer.initialize(PB_URL)` and starts the upload sweeper.
It shuts down on `SIGINT` or `SIGTERM`.

Environment variables: `PORT` defaults to 3001. `PB_URL` defaults to `127.0.0.1:8090`. Set `DBRAINX_PUBLIC_ORIGIN` only when a proxy rewrites the Host header. `DBRAINX_UPLOAD_DIR` moves the chunk spool (default `<system temp>/dbrainx-uploads`).

The same source produces the desktop backend bundle through `src/desktop/runtime.ts`.
The desktop listener mounts the same upload handler under `/session/<secret>/upload/*`; there the session secret replaces the token check, and `DBRAINX_PB_INTERNAL_SECRET` in the runtime environment is what lets the file store reach the local PocketBase over raw `node:http`.

## Commands

| Command | Action |
| --- | --- |
| `pnpm dev` | `tsx watch src/index.ts` |
| `pnpm dev:pb` | Start the local PocketBase through `scripts/dev-pocketbase.mjs` |
| `pnpm build` | esbuild to `dist/index.mjs` |
| `pnpm start` | Run the built bundle |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | `tsc --noEmit` |

## Rules

1. Put business behavior in `backend/`. This package only hosts it.
2. Keep the same-origin check and the token check on the file gateway. Both protect an attachment.
3. Remember that `apps/server` is the only process with a public port. Route a new endpoint through this file.
4. Do not commit `dist/`.
5. Point the smoke test at an isolated database only. Never run `scripts/release/server-smoke.mjs` against a live service.
