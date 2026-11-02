// SPDX-License-Identifier: AGPL-3.0-only

import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  bundleBackend,
  bundlePluginServerEntries,
  bundleWorkerEntry,
} from "../../../scripts/lib/bundle-backend.mjs";
import { prepareModules } from "../../../scripts/lib/runtime-modules.mjs";
import { preparePlugins } from "../../../scripts/lib/plugin-packages.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const output = join(root, "apps/server/dist");
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await prepareModules(root, join(root, "apps/server/.runtime-staging"), output);
// Plugin manifests and server entries ship beside the bundle: the packaged
// server resolves them relative to its own directory.
await preparePlugins(root, output);
// The worker boundary imports its own entry and each plugin's server entry by
// path; both are bundled beside the host because the release ships no
// workspace aliases.
await bundleWorkerEntry(root, join(output, "plugin-worker.mjs"));
await bundlePluginServerEntries(root, output);
await bundleBackend(
  root,
  "apps/server/src/index.ts",
  join(output, "index.mjs"),
);
await writeFile(
  join(output, "package.json"),
  '{"type":"module","private":true}\n',
);
