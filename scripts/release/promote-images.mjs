// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";

const [reportPath, tag] = process.argv.slice(2);
assert.match(tag ?? "", /^v[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$/);
const report = JSON.parse(await readFile(reportPath, "utf8"));
assert.equal(tag, `v${report.version}`);
assert.equal(report.commit, process.env.DBRAIN_CANDIDATE_SHA);
assert.equal(report.runId, process.env.DBRAIN_CANDIDATE_RUN_ID);
assert.equal(report.runAttempt, process.env.DBRAIN_CANDIDATE_RUN_ATTEMPT);
for (const service of ["pocketbase", "server", "web"]) {
  const source = report.images[service]?.reference;
  assert.match(source ?? "", /^ghcr\.io\/[a-z0-9_.-]+\/[a-z0-9_.-]+@sha256:[a-f0-9]{64}$/);
  assert.ok(source.split("@")[0].endsWith(`-${service}`));
  const destination = `${source.split("@")[0]}:${tag}`;
  try {
    const existing = execFileSync("docker", ["buildx", "imagetools", "inspect", destination, "--format", "{{.Manifest.Digest}}"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    assert.equal(existing, source.split("@")[1], `Release image tag already points elsewhere: ${destination}`);
    console.log(`[release] ${destination} already matches the accepted digest`);
    continue;
  } catch (error) {
    if (error.code !== "ENOENT" && error.name === "AssertionError") throw error;
    if (error.status !== 1 && error.code !== "ENOENT") throw error;
  }
  execFileSync("docker", ["buildx", "imagetools", "create", "--tag", destination, source], { stdio: "inherit" });
  console.log(`[release] ${destination} -> ${source}`);
}
