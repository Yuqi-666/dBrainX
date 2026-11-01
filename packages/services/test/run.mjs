// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Runs this package's tests through esbuild's bundler.
 *
 * The shared `scripts/run-ui-tests.mjs` only rewrites relative imports inside a
 * package, so a test that imports `@workspace/store` or `@workspace/api-client`
 * at runtime leaves those packages to Node, whose ESM resolver rejects their
 * extensionless imports. A bundle resolves the whole graph once and keeps the
 * package's Node modules reachable.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const packageDir = fileURLToPath(new URL("../", import.meta.url));
const testDir = join(packageDir, "test");

function findTests(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return findTests(path);
    return entry.isFile() && /\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

const entryPoints = findTests(testDir);
if (entryPoints.length === 0) {
  console.log("services-tests: no test files");
  process.exit(0);
}

const outDir = mkdtempSync(join(tmpdir(), "services-tests-"));
try {
  await build({
    entryPoints,
    outdir: outDir,
    outbase: testDir,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    outExtension: { ".js": ".mjs" },
    logLevel: "warning",
  });
  const outputs = entryPoints.map((entry) =>
    join(outDir, entry.slice(testDir.length + 1).replace(/\.tsx?$/, ".mjs")),
  );
  const run = spawnSync(
    process.execPath,
    [
      "--experimental-webstorage",
      `--localstorage-file=${join(outDir, "local-storage.json")}`,
      "--test",
      ...outputs,
    ],
    {
      cwd: packageDir,
      stdio: "inherit",
    },
  );
  process.exitCode = run.status ?? 1;
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
