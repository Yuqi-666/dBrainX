// SPDX-License-Identifier: AGPL-3.0-only

/** Build/run candidates in the workflow first; publish exactly those local images. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { archsOf, splitNames } from "./platforms.mjs";
const docker = (...args) =>
  execFileSync("docker", args, {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    stdio: ["ignore", "pipe", "inherit"],
  }).trim();
const release = JSON.parse(await readFile("scripts/release/release.json"));
const prefix = process.env.DBRAIN_IMAGE_PREFIX;
assert.match(prefix ?? "", /^ghcr\.io\/[a-z0-9_.-]+\/[a-z0-9_.-]+$/);
const commit = process.env.GITHUB_SHA;
assert.match(commit ?? "", /^[a-f0-9]{40}$/);
const runId = process.env.GITHUB_RUN_ID,
  runAttempt = process.env.GITHUB_RUN_ATTEMPT;
assert.match(runId ?? "", /^\d+$/);
assert.match(runAttempt ?? "", /^\d+$/);
const tag = `candidate-${runId}-${runAttempt}`;
const services = ["pocketbase", "server", "web"];
await mkdir("release-artifacts/containers", { recursive: true });
if (process.argv[2] === "push") {
  const arch = process.env.DBRAIN_CONTAINER_ARCH;
  assert.ok(["amd64", "arm64"].includes(arch));
  assert.equal(process.env.DBRAIN_VERSION, `${tag}-${arch}`);
  const images = {};
  for (const service of services) {
    const image = `${prefix}-${service}:${tag}-${arch}`;
    const revision = docker(
      "inspect",
      "--format",
      '{{index .Config.Labels "org.opencontainers.image.revision"}}',
      image,
    );
    assert.equal(revision, commit, "Local image revision mismatch");
    docker("push", image);
    const digests = JSON.parse(
      docker("inspect", "--format", "{{json .RepoDigests}}", image),
    );
    const digest = digests.find((value) =>
      value.startsWith(`${prefix}-${service}@sha256:`),
    );
    assert.ok(digest, `Missing pushed digest: ${service}`);
    images[service] = digest;
  }
  await writeFile(
    `release-artifacts/containers/${arch}.json`,
    JSON.stringify(
      {
        commit,
        version: release.version,
        runId,
        runAttempt,
        platform: `linux/${arch}`,
        smokePassed: true,
        images,
      },
      null,
      2,
    ) + "\n",
  );
} else if (process.argv[2] === "merge") {
  // A release may build a part of the declared list. The platforms of this
  // candidate therefore come from the start, not from a constant.
  const platforms = splitNames(process.env.DBRAIN_CONTAINER_PLATFORMS);
  assert.ok(platforms.length > 0, "DBRAIN_CONTAINER_PLATFORMS is empty.");
  const archs = archsOf(platforms);
  const reports = await Promise.all(
    archs.map(async (arch) =>
      JSON.parse(await readFile(join(process.argv[3], `${arch}.json`))),
    ),
  );
  for (const [i, report] of reports.entries()) {
    for (const [key, value] of Object.entries({
      commit,
      version: release.version,
      runId,
      runAttempt,
      platform: platforms[i],
      smokePassed: true,
    }))
      assert.equal(report[key], value);
  }
  const images = {};
  for (const service of services) {
    const image = `${prefix}-${service}:${tag}`;
    const sources = reports.map((report) => report.images[service]);
    for (const source of sources) {
      assert.ok(source.startsWith(`${prefix}-${service}@`));
      assert.match(source.split("@")[1], /^sha256:[a-f0-9]{64}$/);
    }
    docker("buildx", "imagetools", "create", "--tag", image, ...sources);
    const raw = JSON.parse(
      docker("buildx", "imagetools", "inspect", image, "--raw"),
    );
    assert.deepEqual(
      raw.manifests
        .map((m) => `${m.platform.os}/${m.platform.architecture}`)
        .sort(),
      [...platforms].sort(),
    );
    const digest = docker(
      "buildx",
      "imagetools",
      "inspect",
      image,
      "--format",
      "{{.Manifest.Digest}}",
    );
    assert.match(digest, /^sha256:[a-f0-9]{64}$/);
    images[service] = {
      reference: `${prefix}-${service}@${digest}`,
      platforms,
      smokePassed: true,
    };
  }
  await writeFile(
    "release-artifacts/containers/container-report.json",
    JSON.stringify(
      { version: release.version, commit, runId, runAttempt, images },
      null,
      2,
    ) + "\n",
  );
} else
  throw new Error(
    "Usage: container-images.mjs push | merge <reports directory>",
  );
