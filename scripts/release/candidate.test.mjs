// SPDX-License-Identifier: AGPL-3.0-only

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, writeFile, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import {
  candidateTargets,
  prepareReleaseAssets,
  verifyPublishableCandidate,
  assembleCandidate,
  services,
} from "./candidate.mjs";
import { hashFile } from "../lib/runtime-manifest.mjs";
const execFileAsync = promisify(execFile);
const expected = {
  version: "0.1.0",
  commit: "a".repeat(40),
  runId: "123",
  runAttempt: "1",
  repository: "Yuqi-666/dBrainX",
  imagePrefix: "ghcr.io/yuqi-666/dbrainx",
  desktopTargets: ["linux-x64", "win32-x64", "darwin-x64", "darwin-arm64"],
  containerPlatforms: ["linux/amd64", "linux/arm64"],
};

test('an explicit none selection keeps skipped desktop targets out of a candidate', () => {
  assert.deepEqual(candidateTargets('none', expected.desktopTargets, 'desktop target'), []);
  assert.deepEqual(candidateTargets('linux-x64', expected.desktopTargets, 'desktop target'), ['linux-x64']);
});
async function fixture(signed = true, plan = expected) {
  const dir = await mkdtemp(join(tmpdir(), "dbrainx-candidate-test-"));
  const incoming = join(dir, "incoming"),
    output = join(dir, "candidate");
  await mkdir(incoming);
  for (const target of plan.desktopTargets) {
    const path = join(incoming, target);
    await mkdir(path);
    const [platform, arch] = target.split("-");
    const extensions =
      platform === "linux"
        ? ["deb", "rpm", "AppImage"]
        : platform === "win32"
          ? ["exe", "msi"]
          : ["dmg"];
    const installers = extensions.map((ext) => `${target}-dBrainX.${ext}`);
    const updater = signed ? {
      asset: platform === "darwin" ? `${target}-dBrainX.app.tar.gz` : platform === "linux" ? `${target}-dBrainX.AppImage` : `${target}-dBrainX-setup.exe`,
      signature: platform === "darwin" ? `${target}-dBrainX.app.tar.gz.sig` : platform === "linux" ? `${target}-dBrainX.AppImage.sig` : `${target}-dBrainX-setup.exe.sig`,
    } : null;
    if (signed && platform === "win32") installers[0] = updater.asset;
    const files = Object.fromEntries(
      installers.map((name) => [name, "installer bytes"]),
    );
    if (signed) {
      if (platform === "darwin") files[updater.asset] = "updater bytes";
      files[updater.signature] = "signed updater artifact contents";
    }
    files["runtime-manifest.json"] = JSON.stringify({
      platform,
      arch,
      version: plan.version,
      commit: plan.commit,
    });
    files["build-report.json"] = JSON.stringify({
      ...plan,
      target,
      signed,
      signingVerified: signed,
      distributionReady: false,
      installers,
      updater,
    });
    files.LICENSE = "GNU AFFERO GENERAL PUBLIC LICENSE\nVersion 3, 19 November 2007";
    const sums = [];
    for (const [name, data] of Object.entries(files)) {
      await writeFile(join(path, name), data);
      sums.push(`${await hashFile(join(path, name))}  ${name}`);
    }
    await writeFile(join(path, "SHA256SUMS"), sums.join("\n") + "\n");
  }
  if (plan.containerPlatforms.length) {
    await mkdir(join(incoming, "containers"));
    await writeFile(
    join(incoming, "containers/container-report.json"),
    JSON.stringify({
      ...plan,
      images: Object.fromEntries(
        services.map((service) => [
          service,
          {
            reference: `${plan.imagePrefix}-${service}@sha256:${"b".repeat(64)}`,
            platforms: plan.containerPlatforms,
            smokePassed: true,
          },
        ]),
      ),
    }),
    );
  }
  return { dir, incoming, output };
}
test("signed candidate can publish without an acceptance record", async () => {
  const f = await fixture();
  try {
    await assembleCandidate(f.incoming, f.output, expected);
    assert.equal((await verifyPublishableCandidate(f.output, expected)).commit, expected.commit);
    assert.ok(!(await readdir(f.output)).includes("acceptance-template.json"));
    await writeFile(join(f.output, "acceptance-template.json"), "legacy template");
    assert.equal((await verifyPublishableCandidate(f.output, expected)).commit, expected.commit);
  } finally {
    await rm(f.dir, { recursive: true, force: true });
  }
});
test("modified installers, missing targets, different commits and run attempts fail closed", async () => {
  const f = await fixture();
  try {
    await assert.rejects(
      assembleCandidate(f.incoming, f.output, {
        ...expected,
        commit: "d".repeat(40),
      }),
      /commit mismatch/,
    );
    await assert.rejects(
      assembleCandidate(f.incoming, f.output, { ...expected, runAttempt: "2" }),
      /runAttempt mismatch/,
    );
    await assembleCandidate(f.incoming, f.output, expected);
    await writeFile(
      join(f.output, "linux-x64/linux-x64-dBrainX.deb"),
      "modified",
    );
    await assert.rejects(
      verifyPublishableCandidate(f.output, expected),
      /files modified/,
    );
    await rm(join(f.incoming, "darwin-arm64"), { recursive: true });
    await assert.rejects(
      assembleCandidate(f.incoming, f.output, expected),
      /missing desktop target/,
    );
  } finally {
    await rm(f.dir, { recursive: true, force: true });
  }
});
test("unsigned candidates may be assembled but cannot be published", async () => {
  const f = await fixture(false);
  try {
    await assembleCandidate(f.incoming, f.output, expected);
    await assert.rejects(
      verifyPublishableCandidate(f.output, expected),
      /unsigned/,
    );
  } finally {
    await rm(f.dir, { recursive: true, force: true });
  }
});

test("a subset candidate carries only the selected platforms", async () => {
  const subset = {
    ...expected,
    desktopTargets: ["linux-x64"],
    containerPlatforms: ["linux/arm64"],
  };
  const f = await fixture(true, subset);
  try {
    const index = await assembleCandidate(f.incoming, f.output, subset);
    assert.deepEqual(index.desktopTargets, ["linux-x64"]);
    assert.deepEqual(index.containerPlatforms, ["linux/arm64"]);
    await verifyPublishableCandidate(f.output, subset);
  } finally {
    await rm(f.dir, { recursive: true, force: true });
  }
});

test("single product families assemble and publish without the other family", async () => {
  for (const plan of [
    { ...expected, desktopTargets: [] },
    { ...expected, containerPlatforms: [] },
  ]) {
    const f = await fixture(true, plan);
    try {
      await assembleCandidate(f.incoming, f.output, plan);
      const assets = join(f.dir, "assets");
      await prepareReleaseAssets(f.output, assets, plan);
      const names = await readdir(assets);
      assert.equal(names.includes("latest.json"), plan.desktopTargets.length > 0);
      assert.equal(names.includes(`dbrainx-deploy-v${plan.version}.tar.gz`), plan.containerPlatforms.length > 0);
    } finally {
      await rm(f.dir, { recursive: true, force: true });
    }
  }
});

test("published assets preserve hashes and deploy verified digests without stale files", async () => {
  const f = await fixture();
  try {
    await assembleCandidate(f.incoming, f.output, expected);
    const assets = join(f.dir, "assets");
    await prepareReleaseAssets(f.output, assets, expected);
    const sums = (await readFile(join(assets, "SHA256SUMS"), "utf8"))
      .trim()
      .split("\n");
    assert.ok(sums.some((line) => line.endsWith("  candidate-index.json")));
    for (const line of sums) {
      const [hash, name] = line.split("  ");
      assert.equal(await hashFile(join(assets, name)), hash);
    }
    const deployment = join(f.dir, "deployment");
    await mkdir(deployment);
    await execFileAsync("tar", ["-xzf", join(assets, `dbrainx-deploy-v${expected.version}.tar.gz`), "-C", deployment]);
    assert.deepEqual((await readdir(deployment)).sort(), [
      ".env.example", "compose.release.yml", "compose.updater.yml", "container-report.json", "deploy", "docker-compose.yml", "nginx.conf", "update.sh",
    ]);
    assert.match(await readFile(join(deployment, "compose.release.yml"), "utf8"), /pocketbase@sha256:[b]+/);
    assert.match(await readFile(join(deployment, "deploy/updater/watch.sh"), "utf8"), /DBRAINX_AUTO_UPDATE/);
    const latest = JSON.parse(await readFile(join(assets, "latest.json"), "utf8"));
    assert.equal(latest.version, expected.version);
    assert.equal(Object.keys(latest.platforms).length, expected.desktopTargets.length);
    assert.ok(
      !(await readFile(join(deployment, "docker-compose.yml"), "utf8")).includes(
        "./deploy/nginx.conf",
      ),
    );
    assert.ok(!(await readdir(assets)).includes("build-report.json"));
    await assert.rejects(
      prepareReleaseAssets(f.output, assets, expected),
      /EEXIST/,
    );
  } finally {
    await rm(f.dir, { recursive: true, force: true });
  }
});
