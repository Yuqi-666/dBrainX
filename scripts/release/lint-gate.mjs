// SPDX-License-Identifier: AGPL-3.0-only

/** Fail on any new diagnostic; keep existing debt explicit instead of hiding errors. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = fileURLToPath(new URL("../../", import.meta.url));
export function diagnosticCounts(results, repoRoot) {
  const counts = {};
  for (const result of results) {
    const file = relative(repoRoot, result.filePath).split("\\").join("/");
    assert.ok(!file.startsWith("../"), "Diagnostic outside workspace");
    for (const message of result.messages) {
      // Fatal parse/config problems cannot be accepted into a baseline.
      assert.ok(
        !message.fatal && message.ruleId,
        `Invalid lint input: ${file}: ${message.message}`,
      );
      const key = JSON.stringify([file, message.ruleId, message.message]);
      counts[key] = (counts[key] ?? 0) + 1;
    }
  }
  return Object.fromEntries(
    Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)),
  );
}
export function newDiagnostics(actual, baseline) {
  return Object.entries(actual).filter(
    ([key, count]) => count > (baseline[key] ?? 0),
  );
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const results = [];
  let packages = 0;
  for (const group of ["apps", "backend", "packages"]) {
    for (const entry of (
      await readdir(join(root, group), { withFileTypes: true })
    ).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory()) continue;
      const dir = join(root, group, entry.name),
        pkgPath = join(dir, "package.json");
      let pkg;
      try {
        pkg = JSON.parse(await readFile(pkgPath));
      } catch (error) {
        if (error.code === "ENOENT") continue;
        throw error;
      }
      if (!pkg.scripts?.lint) continue;
      assert.equal(
        pkg.scripts.lint,
        "eslint",
        `Update lint gate for custom command: ${pkg.name}`,
      );
      const require = createRequire(pkgPath);
      const { ESLint } = await import(
        pathToFileURL(require.resolve("eslint")).href
      );
      const eslint = new ESLint({ cwd: dir });
      results.push(...(await eslint.lintFiles(["."])));
      packages++;
    }
  }
  assert.equal(
    packages,
    19,
    "Workspace lint coverage changed; review the gate",
  );
  const actual = diagnosticCounts(results, root);
  const baselinePath = join(root, "scripts/release/lint-baseline.json");
  if (process.argv.includes("--update-baseline")) {
    await writeFile(
      baselinePath,
      JSON.stringify(
        {
          description:
            "Reviewed historical diagnostics. Changes to this file require review; CI never updates it.",
          counts: actual,
        },
        null,
        2,
      ) + "\n",
    );
  } else {
    const baseline = JSON.parse(await readFile(baselinePath));
    const added = newDiagnostics(actual, baseline.counts);
    for (const [key, count] of added)
      console.error(
        `${key}: ${count} diagnostics (baseline ${baseline.counts[key] ?? 0})`,
      );
    assert.equal(added.length, 0, "New lint diagnostics rejected");
  }
  console.log(
    `Lint gate: ${packages} packages, ${Object.values(actual).reduce((a, b) => a + b, 0)} historical diagnostics, no added debt`,
  );
}
