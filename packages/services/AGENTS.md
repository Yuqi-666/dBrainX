# packages/services/AGENTS.md

Scope: the `packages/services` package.
Parent map: [../AGENTS.md](../AGENTS.md).

This package holds the client-side services.
A service changes the local store and calls the server through tRPC.
It is the single owner of that sequence.
`api-client`, `graph`, `hooks`, `ui`, and the two client apps import it.

## Public surface

| Export | Content |
| --- | --- |
| `.` | Re-exports `./graph` |
| `./graph` | The eight services, the operation catalogue, and the view-enumeration helpers |
| `./graph/*` | A direct service module |

## Map

| Path | Content |
| --- | --- |
| `src/graph/node.service.ts` | `NodeService`. It exposes the single write entry (`invoke`, plus one typed helper per operation), and it owns the resource-reference reads: which nodes point at one file, and clearing a deleted file from the open nodes. |
| `src/graph/operations.ts` | The operation catalogue (id, target kind, effect, resource), the typed inputs, the target builders, and `invokeGraphOperation`: one `operation.invoke`, then the store update from the reply. |
| `src/graph/edge.service.ts` | `EdgeService` |
| `src/graph/view.service.ts` | `ViewService` |
| `src/graph/workspace.service.ts` | `WorkspaceService`. It calls the other services. |
| `src/graph/node-semantic.service.ts` | `NodeSemanticService` |
| `src/graph/edge-semantic.service.ts` | `EdgeSemanticService` |
| `src/graph/node-tag.service.ts` | `NodeTagService` |
| `src/graph/dashboard.service.ts` | `DashboardService` |
| `src/graph/view-enum-sync.ts` | Keeps a view enumeration equal to the data |
| `src/graph/index.ts` | The aggregate barrel |

## Mechanisms

A create calls the server first, because the server supplies the record id.
The service then writes the result into the store and updates the view enumeration.

`NodeService` can debounce the network call through `DebounceScheduler`.
The store update stays synchronous. The default delay is 500 milliseconds.
The scheduler also rolls back to the snapshot from before the debounce window.

The current write path is `invokeGraphOperation`: one `operation.invoke`, then the canonical `node` / `edge` / `view` snapshot the server reloaded is written to the store. A refusal throws `OperationInvokeError` with the server's code and writes nothing. `NodeService`, `EdgeService`, and `ViewService` expose typed helpers over it. There is no whole-record write left: the routers serve reads only, and a write names its operation.

The reply is applied with its delivery identity (its last event id, or the correlation id), so the store keeps the newer of a result and a later event (`packages/store/src/snapshot-order.ts`).

A service can read as well as write.
`sync` and `syncByWorkspace` call a query and load the result into the store.
`listNodesReferencingFile` unions the open store with the nodes the database lists, and `detachFileReferences` applies a deleted file's cleanup to the open nodes after the server hook has fixed the stored records.

`WorkspaceService` calls the other services, so a workspace change cascades.

`view-enum-sync.ts` holds the view rule: a view shows `filter(workspace)` plus its enumeration.
When a new node does not match the active filter, the helper adds the node to `selectedNodes`.
A global view has an empty filter and an empty enumeration, and the helper never touches it.

The service modules import `trpcClient` from `@workspace/api-client`.
That import and `graph-handler.ts` form the known `api-client` and `services` cycle.

## Rules

1. Name the operation. A service helper wraps one operation id; do not add a field-shaped write that merges arbitrary keys.
2. Keep the store update synchronous.
3. Add a service for a new aggregate and export it from `src/graph/index.ts`.
4. Call `syncViewEnumerationOnCreate` or `syncViewEnumerationOnDelete` after a node create or delete.
5. Do not import `@workspace/api-client` from a new module without a check on the known cycle.
6. Check the router before you trust a comment. A service comment can call a procedure pending when the router already defines it.
