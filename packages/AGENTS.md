# packages/AGENTS.md

Scope: the `packages/` directory.
Parent map: [../AGENTS.md](../AGENTS.md).

This directory holds the shared JavaScript packages.
`apps/web` and `apps/desktop` import them.
`backend/domain` imports `interfaces` and `utils`.
Each package ships TypeScript source. No package has its own build step.
The aliases `@workspace/*` come from `tsconfig.workspace.json`.

## Map

| Package | Role | Read next |
| --- | --- | --- |
| `api-client` | tRPC client, PocketBase client, uploads, auth, desktop bridge | [api-client/AGENTS.md](api-client/AGENTS.md) |
| `dataview` | Data-view engine and the view registry | [dataview/AGENTS.md](dataview/AGENTS.md) |
| `editor` | Tiptap rich-text and block editor | [editor/AGENTS.md](editor/AGENTS.md) |
| `graph` | Force-mode and flow-mode graph rendering | [graph/AGENTS.md](graph/AGENTS.md) |
| `hooks` | Shared React hooks. The package exports only `useGraph`. | this file |
| `interfaces` | The shared data model and API contracts. Almost all types, plus a few shared constants. | [interfaces/AGENTS.md](interfaces/AGENTS.md) |
| `plugin-sdk` | The plugin author API: `defineNodeType`, `defineOperation`, `defineTrigger`, and the UI contribution types | [plugin-sdk/src/index.ts](plugin-sdk/src/index.ts) |
| `services` | Client services that wrap tRPC for each graph entity | [services/AGENTS.md](services/AGENTS.md) |
| `store` | Zustand stores for data, UI, auth, workspace, source, and dashboard | [store/AGENTS.md](store/AGENTS.md) |
| `ui` | shadcn and Radix components plus the app composition surface | [ui/AGENTS.md](ui/AGENTS.md) |
| `utils` | Framework-free helpers and a react-querybuilder re-export. `@workspace/utils/upload` is the shared upload contract (limits, chunk maths, route paths) and deliberately avoids the barrel, which re-exports react-querybuilder. | this file |
| `eslint-config` | Shared ESLint configurations | this file |
| `typescript-config` | Shared tsconfig files | this file |

## Dependency direction

The base order is `interfaces`, then `store`, then `services`, then `hooks`. Each layer uses the layers below it.
`utils` sits below `interfaces`. The feature packages sit above the spine.
`plugin-sdk` sits below `plugins/*` and uses `domain`, `interfaces`, and `utils`.

Known cycles exist. Do not add another one.
- `ui` and `editor`
- `ui` and `dataview`
- `ui` -> `dataview` -> `graph` -> `ui`
- `api-client` and `services`
- `interfaces` and `utils`, with type-only imports

## Config packages

`eslint-config` exports `./base`, `./next-js`, and `./react-internal`.
`apps/web` uses `next-js`. `dataview`, `editor`, `services`, and `ui` use `react-internal`.

`typescript-config` holds `base.json`, `nextjs.json`, and `react-library.json`.
The two client apps extend `nextjs.json`.
`apps/server` and the code packages extend `react-library.json`.

## Rules

1. Import a shared shape from `interfaces`. Do not declare a second copy. A node content schema and a plugin's operation definitions live in that plugin package.
2. Keep the generic node DTO and the API contracts equal to the backend contract. Node types are per plugin, so `interfaces` must not gain a closed type list.
3. Do not add a cycle between packages.
4. Export new code through the `exports` field of `package.json`.
5. Prefer a type-only import when you need types only. A type-only import cannot create a runtime cycle.
6. Add a workspace dependency to `package.json` for each new `@workspace/*` import. Some packages skip this step today.
7. Remember two gaps. `interfaces` declares the subpaths `./common` and `./nodes`, but those directories do not exist. `ui` and `editor` have no `"."` export, so consumers use deep paths.
