// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The shipped plugin packages, as the plugin host receives them.
 *
 * Discovery is by manifest, not by a list in this file. Every
 * `plugins/<directory>/plugin.json` below a plugin root is one package; its
 * `serverEntry` is imported and must export `nodeTypes`, `operations` and,
 * when it has any, `triggers`. The composition builds one
 * `PluginPackageSource` from those exports, so a package dropped beside the
 * existing ones is served without editing this module.
 *
 * The one thing discovery cannot read from a package is which operations the
 * application implements in its own process. Those handlers live in backend
 * code by design (`./operation-registry.ts`), so the composition root passes
 * them keyed by package id. A package without such an entry gets no in-process
 * handlers, and every operation it declares runs in its worker instead.
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
 * The kind is `builtin` for every discovered package: it is part of the
 * application build, default-enabled and not uninstalled. A package
 * administratively installed later arrives as a `trusted` source from the
 * deployment, with its signature checked by the host.
 */
import { existsSync } from "node:fs";
import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { OperationHandler } from "@workspace/domain";
import type { PluginPackageSource } from "@workspace/plugin-host";
import {
  INVALID_CONTRIBUTION,
  INVALID_MANIFEST,
  pluginChecksum,
  readPluginManifest,
  refuse,
} from "../../../backend/plugin-host/src/index.ts";

import { bindOperationHandlers } from "./operation-registry.ts";

const BUILTIN_DIRECTORY_VARIABLE = "DBRAINX_BUILTIN_PLUGIN_DIR";

/** The handlers each shipped package binds; a definition without one refuses the enable. */
export interface ShippedPluginHandlers {
  readonly "dbrainx.builtin": Readonly<Record<string, OperationHandler>>;
  readonly "dbrainx.counter": Readonly<Record<string, OperationHandler>>;
}

/**
 * The operations each shipped package implements in its worker.
 *
 * The counter fixture's `acme.*` handlers are plugin code and run in the
 * worker; its `counter.*` declarations are bound to application handlers and
 * stay in the host process, because that binding is the container's, not the
 * plugin module's. A package without an entry here is not builtin code: every
 * operation it declares is served by its own worker entry.
 */
export interface ShippedPluginWorkerOperations {
  readonly "dbrainx.builtin"?: readonly string[];
  readonly "dbrainx.counter"?: readonly string[];
}

type PackageNodeTypes = NonNullable<PluginPackageSource["nodeTypes"]>;
type PackageOperations = NonNullable<PluginPackageSource["operations"]>;
type PackageTriggers = NonNullable<PluginPackageSource["triggers"]>;

interface ImportedContributions {
  readonly nodeTypes: PackageNodeTypes;
  readonly operations: PackageOperations;
  readonly triggers: PackageTriggers;
}

/** The package directory named by `DBRAINX_BUILTIN_PLUGIN_DIR`, if set. */
function configuredPluginDirectory(): string | undefined {
  const value = process.env[BUILTIN_DIRECTORY_VARIABLE]?.trim();
  return value === undefined || value === "" ? undefined : resolve(value);
}

/**
 * The directories that may hold shipped packages, in resolution order.
 *
 * The same source runs from `src/` (tsx), from `dist/` (the bundle), and from a
 * copied bundle directory in the smoke test and the desktop runtime, so the
 * list covers all three layouts rather than baking one in.
 */
function pluginSearchRoots(): readonly string[] {
  const here = dirname(fileURLToPath(import.meta.url));
  const configured = configuredPluginDirectory();
  const roots = [
    ...(configured === undefined ? [] : [dirname(configured)]),
    join(here, "plugins"),
    join(process.cwd(), "plugins"),
    join(here, "../../../plugins"),
  ];
  return [...new Set(roots.map((root) => resolve(root)))];
}

function existsManifest(directory: string): boolean {
  return existsSync(join(directory, "plugin.json"));
}

/**
 * Every shipped package directory, sorted by its directory name.
 *
 * A directory without `plugin.json` is not a package and is skipped. A package
 * with a manifest is returned even when its entries are broken: the manifest
 * reader and the contribution loader refuse it by name, because a package that
 * silently disappears from the composition is worse than a startup refusal.
 */
export async function discoverShippedPluginDirectories(): Promise<
  readonly string[]
> {
  const found = new Map<string, string>();
  const configured = configuredPluginDirectory();
  if (configured !== undefined && existsManifest(configured)) {
    found.set(basename(configured), configured);
  }
  for (const root of pluginSearchRoots()) {
    let entries;
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const directory = join(root, entry.name);
      if (!existsManifest(directory)) continue;
      if (!found.has(entry.name)) found.set(entry.name, directory);
    }
  }
  return [...found.values()].sort((left, right) =>
    basename(left).localeCompare(basename(right)),
  );
}

/**
 * Copy one package and stamp the copy with the checksum the host verifies.
 *
 * The copy is the package the host serves for this process; a later edit to
 * the source tree cannot change what was already verified at start.
 */
async function stageShippedPackage(
  name: string,
  directory: string,
): Promise<string> {
  const staged = await mkdtemp(join(tmpdir(), `dbrainx-${name}-`));
  try {
    await cp(directory, staged, {
      recursive: true,
      dereference: true,
      // A workspace link would be followed into the whole repository; the host's
      // checksum skips `node_modules` for the same reason.
      filter: (source) => basename(source) !== "node_modules",
    });
    await linkRuntimeModules(directory, staged);
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
  } catch (error) {
    await rm(staged, { recursive: true, force: true });
    throw error;
  }
}

/**
 * Give the staged copy the one workspace package its server entry imports.
 *
 * The copy lives in the system temp directory, so Node's resolution never
 * reaches this repository's `node_modules`. A source run therefore links
 * `@workspace/plugin-sdk` into `<staged>/node_modules`; a built package is a
 * self-contained bundle and has no bare import to resolve. The link is a real
 * directory with one symlink inside, not a symlink to `node_modules` itself,
 * because the checksum walk treats a directory named `node_modules` as skipped
 * and a symbolic link as an error.
 */
async function linkRuntimeModules(
  sourceDirectory: string,
  staged: string,
): Promise<void> {
  const source = join(
    sourceDirectory,
    "node_modules",
    "@workspace",
    "plugin-sdk",
  );
  if (!existsSync(source)) return;
  const modules = join(staged, "node_modules", "@workspace");
  await mkdir(modules, { recursive: true });
  await symlink(
    await realpath(source),
    join(modules, "plugin-sdk"),
    process.platform === "win32" ? "junction" : "dir",
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireStringField(
  value: unknown,
  field: string,
  label: string,
  pluginId: string,
): void {
  if (
    !isRecord(value) ||
    typeof value[field] !== "string" ||
    (value[field] as string).trim() === ""
  )
    refuse(
      INVALID_CONTRIBUTION,
      pluginId,
      `serverEntry exports ${label} without a "${field}" string`,
    );
}

function exportedArray(
  module: Readonly<Record<string, unknown>>,
  exportName: "nodeTypes" | "operations" | "triggers",
  pluginId: string,
): readonly unknown[] {
  const value = module[exportName];
  if (value === undefined) return [];
  if (!Array.isArray(value))
    refuse(
      INVALID_CONTRIBUTION,
      pluginId,
      `serverEntry exports "${exportName}" as a non-array; every contribution must be an array`,
    );
  return value;
}

/**
 * Read the contributions a server entry exported.
 *
 * The shape is checked here, one level deep, so a malformed export refuses the
 * package with a named code instead of failing later inside the host or a
 * worker with a property access error. Ownership, duplicate ids and operation
 * resolution stay the host's gates at enable.
 */
function contributionsOf(
  module: Readonly<Record<string, unknown>>,
  pluginId: string,
): ImportedContributions {
  const nodeTypes = exportedArray(module, "nodeTypes", pluginId).map(
    (entry, index) => {
      requireStringField(entry, "type", `nodeTypes[${index}]`, pluginId);
      requireStringField(entry, "pluginId", `nodeTypes[${index}]`, pluginId);
      return entry as PackageNodeTypes[number];
    },
  );
  const operations = exportedArray(module, "operations", pluginId).map(
    (entry, index) => {
      requireStringField(entry, "id", `operations[${index}]`, pluginId);
      requireStringField(entry, "handler", `operations[${index}]`, pluginId);
      return entry as PackageOperations[number];
    },
  );
  const triggers = exportedArray(module, "triggers", pluginId).map(
    (entry, index) => {
      requireStringField(entry, "id", `triggers[${index}]`, pluginId);
      requireStringField(entry, "pluginId", `triggers[${index}]`, pluginId);
      requireStringField(entry, "operation", `triggers[${index}]`, pluginId);
      return entry as PackageTriggers[number];
    },
  );
  return { nodeTypes, operations, triggers };
}

/** Import the module the manifest names, refusing a broken entry by name. */
async function importServerEntry(
  pluginId: string,
  directory: string,
  declared: string,
): Promise<Readonly<Record<string, unknown>>> {
  const entry = resolve(directory, declared);
  const info = await stat(entry).catch(() => undefined);
  if (info === undefined)
    refuse(
      INVALID_MANIFEST,
      pluginId,
      `declares a serverEntry that does not exist: ${declared}`,
    );
  if (info.isDirectory())
    refuse(
      INVALID_MANIFEST,
      pluginId,
      `declares a serverEntry that is a directory, not an entry module: ${declared}`,
    );
  try {
    return (await import(pathToFileURL(entry).href)) as Readonly<
      Record<string, unknown>
    >;
  } catch (error) {
    refuse(
      INVALID_MANIFEST,
      pluginId,
      `serverEntry "${declared}" failed to load: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function hasPackageKey(map: object, pluginId: string): boolean {
  return Object.prototype.hasOwnProperty.call(map, pluginId);
}

/**
 * The shipped packages, in discovery order.
 *
 * Each package is staged first and then imported from the staged copy, so the
 * definitions the host registers are exactly the bytes its checksum covers. A
 * package whose entry cannot be imported, or whose contributions are not the
 * documented arrays, removes its staged copy and refuses startup.
 */
export async function createShippedPluginPackages(
  handlers: ShippedPluginHandlers,
  workerOperations: ShippedPluginWorkerOperations = {},
): Promise<readonly PluginPackageSource[]> {
  const packages: PluginPackageSource[] = [];

  for (const directory of await discoverShippedPluginDirectories()) {
    const name = basename(directory);
    const staged = await stageShippedPackage(name, directory);
    try {
      const loaded = await readPluginManifest(staged);
      const pluginId = loaded.manifest.id;
      const declared = loaded.manifest.serverEntry;
      if (declared === undefined || declared.trim() === "")
        refuse(
          INVALID_MANIFEST,
          pluginId,
          "declares no serverEntry; a discovered package must name the module that exports its contributions",
        );
      const module = await importServerEntry(pluginId, staged, declared);
      const definitions = contributionsOf(module, pluginId);
      const bound = hasPackageKey(handlers, pluginId)
        ? handlers[pluginId as keyof ShippedPluginHandlers]
        : undefined;
      const workerIds = hasPackageKey(workerOperations, pluginId)
        ? workerOperations[pluginId as keyof ShippedPluginWorkerOperations]
        : undefined;
      const worker =
        bound === undefined
          ? definitions.operations.map((definition) => definition.id)
          : workerIds;
      packages.push({
        directory: staged,
        kind: "builtin",
        ...(definitions.nodeTypes.length === 0
          ? {}
          : { nodeTypes: definitions.nodeTypes }),
        ...(definitions.operations.length === 0
          ? {}
          : { operations: definitions.operations }),
        ...(definitions.triggers.length === 0
          ? {}
          : { triggers: definitions.triggers }),
        ...(bound === undefined
          ? {}
          : {
              handlers: bindOperationHandlers(definitions.operations, bound),
            }),
        ...(worker === undefined || worker.length === 0
          ? {}
          : { workerOperations: worker }),
      });
    } catch (error) {
      await rm(staged, { recursive: true, force: true });
      throw error;
    }
  }

  return packages;
}
