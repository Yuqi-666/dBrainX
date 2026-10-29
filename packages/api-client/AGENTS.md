# packages/api-client/AGENTS.md

Scope: the `packages/api-client` package.
Parent map: [../AGENTS.md](../AGENTS.md).

This package is the transport boundary between a client and the server.
It owns the tRPC client, the PocketBase client, uploads, the auth session, and the desktop bridge.
`apps/web`, `apps/desktop`, `editor`, `graph`, `hooks`, `services`, and `ui` import it.

## Public surface

One entry: `"."` maps to `src/index.ts`.
It exports:

- The tRPC client and the React provider
- The graph subscriptions and the event handler
- The upload helpers and the file-analysis calls
- The PocketBase client and the backend URL resolver
- The auth session helpers and the desktop bridge

## Map

| Path | Content |
| --- | --- |
| `src/trpc/client.ts` | The WebSocket tRPC client |
| `src/trpc/provider.tsx` | The React provider and the `trpc` object |
| `src/trpc/subscriptions.ts` | The server event subscription |
| `src/trpc/hooks/useGraph.ts` | The graph data hook |
| `src/handler/graph-handler.ts` | Applies a server event to the stores |
| `src/auth/session.ts` | The `pb_token` cookie helpers |
| `src/pocketbase-client.ts` | The PocketBase singleton |
| `src/backend-urls.ts` | Chooses the backend address |
| `src/desktop-backend.ts` | Starts and refreshes the desktop local backend |
| `src/upload.ts` | Sends a blob to the PocketBase `files` collection, or delegates a large one to `upload-chunked.ts`; `replaceAttachment` PATCHes a new blob into an existing record (same record id), which is how an Excalidraw preview is saved in place |
| `src/upload-chunked.ts` | Chunked, resumable upload of one file over the API upload routes |
| `src/file-analysis.ts` | Asks the backend to parse a PDF or transcode a video |
| `src/resources.ts` | The media resource library: reads the `files` collection (including the analysis cached on a resource and the derived artifacts hidden from the cards), renames and deletes resources, caches browser measurements, reads the storage limits, resolves the resources named by a node's stored addresses, and lists the nodes that reference one resource |

## Mechanisms

`client.ts` builds one WebSocket client with `wsLink`, `superjson`, and a lazy socket.
It sends `{ token, sourceId }` as connection parameters.
In desktop mode the token comes from the desktop backend. Otherwise it comes from the `pb_token` cookie.

`provider.tsx` creates the typed `trpc` object and wraps the React Query provider.
This package imports `AppRouter` as a type only. All four imports are `import type`, so no runtime edge to `adapter-front` exists.

Desktop uses the same `wsLink` for procedures and subscriptions. It connects to the local Node backend, which uses the shared router and PocketBase repositories.

`subscriptions.ts` listens on `event.onEvent` and drops an event whose `sourceId` equals this client's own id.
`graph-handler.ts` then updates the stores through `@workspace/services` and applies a workspace-isolation guard.

`auth/session.ts` owns the cookie name and the seven-day maximum age.
`apps/web/middleware.ts` reads the same cookie, so change both files together.

`pocketbase-client.ts` keeps one instance, uses a session-only auth store, and adds the token in `beforeSend`.
It skips that step in desktop mode.

`backend-urls.ts` gives a loopback browser the direct ports. Any other browser gets the same-origin paths `/trpc` and `/pb`.
It also resolves the upload base: `:3001` for a loopback browser, `<origin>/pb` behind a proxy (which is why no proxy rule has to be added), and the desktop session base.

`upload.ts` sends a blob at or below `DIRECT_UPLOAD_MAX_BYTES` straight to PocketBase, exactly as it always has.
A larger file goes to `upload-chunked.ts`, which opens a session on the API, PUTs the chunks the server reports as missing, and polls until the server has assembled and stored the file.
A `404` on a chunk means the session is gone, so the client opens a new one and recomputes which chunks it must send — everything the old session held is missing from the new one. A `409` from `complete` names the chunks the server does not have, and the client sends those again before giving up.
Resume state lives in `localStorage`, keyed by a hash of the file identity, so a reload continues instead of restarting.
The limits and the route paths come from `@workspace/utils/upload`, the same module the server uses.
`file-analysis.ts` then asks the backend to parse the stored file.

## Rules

1. Keep the `AppRouter` import type-only. A runtime import of `adapter-front` would break the package split.
2. Add a new procedure call here. Do not import `@workspace/adapter-front` inside a component.
3. Keep the cookie name and the maximum age equal to `apps/web/middleware.ts`.
4. Add a new server event to `subscriptions.ts` and its handler to `graph-handler.ts`.
5. Remember the known cycle `api-client` and `services`. `graph-handler.ts` imports `services`, and a service imports `trpcClient`. Add an import in the existing direction only.
6. Keep PocketBase credentials in memory. Do not use the SDK local storage.
