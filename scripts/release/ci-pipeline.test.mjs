// SPDX-License-Identifier: AGPL-3.0-only

// The `checks` job is the only check pipeline of the repository. This test
// keeps its three places in step: the workflow steps, the root scripts, and
// the two manuals. A duplicate list drifted from CI once and blocked a
// release, so the pipeline now has a guard instead of a second copy.
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { requiredCheck } from "../policy/apply-ruleset.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (file) => readFile(resolve(root, file), "utf8");

// `pnpm install`, `pnpm exec`, and friends are commands, not root scripts.
const pnpmCommands = new Set([
  "add",
  "create",
  "dlx",
  "exec",
  "install",
  "remove",
  "run",
  "why",
]);

function runSteps(workflow) {
  return workflow
    .split("\n")
    .map((line) => /^\s*- run:\s*(.+)$/.exec(line)?.[1] ?? null)
    .filter(Boolean);
}

function rootScripts(steps) {
  const names = new Set();
  for (const step of steps) {
    for (const match of step.matchAll(/\bpnpm (?:run )?([a-z][a-z0-9:_-]*)/g)) {
      if (!pnpmCommands.has(match[1])) names.add(match[1]);
    }
  }
  return [...names].sort();
}

test("every pnpm step of the checks job names a root script", async () => {
  const used = rootScripts(runSteps(await read(".github/workflows/ci.yml")));
  const scripts = Object.keys(JSON.parse(await read("package.json")).scripts);
  assert.ok(used.length > 0, "the checks job runs no pnpm script");
  for (const name of used) {
    assert.ok(scripts.includes(name), `package.json has no script named "${name}"`);
  }
});

test("the job that runs the checks is the required status context", async () => {
  const workflow = await read(".github/workflows/ci.yml");
  assert.match(workflow, new RegExp(`^  ${requiredCheck}:$`, "m"));
  assert.match(workflow, new RegExp(`^    name: ${requiredCheck}$`, "m"));
});

test("both manuals list every command the checks job runs", async () => {
  const used = rootScripts(runSteps(await read(".github/workflows/ci.yml")));
  for (const file of ["docs/ci-cd.md", "docs/zh/ci-cd.md"]) {
    const text = await read(file);
    for (const name of used) {
      assert.ok(text.includes(`pnpm ${name}`), `${file} does not mention "pnpm ${name}"`);
    }
  }
});
