# packages/store/AGENTS.md

Scope: the `packages/store` package.
Parent map: [../AGENTS.md](../AGENTS.md).

This package holds the client state in Zustand stores.
It owns the state. A component reads a store and calls an action.
`apps/web`, `api-client`, `graph`, `hooks`, `services`, and `ui` import it.

## Public surface

One entry: `"."` maps to `src/index.ts`.
It exports six stores and their types: `useDataStore`, `useUIStore`, `useAuthStore`, `useWorkspaceStore`, `useSourceIdStore`, and `useDashboardStore`.

## Map

| Path | Content |
| --- | --- |
| `src/dataStore.ts` | Nodes, edges, views, node semantics, edge semantics, and tags. It publishes an `EntityDiff` with added, updated, and removed entries. |
| `src/snapshot-order.ts` | The ordering rule for server snapshots: `updatedAt` decides, the delivery identity breaks a tie, and an identity-less delivery is a read of the server's current record. |
| `src/uiStore.ts` | The interface state: context menu, main view, sidebar mode, island panel, the node delete/clear disposition dialog, and the remount token for the uncontrolled Tiptap editors |
| `src/authStore.ts` | The current user. It uses the persist middleware. |
| `src/workspaceStore.ts` | The workspaces as a map, `currentWorkspaceId`, and a `reset` action |
| `src/sourceIdStore.ts` | One ULID for this client session |
| `src/dashboardStore.ts` | The dashboard document and the widget slot placement |

## Mechanisms

`dataStore` publishes a diff-shaped update.
`packages/graph` consumes that diff and sends it into its worker, so a store change reaches the renderer without a full reload.

`dataStore` applies only a snapshot that is not older than the one it holds.
`isNewerSnapshot` compares the server's `updatedAt`, then the delivery identity when two deliveries name the same version; an identity-less delivery is a refetch or a local projection and is applied at an equal version.
A view has no server version, so its snapshots are ordered by identity alone.
`snapshotIdentities` records the identity applied per entity, and `reset` clears it.

`sourceIdStore` creates a ULID at load.
The tRPC client sends it as a connection parameter, and `subscriptions.ts` uses it to drop an event from this same client.

`authStore` persists the user, but it is a cache and not the source of truth.
`apps/web/app/(main)/layout.tsx` verifies the session through the `auth.me` query.

`dashboardStore` holds a revision, candidate widgets, pages, and widgets, and computes the first free grid slot.

The dependencies are `interfaces`, `zustand`, and `ulid`.

## Rules

1. Keep one store per concern. Do not add a second store for the same data.
2. Write the local store first, then call the server through a service, and restore the old value on an error. `packages/services` owns that order.
3. Keep a `dataStore` update diff-shaped. A consumer relies on the added, updated, and removed lists.
4. Do not treat `authStore` as authoritative. The server verifies the token.
5. Do not import `@workspace/api-client` here. This package imports `interfaces` only, and it must stay that way.
6. Add a new store to `src/index.ts`. The barrel is hand-maintained.
