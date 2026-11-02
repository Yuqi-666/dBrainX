// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Runs the CI test gate from `scripts/release/test-manifest.mjs`.
 *
 * Node has no "read the file list from a file" flag, so this module is the test
 * entry point: `pnpm test:release` starts it with `--test`, and it imports every
 * manifest entry. The imports register their tests in the same process
 * (`--test-isolation=none`), so the run reports and fails exactly as if every
 * path had been passed on the command line.
 *
 * The list is printed before importing so a failing gate names what it tried to
 * run, and so a reviewer can see that the manifest — not `package.json` — is
 * what drove the run.
 *
 * Two properties keep the gate honest:
 *
 * - A bare `@workspace/*` or `@plugin/*` import resolves to the package source
 *   even from a package whose `node_modules` has no link for it. `pnpm` only
 *   links declared dependencies, so a test that imports a workspace package its
 *   own `package.json` does not declare (as the server registry test does
 *   through the application layer) would otherwise fail to load here while it
 *   compiles and bundles elsewhere.
 * - An import that throws is reported as a failing test. `node --test` discards
 *   a rejected dynamic import in this entry module and still exits 0, so without
 *   this an unreadable manifest entry would silently drop that file and every
 *   file after it from the gate.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { registerHooks } from "node:module";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { testFiles } from "./test-manifest.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));

/** The source file a workspace package export points at, if it exists. */
function workspaceSource(specifier) {
  const match = /^(@(?:workspace|plugin)\/([^/]+))(?:\/(.+))?$/.exec(specifier);
  if (match === null) return undefined;
  const [, name, short, subpath] = match;
  const directory = join(
    root,
    name.startsWith("@workspace/") ? "packages" : "plugins",
    short,
  );
  const manifestPath = join(directory, "package.json");
  if (!existsSync(manifestPath)) return undefined;
  const exports = JSON.parse(readFileSync(manifestPath, "utf8")).exports;
  const entry = exports?.[subpath === undefined ? "." : `./${subpath}`];
  const target =
    typeof entry === "string" ? entry : (entry?.import ?? entry?.default);
  if (typeof target !== "string") return undefined;
  const resolved = join(directory, target);
  const candidates = [
    resolved,
    `${resolved}.ts`,
    `${resolved}.mjs`,
    join(resolved, "index.ts"),
  ];
  return candidates.find((path) => existsSync(path) && statSync(path).isFile());
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      const source =
        error?.code === "ERR_MODULE_NOT_FOUND"
          ? workspaceSource(specifier)
          : undefined;
      if (source === undefined) throw error;
      return { url: pathToFileURL(source).href, shortCircuit: true };
    }
  },
});

console.log(
  `# test-manifest: ${testFiles.length} files from scripts/release/test-manifest.mjs`,
);
for (const file of testFiles) {
  console.log(`# test-manifest: ${file}`);
}

const failures = [];
for (const file of testFiles) {
  try {
    await import(pathToFileURL(join(root, file)).href);
  } catch (error) {
    failures.push({ file, error });
  }
}

if (failures.length > 0) {
  const detail = failures
    .map(({ file, error }) => `${file}: ${error?.stack ?? String(error)}`)
    .join("\n\n");
  test("every manifest entry imports", () => {
    throw new Error(
      `${failures.length} manifest entries failed to import:\n\n${detail}`,
    );
  });
  process.exitCode = 1;
}
