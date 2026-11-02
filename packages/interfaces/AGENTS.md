# packages/interfaces/AGENTS.md

Scope: the `packages/interfaces` package.
Parent map: [../AGENTS.md](../AGENTS.md).

This package declares the shared data model and the API contracts.
It is almost all types. The runtime exports are pure constant lists and helpers that both sides share, such as `DATA_VIEW_TYPES`, `DATABASE_FIELD_TYPES`, and `buildNodeFilterFields`.
It is the agreement between the two client apps, the packages, and `backend/`.

## Public surface

| Export | Content |
| --- | --- |
| `.` | Everything from `./models`, `./api`, and `./media-import` |
| `./api` | attachment, query, event, and upload-session contracts |
| `./models` | dashboard, data-view, edge, filter, island, node, user, view, and workspace |
| `./common` | Declared, but the directory does not exist |
| `./nodes` | Declared, but the directory does not exist |

## Map

| Path | Content |
| --- | --- |
| `src/models/node/types.ts` | `NodeTypeId`, the deprecated `NodeDataType` alias, `NodeType<T>`, and the open `NodeData<C>` shape. No runtime list. |
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
| `src/media-import.ts` | `MediaKind`, `MediaImportStage`, progress, and error shapes for a video or audio import. |

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
(`packages/ui/src/components/node-content/registry.ts`) is the runtime list.
`backend/domain` owns the `INodeTypeRegistry` contract, and `backend/plugin-host`
implements it from the enabled plugin definitions.
Nothing in this package may hold a list of type ids.

## Rules

1. Prefer a type. Do not add a class or a runtime import. A pure helper or a constant list is allowed when both sides must read the same copy.
2. Add a contract here when two sides must agree and neither side may own it.
3. Add a node type definition in its plugin package with `defineNodeType` from `@workspace/plugin-sdk`. This package carries the generic DTO, not the registry entry.
4. Keep the generic `Node` DTO and the API contracts equal to the backend contract. `backend/domain` and `backend/application` import these types.
5. Keep the `RuleGroupType` import type-only. The only dependency of this package is `packages/utils`.
6. Do not use the `./common` or `./nodes` subpath. Each one points to no directory.
