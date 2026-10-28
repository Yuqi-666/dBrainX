// SPDX-License-Identifier: AGPL-3.0-only

import { createRequire } from "node:module";
import { cp, mkdir, readFile, realpath } from "node:fs/promises";
import { dirname, join } from "node:path";

/** Copy the three external runtime packages directly from the frozen install.
 * Everything else is bundled by esbuild. Never ship workspace symlinks or
 * another architecture's optional native addon. */
export async function prepareModules(root, _staging, destination) {
  const require = createRequire(
    join(root, "backend/infrastructure/package.json"),
  );
  const libc =
    process.platform === "linux"
      ? process.report.getReport().header.glibcVersionRuntime
        ? "-gnu"
        : "-musl"
      : "";
  const native = `@napi-rs/canvas-${process.platform}-${process.arch}${process.platform === "win32" ? "-msvc" : libc}`;
  const canvasRequire = createRequire(
    require.resolve("@napi-rs/canvas/package.json"),
  );
  const versions = {};
  for (const name of ["pdfjs-dist", "@napi-rs/canvas", native]) {
    const source = dirname(
      await realpath(
        (name === native ? canvasRequire : require).resolve(
          `${name}/package.json`,
        ),
      ),
    );
    const target = join(destination, "node_modules", name);
    await mkdir(dirname(target), { recursive: true });
    await cp(source, target, { recursive: true, dereference: true });
    versions[name] = JSON.parse(
      await readFile(join(source, "package.json")),
    ).version;
  }
  // Loading the shipped native binding catches missing/wrong-platform binaries early.
  const shipped = createRequire(join(destination, "package.json"));
  shipped("@napi-rs/canvas").createCanvas(2, 2);
  return versions;
}
