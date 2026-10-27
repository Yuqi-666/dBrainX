// SPDX-License-Identifier: AGPL-3.0-only

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { open, readFile, readdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
export function pocketbaseVersion(output) {
  return output.trim().match(/^pocketbase(?:\.exe)? version (\S+)$/)?.[1];
}
export async function hashFile(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
export async function binaryArchitecture(path) {
  const handle = await open(path, "r");
  const bytes = Buffer.alloc(4096);
  try {
    await handle.read(bytes, 0, bytes.length, 0);
  } finally {
    await handle.close();
  }
  if (bytes.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) {
    const machine =
      bytes[5] === 1 ? bytes.readUInt16LE(18) : bytes.readUInt16BE(18);
    return machine === 62 ? ["x64"] : machine === 183 ? ["arm64"] : [];
  }
  if (bytes.readUInt16LE(0) === 0x5a4d) {
    const offset = bytes.readUInt32LE(0x3c);
    if (offset + 6 >= bytes.length || bytes.readUInt32LE(offset) !== 0x4550)
      throw new Error(`Invalid PE: ${path}`);
    const machine = bytes.readUInt16LE(offset + 4);
    return machine === 0x8664 ? ["x64"] : machine === 0xaa64 ? ["arm64"] : [];
  }
  const cpu = (value) =>
    value === 0x01000007 ? "x64" : value === 0x0100000c ? "arm64" : undefined;
  const magic = bytes.readUInt32BE(0);
  if (magic === 0xcffaedfe) return [cpu(bytes.readUInt32LE(4))].filter(Boolean);
  if (magic === 0xfeedfacf) return [cpu(bytes.readUInt32BE(4))].filter(Boolean);
  if (magic === 0xcafebabe || magic === 0xcafebabf) {
    const count = bytes.readUInt32BE(4),
      step = magic === 0xcafebabf ? 32 : 20;
    if (count > 20) throw new Error("Invalid universal binary");
    return Array.from({ length: count }, (_, i) =>
      cpu(bytes.readUInt32BE(8 + i * step)),
    ).filter(Boolean);
  }
  throw new Error(`Not a native executable: ${path}`);
}
export async function verifyBinaries(root, binaries) {
  const lock = JSON.parse(
    await readFile(join(root, "scripts/release/pocketbase-lock.json")),
  );
  const versions = {};
  for (const [name, path] of Object.entries(binaries)) {
    if (!(await binaryArchitecture(path)).includes(process.arch))
      throw new Error(`${name} does not match ${process.arch}`);
    const output = execFileSync(
      path,
      [name === "pocketbase" || name === "node" ? "--version" : "-version"],
      { encoding: "utf8" },
    );
    versions[name] = output.split(/\r?\n/)[0];
  }
  if (pocketbaseVersion(versions.pocketbase) !== lock.version)
    throw new Error(`PocketBase must match ${lock.version}`);
  const encoders = execFileSync(
    binaries.ffmpeg,
    ["-hide_banner", "-encoders"],
    { encoding: "utf8" },
  );
  if (!/\blibx264\b/.test(encoders) || !/\baac\b/.test(encoders))
    throw new Error("FFmpeg needs libx264 and AAC encoders");
  return versions;
}
export async function writeRuntimeManifest(
  root,
  destination,
  versions,
  modules,
) {
  const version = JSON.parse(
    await readFile(join(root, "apps/desktop/src-tauri/tauri.conf.json")),
  ).version;
  const hashes = {};
  async function walk(dir, prefix = "") {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort(
      (a, b) => a.name.localeCompare(b.name),
    )) {
      const name = `${prefix}${entry.name}`;
      if (entry.isDirectory()) await walk(join(dir, entry.name), `${name}/`);
      else hashes[name] = await hashFile(join(dir, entry.name));
    }
  }
  await walk(destination);
  const databaseInputs = Object.entries(hashes).filter(
    ([name]) =>
      name.startsWith("pb_migrations_base/") ||
      name.startsWith("pb_migrations_changes/") ||
      name === "pocketbase-migrations.mjs" ||
      /^pocketbase(?:\.exe)?$/.test(name),
  );
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ version, databaseInputs }))
    .digest("hex");
  await writeFile(
    join(destination, "runtime-manifest.json"),
    JSON.stringify(
      {
        version,
        fingerprint,
        platform: process.platform,
        arch: process.arch,
        versions,
        modules,
        hashes,
        commit: process.env.DBRAINX_GIT_SHA ?? "local",
      },
      null,
      2,
    ),
  );
}
