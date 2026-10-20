// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
export function validateRun(run, repository, runId) {
  assert.equal(String(run.id), runId);
  assert.equal(run.repository.full_name, repository);
  assert.equal(run.head_repository.full_name, repository);
  assert.equal(run.path, ".github/workflows/release-candidate.yml");
  assert.ok(["push", "workflow_dispatch"].includes(run.event));
  assert.equal(run.status, "completed");
  assert.equal(run.conclusion, "success");
  assert.match(run.head_sha, /^[a-f0-9]{40}$/);
  assert.ok(Number.isSafeInteger(run.run_attempt) && run.run_attempt >= 1);
  return run;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const run = validateRun(
    JSON.parse(await readFile(process.argv[2])),
    process.env.GITHUB_REPOSITORY,
    process.env.CANDIDATE_RUN_ID,
  );
  console.log(`Trusted candidate run: ${run.id}, attempt ${run.run_attempt}`);
}
