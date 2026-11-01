// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Plugin manifests and packaging, shared by the server build, the desktop
 * runtime preparation, and the plugin UI map generator.
 *
 * `plugins/<directory>/plugin.json` is the manifest of one plugin package. A
 * directory without a manifest is a package that cannot be plugged in yet and
 * is skipped; an invalid manifest fails the build loudly.
 *
 * Fields:
 *
 * - `id` (required): stable identifier, unique in the repository, for example
 *   `"dbrainx.builtin"`. The generated UI map and the plugin host key on it.
 * - `version` (required): manifest version string, for example `"0.1.0"`.
 * - `ui` (required): the browser UI entry. Either a module specifier written
 *   exactly as the bundler resolves it (`"@plugin/builtin/ui"`), or a path
 *   relative to the plugin directory (`"./ui/index.ts"`). A relative path is
 *   turned into `<package name>/<first segment>`, which the `@plugin/*`
 *   workspace alias and the package `exports` resolve; a relative root entry
 *   becomes the bare package name.
 * - `server` (required): path relative to the plugin directory of the server
 *   entry, either the entry file (`"./server/index.ts"`) or its directory
 *   (`"./server"`). A directory ships recursively, so every file a server
 *   entry imports at run time must live inside it or be declared below.
 * - `nodeTypes` (optional): either the array of type ids the manifest declares
 *   (the `PluginManifest` shape in the architecture document) or, in the older
 *   form, the path of the node type definition entry. `nodeTypesEntry` is the
 *   path, file or directory, packed beside the server entry. A manifest may
 *   declare the path as `nodeTypesEntry` (preferred), as `nodeTypes` (legacy),
 *   or both with the same value; a list of ids under `nodeTypes` never names a
 *   path and does not conflict with `nodeTypesEntry`.
 *
 * `uiEntry` and `serverEntry` are accepted aliases: the architecture document
 * names the fields that way. Declaring both a field and its alias is an error,
 * so one manifest cannot mean two things.
 *
 * Paths are resolved inside the plugin directory and must stay there, must
 * exist, and must not be absolute. A link that resolves outside the plugin
 * directory is rejected, and copied entries are dereferenced, so no link is
 * shipped. Any violation throws: a partial plugin in a release is worse than a
 * failed build.
 */
import { existsSync } from "node:fs";
import {
  cp,
  copyFile,
  mkdir,
  readdir,
  readFile,
  realpath,
  stat,
} from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";

export const manifestName = "plugin.json";

function field(manifest, name, file) {
  const alias = `${name}Entry`;
  const hasField = manifest[name] !== undefined;
  const hasAlias = manifest[alias] !== undefined;
  if (hasField && hasAlias && manifest[name] !== manifest[alias])
    throw new Error(
      `${file}: "${name}" and its alias "${alias}" disagree; declare one`,
    );
  const value = hasField ? manifest[name] : manifest[alias];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim() === "")
    throw new Error(`${file}: "${name}" must be a non-empty string`);
  return value;
}

async function packageName(pluginDirectory) {
  const path = join(pluginDirectory, "package.json");
  if (existsSync(path)) {
    const pkg = JSON.parse(await readFile(path, "utf8"));
    if (typeof pkg.name === "string" && pkg.name.trim() !== "") return pkg.name;
  }
  return `@plugin/${basename(pluginDirectory)}`;
}

function nonEmptyString(value, name, file) {
  if (typeof value !== "string" || value.trim() === "")
    throw new Error(`${file}: "${name}" must be a non-empty string`);
  return value;
}

/** Resolve one declared plugin path and prove it stays inside the plugin. */
async function declaredPath(pluginDirectory, name, declared, file) {
  if (declared.startsWith("/") || /^[A-Za-z]:[\\/]/.test(declared))
    throw new Error(
      `${file}: "${name}" must be relative to the plugin directory`,
    );
  const path = resolve(pluginDirectory, declared);
  if (path !== pluginDirectory && !path.startsWith(pluginDirectory + sep))
    throw new Error(
      `${file}: "${name}" must stay inside the plugin directory: ${declared}`,
    );
  const target = await realpath(path).catch(() => undefined);
  if (!target)
    throw new Error(`${file}: "${name}" points at a missing path: ${declared}`);
  // `stat` follows symlinks, so prove the real target is inside as well: a
  // plugin-relative link may point at any file on the build host.
  const inside = await realpath(pluginDirectory);
  if (target !== inside && !target.startsWith(inside + sep))
    throw new Error(
      `${file}: "${name}" resolves outside the plugin directory through a link: ${declared}`,
    );
  const info = await stat(target);
  return { declared, path: target, directory: info.isDirectory() };
}

/** The module specifier the generated UI map imports for one plugin. */
async function uiSpecifier(pluginDirectory, name, declared, file) {
  const absolute = declared.startsWith("/") || /^[A-Za-z]:[\\/]/.test(declared);
  if (!absolute && !/^[.\\/]/.test(declared)) return declared;
  if (absolute)
    throw new Error(
      `${file}: "${name}" must be a module specifier or a relative path`,
    );
  const { directory } = await declaredPath(pluginDirectory, name, declared, file);
  const segments = declared
    .replace(/^\.\//, "")
    .split(/[\\/]/)
    .filter(Boolean);
  const owner = await packageName(pluginDirectory);
  return segments.length > 1 || directory ? `${owner}/${segments[0]}` : owner;
}

/**
 * Read every `plugins/<directory>/plugin.json` below `root`, sorted by `id`.
 *
 * @returns {Promise<Array<{directory: string, directoryPath: string,
 *   id: string, version: string, ui: string, server: string,
 *   serverPath: string, nodeTypes: string | undefined,
 *   nodeTypesPath: string | undefined, nodeTypeIds: string[] | undefined}>>}
 */
export async function readPluginManifests(root) {
  const pluginsRoot = join(root, "plugins");
  const entries = await readdir(pluginsRoot, { withFileTypes: true }).catch(
    (error) => {
      if (error.code === "ENOENT") return [];
      throw error;
    },
  );
  const plugins = [];
  const ids = new Map();
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    const directoryPath = join(pluginsRoot, entry.name);
    const manifestPath = join(directoryPath, manifestName);
    if (!existsSync(manifestPath)) continue;
    const file = `plugins/${entry.name}/${manifestName}`;
    let manifest;
    try {
      manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    } catch (error) {
      throw new Error(`${file}: invalid JSON (${error.message})`);
    }
    if (typeof manifest !== "object" || manifest === null || Array.isArray(manifest))
      throw new Error(`${file}: the manifest must be a JSON object`);
    const id = field(manifest, "id", file);
    if (id === undefined) throw new Error(`${file}: "id" is required`);
    if (ids.has(id))
      throw new Error(
        `${file}: duplicate plugin id "${id}", already used by ${ids.get(id)}`,
      );
    ids.set(id, file);
    const version = field(manifest, "version", file);
    if (version === undefined) throw new Error(`${file}: "version" is required`);
    const declaredUi = field(manifest, "ui", file);
    if (declaredUi === undefined)
      throw new Error(`${file}: "ui" is required`);
    const declaredServer = field(manifest, "server", file);
    if (declaredServer === undefined)
      throw new Error(`${file}: "server" is required`);
    const server = await declaredPath(
      directoryPath,
      "server",
      declaredServer,
      file,
    );
    const nodeTypesValue = manifest.nodeTypes;
    if (
      nodeTypesValue !== undefined &&
      typeof nodeTypesValue !== "string" &&
      !Array.isArray(nodeTypesValue)
    )
      throw new Error(
        `${file}: "nodeTypes" must be an array of type ids or a path`,
      );
    const nodeTypeIds = Array.isArray(nodeTypesValue)
      ? nodeTypesValue.map((id, index) => {
          if (typeof id !== "string" || id.trim() === "")
            throw new Error(
              `${file}: "nodeTypes[${index}]" must be a non-empty string`,
            );
          return id;
        })
      : undefined;
    const declaredNodeTypesEntry =
      manifest.nodeTypesEntry === undefined
        ? undefined
        : nonEmptyString(manifest.nodeTypesEntry, "nodeTypesEntry", file);
    const legacyNodeTypesPath =
      typeof nodeTypesValue === "string"
        ? nonEmptyString(nodeTypesValue, "nodeTypes", file)
        : undefined;
    if (
      declaredNodeTypesEntry !== undefined &&
      legacyNodeTypesPath !== undefined &&
      declaredNodeTypesEntry !== legacyNodeTypesPath
    )
      throw new Error(
        `${file}: "nodeTypes" and its alias "nodeTypesEntry" disagree; declare one`,
      );
    const declaredNodeTypesPath =
      declaredNodeTypesEntry ?? legacyNodeTypesPath;
    const nodeTypes =
      declaredNodeTypesPath === undefined
        ? undefined
        : await declaredPath(
            directoryPath,
            declaredNodeTypesEntry === undefined
              ? "nodeTypes"
              : "nodeTypesEntry",
            declaredNodeTypesPath,
            file,
          );
    plugins.push({
      directory: entry.name,
      directoryPath,
      id,
      version,
      ui: await uiSpecifier(directoryPath, "ui", declaredUi, file),
      server: declaredServer,
      serverPath: server.path,
      nodeTypes: declaredNodeTypesPath,
      nodeTypesPath: nodeTypes?.path,
      nodeTypeIds,
    });
  }
  return plugins.sort((a, b) => a.id.localeCompare(b.id));
}

/** The generated `apps/web/lib/plugin-ui.generated.ts` source text. */
export function renderPluginUiModule(plugins) {
  const lines = [
    "// SPDX-License-Identifier: AGPL-3.0-only",
    "// DO NOT EDIT. Generated by `node scripts/generate-plugin-ui.mjs` from every",
    "// `plugins/*/plugin.json` manifest. Rerun that command after editing one;",
    "// `node scripts/generate-plugin-ui.mjs --check` is the gate that fails on drift.",
    "//",
    "// Each descriptor names a plugin and the browser UI module a registry",
    "// bootstrap imports lazily. `packages/ui` never imports `plugins/*`.",
    "",
    "export interface PluginUiDescriptor {",
    "  readonly pluginId: string;",
    "  readonly entry: string;",
    "}",
    "",
  ];
  const declaration =
    "export const pluginUiDescriptors: readonly PluginUiDescriptor[] = ";
  if (plugins.length === 0) {
    lines.push(`${declaration}[];`, "");
    return lines.join("\n");
  }
  lines.push(`${declaration}[`);
  for (const plugin of plugins)
    lines.push(
      `  { pluginId: ${JSON.stringify(plugin.id)}, entry: ${JSON.stringify(plugin.ui)} },`,
    );
  lines.push("];", "");
  return lines.join("\n");
}

async function copyEntry(source, declared, destination) {
  const target = resolve(destination, declared);
  await mkdir(dirname(target), { recursive: true });
  const info = await stat(source);
  if (info.isDirectory())
    await cp(source, target, { recursive: true, dereference: true });
  else await copyFile(source, target);
}

/**
 * Copy every plugin manifest and its declared server/node type entry into
 * `destination/plugins/<directory>`, preserving the manifest-relative layout so
 * the plugin host resolves declared paths inside the packaged tree. A plugin's
 * `types/` directory (§4.10.2) ships as well: the node type entry imports its
 * content schemas from there, so omitting it would package an entry whose
 * relative imports cannot resolve.
 */
export async function preparePlugins(root, destination) {
  const plugins = await readPluginManifests(root);
  for (const plugin of plugins) {
    const target = join(destination, "plugins", plugin.directory);
    await mkdir(target, { recursive: true });
    await copyFile(
      join(plugin.directoryPath, manifestName),
      join(target, manifestName),
    );
    await copyEntry(plugin.serverPath, plugin.server, target);
    if (plugin.nodeTypesPath !== undefined)
      await copyEntry(plugin.nodeTypesPath, plugin.nodeTypes, target);
    const typesDirectory = join(plugin.directoryPath, "types");
    if (existsSync(typesDirectory))
      await cp(typesDirectory, join(target, "types"), {
        recursive: true,
        dereference: true,
      });
  }
  return plugins;
}
