// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Guards `scripts/release/test-manifest.mjs`, the explicit list the CI gate
 * `pnpm test:release` runs.
 *
 * Two failures matter here. A listed path that no longer exists means the gate
 * is running less than it claims. A test file that exists but is neither listed
 * nor explicitly skippable means it runs nowhere: the old hard-coded list in
 * `package.json` let that happen silently, which is exactly what this file
 * exists to stop.
 */
import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { skippableTests, testFiles } from "../release/test-manifest.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));

/** Top-level directories whose tests the manifest must account for. */
const scanned = ["backend", "plugins", "packages", "apps", "scripts"];

/** Build output and dependency trees never hold source tests. */
const ignoredDirs = new Set([
  "node_modules",
  ".next",
  ".turbo",
  "dist",
  "build",
  "out",
  "coverage",
  "target",
  ".git",
]);

/**
 * `apps/marketing` is a submodule of its own repository with its own checks, so
 * its tests are not this repository's to list.
 */
const ignoredPaths = new Set(["apps/marketing"]);

const testFile = /\.test\.(?:ts|tsx|mjs)$/;

/**
 * Returns the repo-relative paths of every `*.test.ts(x|mjs)` under `dir`.
 * A symlinked directory is skipped, so a workspace link cannot loop the walk.
 */
export function collectTestFiles(dir, found = []) {
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (ignoredPaths.has(path) || ignoredDirs.has(entry.name)) continue;
    if (entry.isDirectory()) {
      collectTestFiles(path, found);
    } else if (entry.isFile() && testFile.test(entry.name)) {
      found.push(path);
    }
  }
  return found;
}

const discovered = scanned.flatMap((dir) => collectTestFiles(dir)).sort();
const listed = new Set(testFiles);
const skipped = new Map(skippableTests.map(({ path, reason }) => [path, reason]));

describe("the CI test manifest", () => {
  it("lists only paths that exist", () => {
    const missing = testFiles.filter((path) => !existsSync(join(root, path)));
    assert.deepEqual(missing, [], `no such test file: ${missing.join(", ")}`);
  });

  it("lists every path once", () => {
    const seen = new Set();
    const duplicates = testFiles.filter((path) => {
      if (seen.has(path)) return true;
      seen.add(path);
      return false;
    });
    assert.deepEqual(duplicates, [], `listed twice: ${duplicates.join(", ")}`);
  });

  it("accounts for every test file under the scanned directories", () => {
    const unlisted = discovered.filter(
      (path) => !listed.has(path) && !skipped.has(path),
    );
    assert.deepEqual(
      unlisted,
      [],
      `test file runs nowhere: add it to scripts/release/test-manifest.mjs ` +
        `(testFiles, or skippableTests with a reason): ${unlisted.join(", ")}`,
    );
  });

  it("keeps the skip list small, existing, and explained", () => {
    const unknown = skippableTests.filter(
      ({ path }) => !discovered.includes(path),
    );
    assert.deepEqual(
      unknown.map(({ path }) => path),
      [],
      "skippableTests names a file that is not a discovered test",
    );
    const covered = skippableTests.filter(({ path }) => listed.has(path));
    assert.deepEqual(
      covered.map(({ path }) => path),
      [],
      "a file cannot be both run by the gate and skipped",
    );
    for (const { path, reason } of skippableTests) {
      assert.equal(typeof reason, "string", `${path} has no reason`);
      assert.ok(reason.trim().length > 0, `${path} has an empty reason`);
      assert.ok(!reason.includes("\n"), `${path} reason must fit one line`);
    }
  });
});
