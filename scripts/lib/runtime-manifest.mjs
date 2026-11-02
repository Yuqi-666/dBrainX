// SPDX-License-Identifier: AGPL-3.0-only

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { open, readFile, readdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
/** MXC ships per-architecture helpers; the package is the unit the desktop ships. */
export const MXC_PACKAGE_PREFIX = "node_modules/@microsoft/mxc-sdk/";

/** Native container format, independent of the architecture inside it. */
export async function nativeBinaryFormat(path) {
  const handle = await open(path, "r");
  const bytes = Buffer.alloc(4);
  try {
    await handle.read(bytes, 0, bytes.length, 0);
  } finally {
    await handle.close();
  }
  if (bytes[0] === 0x7f && bytes[1] === 0x45 && bytes[2] === 0x4c && bytes[3] === 0x46)
    return "elf";
  if (bytes[0] === 0x4d && bytes[1] === 0x5a) return "pe";
  // Mach-O appears in both byte orders, thin and universal.
  const thin = new Set([0xfeedface, 0xfeedfacf]);
  const fat = new Set([0xcafebabe, 0xcafebabf]);
  const be = bytes.readUInt32BE(0);
  const le = bytes.readUInt32LE(0);
  if (thin.has(be) || thin.has(le) || fat.has(be) || fat.has(le))
    return "mach-o";
  return undefined;
}

/** The one native format a build host can execute. */
export function nativeFormatForPlatform(platform = process.platform) {
  return { linux: "elf", darwin: "mach-o", win32: "pe" }[platform];
}

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
  const fingerprint = runtimeFingerprint(version, hashes);
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

/**
 * The upgrade fingerprint: what a device would lose if the runtime changed.
 *
 * The database inputs decide migrations; the MXC package decides which sandbox
 * engine is installed. An asset swap must force the pre-upgrade backup and the
 * release-state update even when the database files are byte-identical.
 */
export function runtimeFingerprint(version, hashes) {
  const entries = Object.entries(hashes);
  const databaseInputs = entries.filter(
    ([name]) =>
      name.startsWith("pb_migrations_base/") ||
      name.startsWith("pb_migrations_changes/") ||
      name === "pocketbase-migrations.mjs" ||
      /^pocketbase(?:\.exe)?$/.test(name),
  );
  const mxcInputs = entries.filter(([name]) =>
    name.startsWith(MXC_PACKAGE_PREFIX),
  );
  return createHash("sha256")
    .update(JSON.stringify({ version, databaseInputs, mxcInputs }))
    .digest("hex");
}

/**
 * Prove a written manifest still describes the tree beside it.
 *
 * A runtime that was mutated after packaging must fail here instead of shipping
 * a fingerprint that no longer names what the device will run.
 */
export async function verifyRuntimeManifest(destination) {
  const manifest = JSON.parse(
    await readFile(join(destination, "runtime-manifest.json"), "utf8"),
  );
  const actual = new Map();
  async function walk(dir, prefix = "") {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort(
      (a, b) => a.name.localeCompare(b.name),
    )) {
      const name = `${prefix}${entry.name}`;
      if (entry.isDirectory()) await walk(join(dir, entry.name), `${name}/`);
      else if (entry.isFile() && name !== "runtime-manifest.json")
        actual.set(name, join(dir, entry.name));
    }
  }
  await walk(destination);
  const declared = manifest.hashes ?? {};
  const unlisted = [...actual.keys()].filter((name) => !(name in declared));
  const absent = Object.keys(declared).filter((name) => !actual.has(name));
  const changed = [];
  for (const [name, path] of actual) {
    if (name in declared && (await hashFile(path)) !== declared[name])
      changed.push(name);
  }
  if (unlisted.length || absent.length || changed.length) {
    const parts = [];
    if (changed.length)
      parts.push(
        `${changed.length} changed (${changed.slice(0, 5).join(", ")}${changed.length > 5 ? ", ..." : ""})`,
      );
    if (unlisted.length)
      parts.push(
        `${unlisted.length} not listed (${unlisted.slice(0, 5).join(", ")}${unlisted.length > 5 ? ", ..." : ""})`,
      );
    if (absent.length)
      parts.push(
        `${absent.length} listed but missing (${absent.slice(0, 5).join(", ")}${absent.length > 5 ? ", ..." : ""})`,
      );
    throw new Error(`runtime-manifest.json is stale: ${parts.join("; ")}`);
  }
  if (manifest.fingerprint !== runtimeFingerprint(manifest.version, declared))
    throw new Error(
      "runtime-manifest.json is stale: its fingerprint does not describe its hashes",
    );
  return { files: actual.size, fingerprint: manifest.fingerprint };
}
