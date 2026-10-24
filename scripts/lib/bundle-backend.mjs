// SPDX-License-Identifier: AGPL-3.0-only

import { createRequire } from "node:module";
import { join } from "node:path";
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
    external: ["@napi-rs/canvas", "pdfjs-dist", "bufferutil", "utf-8-validate"],
    banner: {
      js: 'import { createRequire as __dbrainxCreateRequire } from "node:module"; const require = __dbrainxCreateRequire(import.meta.url);',
    },
  });
}
