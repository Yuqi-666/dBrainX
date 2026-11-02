// SPDX-License-Identifier: AGPL-3.0-only

/**
 * `pnpm test:e2e` entry point: run Playwright with this directory's config.
 *
 * pnpm forwards a `--` separator as a literal argument, so the documented
 * `pnpm test:e2e -- --list` reached Playwright as `-- --list` and ran the whole
 * suite instead of listing it. Dropping one leading separator makes both
 * spellings behave the same.
 *
 * Every other argument is handed to Playwright unchanged, so `--list`,
 * `--trace=on`, `--output=<dir>` and a file filter all work.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const cli = createRequire(import.meta.url).resolve("@playwright/test/cli");

const forwarded = process.argv.slice(2);
if (forwarded[0] === "--") forwarded.shift();

const child = spawn(
  process.execPath,
  [cli, "test", "--config", join(here, "playwright.config.ts"), ...forwarded],
  { cwd: repoRoot, stdio: "inherit" },
);
child.on("exit", (code, signal) => {
  process.exit(code ?? (signal === "SIGINT" ? 130 : 1));
});
