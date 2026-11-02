// SPDX-License-Identifier: AGPL-3.0-only

import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import {
  chmod,
  cp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  nativeBinaryFormat,
  nativeFormatForPlatform,
} from "./runtime-manifest.mjs";

/**
 * Keep only helpers this host can execute.
 *
 * MXC ships every backend's binaries in each `bin/<arch>` directory: a Linux
 * package still holds Windows PE and macOS Mach-O helpers. Copying them all
 * bloats the installer and makes the macOS signing pass meet binaries it
 * cannot sign. Non-native files (SPDX manifests, licenses) stay.
 */
export async function pruneMcxBinaries(binDir, platform = process.platform) {
  const wanted = nativeFormatForPlatform(platform);
  for (const entry of await readdir(binDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = join(binDir, entry.name);
    const format = await nativeBinaryFormat(path);
    if (format === undefined) continue;
    if (format !== wanted) {
      await rm(path, { force: true });
      continue;
    }
    // Installed packages keep the executable bit; a rewrite must not drop it.
    await chmod(path, 0o755);
  }
}

/** Walk up from a resolved entry point to the directory that holds its package.json. */
async function packageDirectory(entry) {
  let directory = dirname(await realpath(entry));
  while (!existsSync(join(directory, "package.json")))
    directory = dirname(directory);
  return directory;
}

/** Copy the external runtime packages directly from the frozen install.
 * Everything else is bundled by esbuild. Never ship workspace symlinks or
 * another architecture's optional native addon. */
export async function prepareModules(root, _staging, destination) {
  const require = createRequire(
    join(root, "backend/infrastructure/package.json"),
  );
  // The sandbox package owns MXC. Its FFI library and helper executables sit
  // under bin/<arch> inside the package, and it imports koffi, node-pty, and
  // semver at run time, so those must resolve beside it in the runtime.
  const mxc = createRequire(
    createRequire(join(root, "backend/sandbox/package.json")).resolve(
      "@microsoft/mxc-sdk/package.json",
    ),
  );
  const koffiNative = `@koromix/koffi-${process.platform}-${process.arch}`;
  const libc =
    process.platform === "linux"
      ? process.report.getReport().header.glibcVersionRuntime
        ? "-gnu"
        : "-musl"
      : "";
  const native = `@napi-rs/canvas-${process.platform}-${process.arch}${process.platform === "win32" ? "-msvc" : libc}`;
  const canvasRequire = createRequire(
    require.resolve("@napi-rs/canvas/package.json"),
  );
  const koffiRequire = createRequire(mxc.resolve("koffi"));
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  const versions = {};
  for (const [name, resolver] of [
    ["pdfjs-dist", require],
    ["@napi-rs/canvas", require],
    [native, canvasRequire],
    ["@microsoft/mxc-sdk", mxc],
    ["koffi", mxc],
    ["node-pty", mxc],
    ["semver", mxc],
    [koffiNative, koffiRequire],
  ]) {
    const source = await packageDirectory(resolver.resolve(name));
    const target = join(destination, "node_modules", name);
    await mkdir(dirname(target), { recursive: true });
    await cp(source, target, { recursive: true, dereference: true });
    // MXC ships both bin/<arch> trees and node-pty ships every platform's
    // prebuilds; the runtime only loads the one for this machine.
    if (name === "@microsoft/mxc-sdk") {
      for (const foreign of ["arm64", "x64"].filter((value) => value !== arch))
        await rm(join(target, "bin", foreign), {
          recursive: true,
          force: true,
        });
      await pruneMcxBinaries(join(target, "bin", arch));
    }
    if (name === "node-pty")
      for (const prebuild of await readdir(join(target, "prebuilds")))
        if (prebuild !== `${process.platform}-${process.arch}`)
          await rm(join(target, "prebuilds", prebuild), {
            recursive: true,
            force: true,
          });
    // Koffi's platform package carries both the glibc and the musl addon; the
    // foreign one cannot link against this host's libc.
    if (name === koffiNative && process.platform === "linux") {
      const keep = `${libc === "-musl" ? "musl" : "linux"}_${process.arch}`;
      for (const triplet of await readdir(target))
        if (/^(?:linux|musl)_/.test(triplet) && triplet !== keep)
          await rm(join(target, triplet), { recursive: true, force: true });
    }
    versions[name] = JSON.parse(
      await readFile(join(source, "package.json")),
    ).version;
  }
  // Loading the shipped native binding catches missing/wrong-platform binaries early.
  const shipped = createRequire(join(destination, "package.json"));
  shipped("@napi-rs/canvas").createCanvas(2, 2);
  // The MXC FFI library is resolved from bin/<arch>, never from the bundle.
  await stat(
    join(
      destination,
      "node_modules/@microsoft/mxc-sdk/bin",
      arch,
      {
        linux: "libmxc_ffi.so",
        darwin: "libmxc_ffi.dylib",
        win32: "mxc_ffi.dll",
      }[process.platform],
    ),
  );
  return versions;
}
