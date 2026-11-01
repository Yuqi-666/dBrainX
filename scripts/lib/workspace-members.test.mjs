// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Guards the plugin workspace wiring. Each expected member must exist, be
 * matched by a positive glob in `pnpm-workspace.yaml`, keep its package name,
 * and declare `scripts.typecheck`: `pnpm -r --if-present run typecheck` skips a
 * package without that script, so a missing script is a silent check hole.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));

const expected = [
  { dir: "backend/plugin-host", name: "@workspace/plugin-host" },
  { dir: "backend/sandbox", name: "@workspace/sandbox" },
  { dir: "packages/plugin-sdk", name: "@workspace/plugin-sdk" },
  { dir: "plugins/builtin", name: "@plugin/builtin" },
  { dir: "plugins/counter", name: "@plugin/counter" },
];

/** Returns the quoted `packages:` entries of `pnpm-workspace.yaml` in order. */
export function workspacePatterns(source) {
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex((line) => /^packages:\s*$/.test(line));
  assert.notEqual(start, -1, "pnpm-workspace.yaml has no packages block");
  const patterns = [];
  for (const line of lines.slice(start + 1)) {
    const match = /^\s+-\s*"([^"]+)"\s*$/.exec(line);
    if (!match) {
      if (/^\S/.test(line)) break;
      continue;
    }
    patterns.push(match[1]);
  }
  return patterns;
}

/** Matches one workspace glob against a repo-relative directory. */
export function globMatches(pattern, dir) {
  const body = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "\u0000")
    .replace(/\*/g, "[^/]+")
    .replace(/\u0000/g, ".*");
  return new RegExp(`^${body}$`).test(dir);
}

const patterns = workspacePatterns(
  readFileSync(join(root, "pnpm-workspace.yaml"), "utf8"),
);

for (const { dir, name } of expected) {
  describe(`${dir} (${name})`, () => {
    it("is matched by a pnpm-workspace.yaml glob", () => {
      const positive = patterns.filter((pattern) => !pattern.startsWith("!"));
      const negative = patterns
        .filter((pattern) => pattern.startsWith("!"))
        .map((pattern) => pattern.slice(1));
      assert.ok(
        positive.some((pattern) => globMatches(pattern, dir)),
        `no positive workspace glob matches ${dir}`,
      );
      assert.ok(
        !negative.some((pattern) => globMatches(pattern, dir)),
        `${dir} is excluded by a workspace glob`,
      );
    });

    it("exists with a package.json of the expected name", () => {
      const manifest = join(root, dir, "package.json");
      assert.ok(existsSync(manifest), `${dir}/package.json is missing`);
      assert.equal(JSON.parse(readFileSync(manifest, "utf8")).name, name);
    });

    it("declares scripts.typecheck", () => {
      const manifest = join(root, dir, "package.json");
      assert.ok(existsSync(manifest), `${dir}/package.json is missing`);
      const { scripts } = JSON.parse(readFileSync(manifest, "utf8"));
      assert.ok(
        typeof scripts?.typecheck === "string" && scripts.typecheck.length > 0,
        `${dir} has no scripts.typecheck, so pnpm -r --if-present skips it`,
      );
    });
  });
}
