// SPDX-License-Identifier: AGPL-3.0-only

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const script = join(here, "container-images.mjs");
const version = JSON.parse(
  await readFile(join(here, "release.json"), "utf8"),
).version;
const commit = "a".repeat(40);
const prefix = "ghcr.io/yuqi-666/dbrainx";
const digest = (letter) => `sha256:${letter.repeat(64)}`;

/** A stand-in for Docker. It records every call and answers the two inspects. */
const dockerStub = `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "$DBRAINX_TEST_LOG"
case "$3" in
  create) exit 0 ;;
  inspect)
    if [[ "$*" == *"--raw"* ]]; then cat "$DBRAINX_TEST_RAW"; else printf 'sha256:%s\\n' "$(printf 'a%.0s' {1..64})"; fi
    ;;
esac
`;

function report(platform, letter) {
  return {
    commit,
    version,
    runId: "7",
    runAttempt: "1",
    platform,
    smokePassed: true,
    images: {
      pocketbase: `${prefix}-pocketbase@${digest("b")}`,
      server: `${prefix}-server@${digest(letter)}`,
      web: `${prefix}-web@${digest("c")}`,
    },
  };
}

/** Builds a temporary root with one report per architecture. */
async function fixture(platforms, arches) {
  const dir = await mkdtemp(join(tmpdir(), "dbrainx-merge-"));
  await mkdir(join(dir, "bin"), { recursive: true });
  await mkdir(join(dir, "incoming"), { recursive: true });
  await mkdir(join(dir, "scripts", "release"), { recursive: true });
  await cp(
    join(root, "scripts", "release", "release.json"),
    join(dir, "scripts", "release", "release.json"),
  );
  await writeFile(join(dir, "bin", "docker"), dockerStub);
  await chmod(join(dir, "bin", "docker"), 0o755);
  const letters = ["d", "e"];
  for (const [index, arch] of arches.entries())
    await writeFile(
      join(dir, "incoming", `${arch}.json`),
      `${JSON.stringify(report(`linux/${arch}`, letters[index]))}\n`,
    );
  await writeFile(
    join(dir, "raw.json"),
    JSON.stringify({
      manifests: platforms.map((platform) => ({
        platform: { os: "linux", architecture: platform.split("/")[1] },
      })),
    }),
  );
  const log = join(dir, "docker.log");
  await writeFile(log, "");
  return {
    merge(list) {
      return execFileSync(process.execPath, [script, "merge", "incoming"], {
        cwd: dir,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          PATH: `${join(dir, "bin")}:${process.env.PATH}`,
          DBRAINX_TEST_LOG: log,
          DBRAINX_TEST_RAW: join(dir, "raw.json"),
          DBRAINX_IMAGE_PREFIX: prefix,
          DBRAINX_CONTAINER_PLATFORMS: list,
          GITHUB_SHA: commit,
          GITHUB_RUN_ID: "7",
          GITHUB_RUN_ATTEMPT: "1",
        },
      });
    },
    async merged() {
      return JSON.parse(
        await readFile(
          join(dir, "release-artifacts", "containers", "container-report.json"),
          "utf8",
        ),
      );
    },
    async calls() {
      return (await readFile(log, "utf8"))
        .split("\n")
        .filter((line) => line !== "");
    },
  };
}

test("a merge reads only the selected platforms", async () => {
  // The reports hold one architecture. A fixed amd64+arm64 pair cannot work.
  const run = await fixture(["linux/arm64"], ["arm64"]);
  run.merge("linux/arm64");
  const merged = await run.merged();
  for (const name of ["pocketbase", "server", "web"]) {
    assert.deepEqual(merged.images[name].platforms, ["linux/arm64"]);
    assert.match(merged.images[name].reference, /@sha256:[a-f0-9]{64}$/);
  }
  assert.equal(merged.version, version);
  assert.equal(merged.commit, commit);
  const creates = (await run.calls()).filter((call) =>
    call.startsWith("buildx imagetools create"),
  );
  assert.equal(creates.length, 3);
  // buildx imagetools create --tag IMAGE SOURCE
  for (const call of creates) assert.equal(call.split(" ").length, 6, call);
});

test("a merge of two platforms keeps both", async () => {
  const run = await fixture(["linux/amd64", "linux/arm64"], ["amd64", "arm64"]);
  run.merge("linux/amd64 linux/arm64");
  const merged = await run.merged();
  for (const name of ["pocketbase", "server", "web"])
    assert.deepEqual(merged.images[name].platforms, [
      "linux/amd64",
      "linux/arm64",
    ]);
});

test("a merge without a platform list is refused", async () => {
  const run = await fixture(["linux/arm64"], ["arm64"]);
  assert.throws(
    () => run.merge(""),
    (error) => String(error.stderr).includes("DBRAINX_CONTAINER_PLATFORMS is empty"),
  );
});
