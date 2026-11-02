// SPDX-License-Identifier: AGPL-3.0-only

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { manifestName, readPluginManifests } from "./plugin-packages.mjs";
const require = createRequire(
  new URL("../../apps/server/package.json", import.meta.url),
);
const { build } = require("esbuild");
export async function bundleBackend(root, entry, output) {
  await build({
    entryPoints: [join(root, entry)],
    outfile: output,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    tsconfig: join(root, "apps/server/tsconfig.json"),
    // MXC resolves its FFI library and helper executables from bin/<arch> under
    // its own package root, so it must stay a real package at run time.
    external: [
      "@microsoft/mxc-sdk",
      "@napi-rs/canvas",
      "pdfjs-dist",
      "bufferutil",
      "utf-8-validate",
    ],
    banner: {
      js: 'import { createRequire as __dbrainxCreateRequire } from "node:module"; const require = __dbrainxCreateRequire(import.meta.url);',
    },
  });
}

/**
 * Bundle one self-contained ESM module (no MXC or canvas externalisation).
 *
 * The worker entry and each plugin's server entry run in a `worker_threads`
 * worker, which cannot import the host's bundle or this repository's workspace
 * aliases: they get their own file beside the host bundle.
 */
export async function bundleModule(root, entry, output) {
  await mkdir(dirname(output), { recursive: true });
  await build({
    entryPoints: [entry],
    outfile: output,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    tsconfig: join(root, "apps/server/tsconfig.json"),
  });
}

/** The `plugin-worker.mjs` the sandbox's default entry resolution finds. */
export async function bundleWorkerEntry(root, output) {
  await bundleModule(
    root,
    join(root, "backend/plugin-host/src/worker-entry.ts"),
    output,
  );
}

/**
 * Make each packaged plugin's `serverEntry` a self-contained module.
 *
 * `preparePlugins` copies the plugin directory verbatim, which leaves the
 * entry importing workspace aliases the release does not ship. The worker
 * imports this file by path, so it is bundled here and the copied manifest is
 * repointed at it. The runtime re-stamps the manifest checksum after staging,
 * exactly as it does for a source package.
 */
export async function bundlePluginServerEntries(root, destination) {
  for (const plugin of await readPluginManifests(root)) {
    const pluginDirectory = join(destination, "plugins", plugin.directory);
    const entry = join(pluginDirectory, "server", "index.mjs");
    await bundleModule(root, plugin.serverPath, entry);
    const manifestPath = join(pluginDirectory, manifestName);
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    delete manifest.checksum;
    delete manifest.signature;
    delete manifest.publicKeyId;
    manifest.server = "./server/index.mjs";
    manifest.serverEntry = "./server/index.mjs";
    await writeFile(
      manifestPath,
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    );
  }
}
