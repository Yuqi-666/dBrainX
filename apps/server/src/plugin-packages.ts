// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The shipped plugin packages, as the plugin host receives them.
 *
 * `apps/server` is the one layer allowed to import `plugins/**`; the host takes
 * the contributions it already imported and never reaches into a plugin module
 * itself. Each shipped package is described exactly like an installed one —
 * its directory, its kind, and the definitions and handlers it contributes —
 * the only difference is that it ships with the application.
 *
 * A shipped package carries no usable integrity baseline in the source tree:
 * the manifest a developer edits cannot hold the checksum of the edit that
 * follows it. The package is therefore copied once at start, the copy is
 * stamped with the checksum the host verifies, and the host reads the stamped
 * copy. The release layout can ship an already-stamped manifest; staging it
 * still produces the same self-consistent pair and keeps one code path for
 * `src/`, `dist/`, and the desktop runtime.
 *
 * The kind is `builtin` for both shipped packages: they are part of the
 * application build, default-enabled and not uninstalled. A package
 * administratively installed later arrives as a `trusted` source from the
 * deployment, with its signature checked by the host.
 */
import { existsSync } from "node:fs";
import { cp, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  graphOperations,
  nodeTypes as builtinNodeTypes,
  operations as builtinOperations,
  typeOperations,
} from "../../../plugins/builtin/server/index.ts";
import {
  nodeTypes as counterNodeTypes,
  operations as counterOperations,
  triggers as counterTriggers,
} from "../../../plugins/counter/server/index.ts";
import type { OperationHandler } from "@workspace/domain";
import type { PluginPackageSource } from "@workspace/plugin-host";
import { pluginChecksum, readPluginManifest } from "../../../backend/plugin-host/src/index.ts";

import { bindOperationHandlers } from "./operation-registry.ts";

const BUILTIN_DIRECTORY_VARIABLE = "DBRAINX_BUILTIN_PLUGIN_DIR";

/** The handlers each shipped package binds; a definition without one refuses the enable. */
export interface ShippedPluginHandlers {
  readonly builtin: Readonly<Record<string, OperationHandler>>;
  readonly counter: Readonly<Record<string, OperationHandler>>;
}

/**
 * One shipped package directory, or `undefined` when this layout has none.
 *
 * Resolved at start rather than baked in, because the same source runs from
 * `src/` (tsx), from `dist/` (the bundle), and from a copied bundle directory
 * in the smoke test and the desktop runtime.
 */
export function resolveShippedPluginDirectory(
  name: string,
): string | undefined {
  const configured =
    name === "builtin"
      ? process.env[BUILTIN_DIRECTORY_VARIABLE]?.trim()
      : undefined;
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    ...(configured === undefined || configured === "" ? [] : [configured]),
    join(here, "plugins", name),
    join(process.cwd(), "plugins", name),
    join(here, "../../../plugins", name),
  ];
  for (const candidate of candidates) {
    const directory = resolve(candidate);
    if (existsManifest(directory)) return directory;
  }
  return undefined;
}

function existsManifest(directory: string): boolean {
  return existsSync(join(directory, "plugin.json"));
}

/**
 * Copy one package and stamp the copy with the checksum the host verifies.
 *
 * The copy is the package the host serves for this process; a later edit to
 * the source tree cannot change what was already verified at start.
 */
async function stageShippedPackage(name: string, directory: string): Promise<string> {
  const staged = await mkdtemp(join(tmpdir(), `dbrainx-${name}-`));
  await cp(directory, staged, {
    recursive: true,
    dereference: true,
    // A workspace link would be followed into the whole repository; the host's
    // checksum skips `node_modules` for the same reason.
    filter: (source) => basename(source) !== "node_modules",
  });
  const manifestPath = join(staged, "plugin.json");
  const loaded = await readPluginManifest(staged);
  // A shipped builtin is not a signed install: strip the signature facts a
  // fixture may carry and stamp the integrity baseline over the unsigned
  // manifest the host will read back.
  const manifest = { ...loaded.manifest };
  delete manifest.checksum;
  delete manifest.signature;
  delete manifest.publicKeyId;
  const checksum = await pluginChecksum(staged, manifest);
  await writeFile(
    manifestPath,
    `${JSON.stringify({ ...manifest, checksum }, null, 2)}\n`,
    "utf8",
  );
  return staged;
}

/** The two shipped packages, in the order grants seeding reads them. */
export async function createShippedPluginPackages(
  handlers: ShippedPluginHandlers,
): Promise<readonly PluginPackageSource[]> {
  const packages: PluginPackageSource[] = [];

  const builtinDirectory = resolveShippedPluginDirectory("builtin");
  if (builtinDirectory !== undefined) {
    const definitions = [
      ...builtinOperations,
      ...typeOperations,
      ...graphOperations,
    ];
    packages.push({
      directory: await stageShippedPackage("builtin", builtinDirectory),
      kind: "builtin",
      nodeTypes: builtinNodeTypes,
      operations: definitions,
      handlers: bindOperationHandlers(definitions, handlers.builtin),
    });
  }

  const counterDirectory = resolveShippedPluginDirectory("counter");
  if (counterDirectory !== undefined) {
    packages.push({
      directory: await stageShippedPackage("counter", counterDirectory),
      kind: "builtin",
      nodeTypes: counterNodeTypes,
      operations: counterOperations,
      triggers: counterTriggers,
      handlers: bindOperationHandlers(counterOperations, handlers.counter),
    });
  }

  return packages;
}
