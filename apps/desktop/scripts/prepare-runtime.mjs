// SPDX-License-Identifier: AGPL-3.0-only

/** Prepare on the target platform: native libraries and executables cannot be cross-copied. */
import { signWindowsRuntime } from "../../../scripts/lib/windows-signing.mjs";
import {
  verifyBinaries,
  writeRuntimeManifest,
} from "../../../scripts/lib/runtime-manifest.mjs";
import { bundleMacLibraries } from "../../../scripts/lib/macos-libraries.mjs";
import { bundleBackend } from "../../../scripts/lib/bundle-backend.mjs";
import { prepareModules } from "../../../scripts/lib/runtime-modules.mjs";
import { execFileSync } from "node:child_process";
import {
  chmod,
  copyFile,
  cp,
  mkdir,
  readdir,
  realpath,
  rm,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

if (Number(process.versions.node.split(".")[0]) < 22)
  throw new Error("Desktop runtime requires Node 22 or newer");

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const destination = join(root, "apps/desktop/src-tauri/runtime");
const staging = join(root, "apps/desktop/.runtime-staging");
const exe = (name) => (process.platform === "win32" ? `${name}.exe` : name);
function binary(name, override) {
  if (override) return resolve(override);
  return execFileSync(
    process.platform === "win32" ? "where.exe" : "which",
    [name],
    { encoding: "utf8" },
  )
    .trim()
    .split(/\r?\n/)[0];
}
// Validate required tools before replacing a previously working runtime.
const binaries = {
  node: process.execPath,
  pocketbase:
    process.env.DBRAINX_POCKETBASE_PATH || join(root, "pb", exe("pocketbase")),
  ffmpeg: binary("ffmpeg", process.env.FFMPEG_PATH),
  ffprobe: binary("ffprobe", process.env.FFPROBE_PATH),
};
const versions = await verifyBinaries(root, binaries);
await rm(staging, { recursive: true, force: true });
try {
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  const modules = await prepareModules(root, staging, destination);
  await cp(join(root, "pb/pb_migrations_base"), join(destination, "pb_migrations_base"), {
    recursive: true,
  });
  await cp(join(root, "pb/pb_migrations_changes"), join(destination, "pb_migrations_changes"), {
    recursive: true,
  });
  await cp(join(root, "scripts/lib/pocketbase-migrations.mjs"), join(destination, "pocketbase-migrations.mjs"));
  await cp(join(root, "pb/pb_hooks"), join(destination, "pb_hooks"), {
    recursive: true,
  });
  await cp(
    join(root, "apps/server/src/desktop/pb_hooks"),
    join(destination, "pb_hooks"),
    { recursive: true },
  );
  for (const [name, path] of Object.entries(binaries)) {
    const target = join(destination, exe(name));
    await copyFile(await realpath(path), target);
    await chmod(target, 0o755);
  }
  await bundleBackend(
    root,
    "apps/server/src/desktop/runtime.ts",
    join(destination, "backend.mjs"),
  );
  const nativeFiles = [];
  async function collect(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) await collect(child);
      else if (entry.name.endsWith(".node")) nativeFiles.push(child);
    }
  }
  await collect(join(destination, "node_modules"));
  if (process.platform === "linux") {
    await mkdir(join(destination, "lib"));
    const libraries = new Map();
    for (const path of [...Object.values(binaries), ...nativeFiles]) {
      let output;
      try {
        output = execFileSync("ldd", [path], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch {
        continue;
      } // Static binaries need no shared objects.
      if (output.includes("not found"))
        throw new Error(`Missing shared libraries for ${path}: ${output}`);
      for (const match of output.matchAll(/^\s*(\S+) => (\/\S+)/gm)) {
        const [, name, path] = match;
        // The dynamic loader and glibc must come from the target system together.
        if (/^(libc|libm|libpthread|libdl|librt)\.so/.test(name)) continue;
        const previous = libraries.get(name);
        const resolved = await realpath(path);
        if (previous && previous !== resolved)
          throw new Error(`Conflicting shared library ${name}`);
        libraries.set(name, resolved);
      }
    }
    for (const [name, path] of libraries)
      await copyFile(path, join(destination, "lib", name));
  }
  await bundleMacLibraries(
    destination,
    Object.entries(binaries).map(([name, path]) => [
      path,
      join(destination, exe(name)),
    ]),
    nativeFiles,
  );
  await signWindowsRuntime(destination);
  // Tauri reuses AppDir; removed resources otherwise survive and linuxdeploy
  // still scans the old optional bindings on a subsequent build.
  for (const cache of [
    "runtime",
    "bundle/appimage/dBrainX.AppDir",
    "bundle/appimage_deb",
  ]) {
    await rm(join(root, "apps/desktop/src-tauri/target/release", cache), {
      recursive: true,
      force: true,
    });
  }
  await writeRuntimeManifest(root, destination, versions, modules);
  console.log(`Desktop backend prepared: ${process.platform}/${process.arch}`);
} finally {
  await rm(staging, { recursive: true, force: true });
}
