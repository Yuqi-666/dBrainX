# apps/web/AGENTS.md

Scope: the `apps/web` package.
Parent map: [../AGENTS.md](../AGENTS.md).

This package is the browser client.
It uses the Next.js App Router.
It contains no business logic.

## Entry points

`next.config.mjs`, `middleware.ts`, `app/layout.tsx`, `app/providers.tsx`, and `app/page.tsx`.

## Map

| Path | Content |
| --- | --- |
| `app/(auth)/` | The login and register pages with their own layout |
| `app/(main)/` | The authenticated layout, plus the graph, dashboard, and resources pages |
| `components/` | Six app-level components, for example `workspace-shell.tsx` and `dynamic-island-host.tsx` |
| `hooks/` | `use-workspace-initialization.ts` |
| `lib/` | The generated plugin UI map and the bootstrap that registers it before the first render |
| `public/` | Empty |

## Mechanisms

`middleware.ts` runs on the edge.
It guards `/graph`, `/dashboard`, `/resources`, and `/settings`.
It decodes the `pb_token` cookie and reads the expiry only.
It does not call the server, so it cannot detect a user that no longer exists.

`app/(main)/layout.tsx` calls the protected `auth.me` query.
The server verifies the token, so this query is the source of truth for the session.
The layout mounts `WorkspaceShell` and `DynamicIslandHost` only after that query succeeds.
The edge middleware alone is not sufficient, and the layout clears the cookie on a rejected token.

`WorkspaceShell` lives in the layout, not in a page, because a layout survives a soft navigation.
The graph, the dashboard, and the resource library therefore keep their state during a switch.
The shell reads the active surface from the pathname through `components/island-routes.ts`.
The `/graph` and `/dashboard` pages render `null`.

`app/providers.tsx` creates the PocketBase client, wraps the tRPC provider, and starts the graph subscriptions.
`packages/api-client/src/backend-urls.ts` selects the address.
A loopback browser uses ports 3001 and 8090. Any other host uses `/trpc` and `/pb` on the same origin.

## Commands

| Command | Action |
| --- | --- |
| `pnpm dev` | Next.js on port 3000 |
| `pnpm build` | `next build --webpack` |
| `pnpm start` | The production server |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | `tsc --noEmit` |

## Rules

1. Do not put business logic here. Call a tRPC procedure or use a store.
2. Edit a shared component in `packages/ui`. Do not fork it here.
3. Do not edit `.next/`.
4. Keep the two route groups. Desktop route files re-export the files in `app/(main)/`.
5. Remember that `tsconfig.json` restates `baseUrl: "../.."`. Turbopack needs this value for alias resolution, so do not remove it.
6. Remember that `middleware.ts` names `/settings`, but no settings route exists. Do not assume that path works.
