// SPDX-License-Identifier: AGPL-3.0-only

/** Verify the actual DEB and AppImage runtimes outside the checkout. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { binaryArchitecture, hashFile } from "../lib/runtime-manifest.mjs";
assert.equal(process.platform, "linux");
const root = process.cwd();
const release = JSON.parse(await readFile("scripts/release/release.json"));
const temp = await mkdtemp(join(tmpdir(), "dbrain-linux-package-smoke-"));
async function findRuntime(dir) {
  const manifests = [];
  async function walk(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (entry.isDirectory()) await walk(join(path, entry.name));
      else if (entry.isFile() && entry.name === "runtime-manifest.json")
        manifests.push(join(path, entry.name));
    }
  }
  await walk(dir);
  assert.equal(manifests.length, 1, "Expected one packaged runtime");
  return dirname(manifests[0]);
}
async function smoke(extracted, name, allowElfTransforms) {
  const runtime = await findRuntime(extracted);
  const manifest = JSON.parse(
    await readFile(join(runtime, "runtime-manifest.json")),
  );
  assert.equal(
    `${manifest.platform}-${manifest.arch}`,
    `${process.platform}-${process.arch}`,
  );
  assert.equal(manifest.version, release.version);
  assert.equal(manifest.commit, process.env.DBRAIN_GIT_SHA ?? "local");
  let transformed = 0;
  for (const [file, hash] of Object.entries(manifest.hashes)) {
    assert.ok(
      !file.startsWith("/") && !file.split("/").includes(".."),
      "Unsafe runtime resource path",
    );
    if ((await hashFile(join(runtime, file))) === hash) continue;
    // linuxdeploy patches native RPATHs. JS, migrations and static PB must retain their bytes.
    assert.ok(
      allowElfTransforms &&
        (/^(node|ffmpeg|ffprobe)$/.test(file) ||
          file.startsWith("lib/") ||
          file.endsWith(".node")),
      `Unexpected packaged resource mutation: ${file}`,
    );
    assert.ok(
      (await binaryArchitecture(join(runtime, file))).includes(process.arch),
      `Transformed file is not matching native ELF: ${file}`,
    );
    transformed++;
  }
  assert.equal(
    await hashFile(join(runtime, "pocketbase")),
    manifest.hashes.pocketbase,
    "Static PocketBase changed",
  );
  if (transformed)
    console.log(
      `AppImage transformed ${transformed} native ELF resources; hashes in runtime-manifest describe prepared resources, installer SHA256 covers final bytes`,
    );
  execFileSync(process.execPath, ["apps/desktop/scripts/backend-smoke.mjs"], {
    cwd: root,
    env: { ...process.env, DBRAIN_SMOKE_RUNTIME_DIR: runtime },
    stdio: "inherit",
  });
  console.log(
    `PASS: extracted ${name} runtime integrity and complete backend smoke`,
  );
}
try {
  for (const [format, suffix] of [
    ["deb", ".deb"],
    ["appimage", ".AppImage"],
  ]) {
    const source = resolve(
      `apps/desktop/src-tauri/target/release/bundle/${format}`,
    );
    const packages = (await readdir(source)).filter((name) =>
      name.endsWith(suffix),
    );
    assert.equal(packages.length, 1, `Expected one fresh ${format} installer`);
    const extracted = join(temp, format);
    await mkdir(extracted);
    if (format === "deb")
      execFileSync(
        "dpkg-deb",
        ["--extract", join(source, packages[0]), extracted],
        { stdio: "inherit" },
      );
    else
      execFileSync(join(source, packages[0]), ["--appimage-extract"], {
        cwd: extracted,
        stdio: "ignore",
      });
    await smoke(extracted, packages[0], format === "appimage");
  }
} finally {
  await rm(temp, { recursive: true, force: true });
}
