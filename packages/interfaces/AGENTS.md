# packages/interfaces/AGENTS.md

Scope: the `packages/interfaces` package.
Parent map: [../AGENTS.md](../AGENTS.md).

This package declares the shared data model and the API contracts.
It contains types only and no runtime code.
It is the agreement between the two client apps, the packages, and `backend/`.

## Public surface

| Export | Content |
| --- | --- |
| `.` | Everything from `./models` and `./api` |
| `./api` | attachment, query, event, and upload-session contracts |
| `./models` | dashboard, data-view, edge, filter, island, node, user, view, and workspace |
| `./common` | Declared, but the directory does not exist |
| `./nodes` | Declared, but the directory does not exist |

## Map

| Path | Content |
| --- | --- |
| `src/models/node/types.ts` | `NodeTypeId`, `NodeType<T>`, and the open `NodeData<C>` shape. No runtime list. |
| `src/models/node/nodes/single/` | text, image, pdf, video, audio, webpage, website, and timestamp-data |
| `src/models/node/nodes/complex/` | collection, database, and rich-text |
| `src/models/node/base.ts` | The node base shape that every node type extends |
| `src/models/data-view.ts` | The `DataView` shapes for a collection or database node |
| `src/models/filter.ts` | The filter contract. It uses `RuleGroupType` from `packages/utils`. |
| `src/models/island.ts` | The dynamic-island union |
| `src/models/view.ts` | The graph view shape |
| `src/api/event.ts` | `DomainEvent` and the event types per aggregate |
| `src/api/attachment.ts` | `IAttachment` |
| `src/api/query.ts` | The query shapes |
| `src/api/upload.ts` | The resumable upload wire shapes. The limits and the routes are runtime values, so they live in `packages/utils/src/upload.ts`. |

## Conventions

The event contract carries an ID only.
A client fetches the full entity through `@workspace/services`.
`metadata.sourceId` names the client that caused the event, so a client can ignore its own event.

`models/island.ts` holds the island union, because `store` owns that state and `ui` renders it.
Neither side must import the other for this contract.
Note that `packages/ui` does import `@workspace/store` in many components today.

`models/data-view.ts` stays free of React and of third-party library types.
The persisted shape must round-trip through the API without a renderer.
`@workspace/dataview` declares the renderer contract that consumes it.

A node type id is `NodeTypeId`, a plain string, because node types are runtime data.
The ten builtin types are declared by the plugin packages; the client registry
(`packages/ui/src/components/node-content/registry.ts`) is the runtime list, and
`backend/domain` validates a type through its own node-type registry.
Nothing in this package may hold a list of type ids.

## Rules

1. Declare a type here. Do not add a function, a class, or a runtime import.
2. Add a contract here when two sides must agree and neither side may own it.
3. Change a node type here first, then in `backend/domain` and the adapters.
4. Keep this package equal to the backend domain model. `backend/domain` and `backend/application` import these types.
5. Keep the `RuleGroupType` import type-only. The only dependency of this package is `packages/utils`.
6. Do not use the `./common` or `./nodes` subpath. Each one points to no directory.
