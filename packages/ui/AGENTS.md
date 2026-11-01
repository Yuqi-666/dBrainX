# packages/ui/AGENTS.md

Scope: the `packages/ui` package.
Parent map: [../AGENTS.md](../AGENTS.md).

This package holds the shared user-interface code.
It contains the shadcn and Radix component library.
It also contains the application-level composition surface.
`apps/web`, `apps/desktop`, `dataview`, `editor`, and `graph` import it.

## Public surface

The package has no `"."` export.
The available subpaths are `./globals.css`, `./postcss.config`, `./lib/*`, `./components/*`, `./hooks/*`, and `./plugin-kit`.
`./components/*` maps to `src/components/*.tsx`.
Consumers therefore import a deep path, for example `@workspace/ui/components/header/graph-header/...`.

## Map

| Path | Content |
| --- | --- |
| `src/components/` | About 24 feature directories, for example `header`, `dialog`, `sidebar`, `node-content`, `resources`, and `dynamic-island` |
| `src/components/ui/` | About 31 vendored shadcn primitives |
| `src/components/index.ts` | The aggregate application surface. It exports the graph layout, the sidebar, the preview block, and the dynamic island. |
| `src/components/dynamic-island/` | Island shell, navigation, motion, and feature panels. Read [src/components/dynamic-island/AGENTS.md](src/components/dynamic-island/AGENTS.md). |
| `src/hooks/` | Shared React hooks |
| `src/lib/` | `utils.ts` holds `cn`. `inner-layer.ts` holds the layer order. |
| `src/styles/` | `globals.css` and the Tailwind setup |
| `src/img/` | Icons and images |

## Mechanisms

`components.json` drives the shadcn command-line tool.
It sets the style `radix-vega` and the base color `mist`.
Generate a primitive with that tool, so the file and the registry stay equal.

`src/lib/utils.ts` exports `cn`, the class-name helper.
It is the most used function in the package.

`src/components/index.ts` is an internal barrel, not a package export.
Only the app shell imports it.

## Rules

1. Import a primitive with a deep path. The package has no root export.
2. Add a new shadcn primitive through `components.json`, not by hand.
3. Use `cn` from `@workspace/ui/lib/utils` for class names.
4. Keep a feature component inside its feature directory. Do not add a new top-level file to `src/components/`.
5. Check the known cycles with `editor` and `dataview` before you add a cross-import.
