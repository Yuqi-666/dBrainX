// SPDX-License-Identifier: AGPL-3.0-only

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  hashFile,
  nativeBinaryFormat,
  nativeFormatForPlatform,
  pocketbaseVersion,
  runtimeFingerprint,
  verifyRuntimeManifest,
  writeRuntimeManifest,
} from "../lib/runtime-manifest.mjs";
import { pruneMcxBinaries } from "../lib/runtime-modules.mjs";

const MXC_ASSET = "node_modules/@microsoft/mxc-sdk/bin/arm64/lxc-exec";

async function runtimeFixture() {
  const root = await mkdtemp(join(tmpdir(), "dbrainx-runtime-manifest-"));
  await mkdir(join(root, "apps/desktop/src-tauri"), { recursive: true });
  await writeFile(
    join(root, "apps/desktop/src-tauri/tauri.conf.json"),
    JSON.stringify({ version: "1.2.3" }),
  );
  const destination = join(root, "runtime");
  for (const [path, bytes] of [
    [MXC_ASSET, Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1])],
    ["node_modules/@microsoft/mxc-sdk/package.json", "{}"],
    ["pb_migrations_base/0001_base.js", "export {};"],
    ["backend.mjs", "// backend"],
  ]) {
    const file = join(destination, path);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, bytes);
  }
  await writeRuntimeManifest(
    root,
    destination,
    { node: "v24.0.0" },
    { "@microsoft/mxc-sdk": "1.0.1" },
  );
  const manifest = JSON.parse(
    await readFile(join(destination, "runtime-manifest.json"), "utf8"),
  );
  return { root, destination, manifest };
}

test("PocketBase's Windows executable name preserves exact version validation", () => {
  assert.equal(pocketbaseVersion("pocketbase version 0.40.4\n"), "0.40.4");
  assert.equal(pocketbaseVersion("pocketbase.exe version 0.40.4\r\n"), "0.40.4");
  assert.notEqual(pocketbaseVersion("pocketbase.exe version 0.40.3"), "0.40.4");
  assert.equal(pocketbaseVersion("other.exe version 0.40.4"), undefined);
});

test("an MXC asset change alters the upgrade fingerprint and fails the stale manifest", async (t) => {
  const { root, destination, manifest } = await runtimeFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  assert.deepEqual(await verifyRuntimeManifest(destination), {
    files: 4,
    fingerprint: manifest.fingerprint,
  });

  const asset = join(destination, MXC_ASSET);
  const original = await readFile(asset);
  await writeFile(asset, Buffer.concat([original, Buffer.from([0x00])]));

  const changedHashes = {
    ...manifest.hashes,
    [MXC_ASSET]: await hashFile(asset),
  };
  const changedFingerprint = runtimeFingerprint(manifest.version, changedHashes);
  assert.notEqual(changedFingerprint, manifest.fingerprint);
  await assert.rejects(
    verifyRuntimeManifest(destination),
    /runtime-manifest\.json is stale: 1 changed \(node_modules\/@microsoft\/mxc-sdk\/bin\/arm64\/lxc-exec\)/,
  );
});

test("a non-database, non-MXC file does not enter the fingerprint but is still verified", async (t) => {
  const { root, destination, manifest } = await runtimeFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const backend = join(destination, "backend.mjs");
  await writeFile(backend, "// rebuilt backend");
  const changedHashes = {
    ...manifest.hashes,
    "backend.mjs": await hashFile(backend),
  };
  assert.equal(
    runtimeFingerprint(manifest.version, changedHashes),
    manifest.fingerprint,
  );
  await assert.rejects(verifyRuntimeManifest(destination), /is stale/);
});

test("a manifest that omits a file, names a missing file, or lies about its fingerprint is stale", async (t) => {
  const { root, destination, manifest } = await runtimeFixture();
  t.after(() => rm(root, { recursive: true, force: true }));

  await writeFile(join(destination, "extra.bin"), "unlisted");
  await assert.rejects(verifyRuntimeManifest(destination), /not listed/);
  await rm(join(destination, "extra.bin"));

  await rm(join(destination, "backend.mjs"));
  await assert.rejects(verifyRuntimeManifest(destination), /listed but missing/);
  await writeFile(join(destination, "backend.mjs"), "// backend");

  await writeFile(
    join(destination, "runtime-manifest.json"),
    JSON.stringify({ ...manifest, fingerprint: "0".repeat(64) }),
  );
  await assert.rejects(
    verifyRuntimeManifest(destination),
    /fingerprint does not describe its hashes/,
  );
});

test("MXC helpers are pruned to the host's native format and stay executable", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "dbrainx-mxc-bin-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const files = {
    "lxc-exec": Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]),
    "mxc_ffi.dll": Buffer.from([0x4d, 0x5a, 0x90, 0x00]),
    "mxc-exec-mac": Buffer.from([0xcf, 0xfa, 0xed, 0xfe]),
    "manifest.spdx.json": Buffer.from("{}"),
  };
  for (const [name, bytes] of Object.entries(files))
    await writeFile(join(root, name), bytes);

  assert.equal(await nativeBinaryFormat(join(root, "lxc-exec")), "elf");
  assert.equal(await nativeBinaryFormat(join(root, "mxc_ffi.dll")), "pe");
  assert.equal(await nativeBinaryFormat(join(root, "mxc-exec-mac")), "mach-o");
  assert.equal(await nativeBinaryFormat(join(root, "manifest.spdx.json")), undefined);

  await pruneMcxBinaries(root, "linux");
  assert.deepEqual((await readdir(root)).sort(), [
    "lxc-exec",
    "manifest.spdx.json",
  ]);
  assert.equal((await stat(join(root, "lxc-exec"))).mode & 0o111, 0o111);
  assert.equal(nativeFormatForPlatform("linux"), "elf");
  assert.equal(nativeFormatForPlatform("darwin"), "mach-o");
  assert.equal(nativeFormatForPlatform("win32"), "pe");
});
