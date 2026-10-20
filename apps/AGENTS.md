# apps/AGENTS.md

Scope: the `apps/` directory.
Parent map: [../AGENTS.md](../AGENTS.md).

This directory holds the runnable programs.
The members come from the `apps/*` glob in `pnpm-workspace.yaml`.
`apps/marketing` is excluded from that glob because it is a submodule and not a package.
Run `git submodule update --init apps/marketing` to fill it after a clone.

## Map

| App | Role | Read next |
| --- | --- | --- |
| `web` | Browser client. Next.js App Router. | [web/AGENTS.md](web/AGENTS.md) |
| `desktop` | Tauri 2 shell with a local backend | [desktop/AGENTS.md](desktop/AGENTS.md) |
| `server` | Node process that hosts `backend/` | [server/AGENTS.md](server/AGENTS.md) |
| `marketing` | Not a package. A submodule of the private repository `Yuqi-666/dBrain-marketing`. It holds the marketing material. | none |
| `docs` | Not a package. It holds a stale docsify install only. | none |

## Composition

`apps/web` and `apps/desktop` share the code in `packages/`.
The desktop app also re-exports the web layout and pages, and imports web components through the `@/*` alias.

Both client apps call `apps/server` over tRPC.
`apps/server` hosts `backend/`.
A business change therefore starts in `backend/`, then reaches the clients through a router.

## Rules

1. Remember that the root `pnpm build` builds the server and the web app only. Build the desktop app with `pnpm build:desktop`.
2. Do not commit build output: `apps/web/.next`, `apps/desktop/.next`, `apps/desktop/out`, or `apps/server/dist`.
3. Put shared behavior in `packages/`. Do not copy a component from the web app to the desktop app.
4. Keep `apps/docs` as it is. The real manuals live in `docs/`.
5. Do not edit files under `apps/marketing` from this repository. It is a separate repository. Commit there, then stage the new submodule commit here.
