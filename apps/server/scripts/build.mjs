// SPDX-License-Identifier: AGPL-3.0-only

import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bundleBackend } from "../../../scripts/lib/bundle-backend.mjs";
import { prepareModules } from "../../../scripts/lib/runtime-modules.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const output = join(root, "apps/server/dist");
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await prepareModules(root, join(root, "apps/server/.runtime-staging"), output);
await bundleBackend(
  root,
  "apps/server/src/index.ts",
  join(output, "index.mjs"),
);
await writeFile(
  join(output, "package.json"),
  '{"type":"module","private":true}\n',
);
