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
 */
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { testFiles } from "./test-manifest.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));

console.log(`# test-manifest: ${testFiles.length} files from scripts/release/test-manifest.mjs`);
for (const file of testFiles) {
  console.log(`# test-manifest: ${file}`);
}

for (const file of testFiles) {
  await import(pathToFileURL(join(root, file)).href);
}
