// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The builtin plugin package, as the plugin host receives it.
 *
 * `apps/server` is the one layer allowed to import `plugins/**`; the host takes
 * the contributions it already imported and never reaches into a plugin module
 * itself. The builtin package is described exactly like an installed one: its
 * directory, its kind, and the definitions and handlers it contributes — the
 * only difference is that it ships with the application.
 *
 * The directory is resolved at start rather than baked in, because the same
 * source runs from `src/` (tsx), from `dist/` (the bundle), and from a copied
 * bundle directory in the smoke test. A deployment that lays the plugins out
 * elsewhere names the path with `DBRAINX_BUILTIN_PLUGIN_DIR`.
 */
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  graphOperations,
  nodeTypes,
  operations,
  typeOperations,
} from "@plugin/builtin/server";
import type { OperationHandler } from "@workspace/domain";
import type { PluginPackageSource } from "@workspace/plugin-host";

const BUILTIN_DIRECTORY_VARIABLE = "DBRAINX_BUILTIN_PLUGIN_DIR";

/** The builtin package directory, or `undefined` when this layout has none. */
export function resolveBuiltinPluginDirectory(): string | undefined {
  const configured = process.env[BUILTIN_DIRECTORY_VARIABLE]?.trim();
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    ...(configured === undefined || configured === "" ? [] : [configured]),
    // The bundle's own copy (the build stages `plugins/` beside `index.mjs`),
    // then the workspace tree for a server started from source.
    join(here, "plugins/builtin"),
    join(process.cwd(), "plugins/builtin"),
    join(here, "../../../plugins/builtin"),
  ];
  for (const candidate of candidates) {
    const directory = resolve(candidate);
    if (existsSync(join(directory, "plugin.json"))) return directory;
  }
  return undefined;
}

/** The package source for the builtin plugin, or `undefined` when it is not on disk. */
export function createBuiltinPluginPackage(
  handlers: Readonly<Record<string, OperationHandler>>,
): PluginPackageSource | undefined {
  const directory = resolveBuiltinPluginDirectory();
  if (directory === undefined) return undefined;
  return {
    directory,
    kind: "builtin",
    nodeTypes,
    operations: [...operations, ...typeOperations, ...graphOperations],
    handlers,
  };
}
