// SPDX-License-Identifier: AGPL-3.0-only

import test from "node:test";
import assert from "node:assert/strict";
import { validateRun } from "./validate-run.mjs";
test("publication accepts only successful tag or manual candidate runs from the same repository", () => {
  const repository = "Yuqi-666/dBrain";
  const run = {
    id: 123,
    repository: { full_name: repository },
    head_repository: { full_name: repository },
    path: ".github/workflows/release-candidate.yml",
    event: "workflow_dispatch",
    status: "completed",
    conclusion: "success",
    head_sha: "a".repeat(40),
    run_attempt: 1,
  };
  assert.equal(validateRun(run, repository, "123"), run);
  assert.equal(validateRun({ ...run, event: "push" }, repository, "123").event, "push");
  for (const change of [
    { conclusion: "failure" },
    { status: "in_progress" },
    { head_repository: { full_name: "other/fork" } },
    { path: ".github/workflows/ci.yml" },
    { event: "pull_request" },
    { run_attempt: 0 },
    { id: 456 },
  ])
    assert.throws(() => validateRun({ ...run, ...change }, repository, "123"));
});
