// SPDX-License-Identifier: AGPL-3.0-only

import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import {
  cp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
} from "node:fs/promises";
import { dirname, join } from "node:path";

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
      const ffi = {
        linux: "libmxc_ffi.so",
        darwin: "libmxc_ffi.dylib",
        win32: "mxc_ffi.dll",
      }[process.platform];
      for (const foreign of ["arm64", "x64"].filter((value) => value !== arch))
        await rm(join(target, "bin", foreign), {
          recursive: true,
          force: true,
        });
      // A foreign-format FFI library cannot load here, and the macOS bundler
      // runs `otool` on every native file, which cannot read a Linux ELF.
      for (const file of await readdir(join(target, "bin", arch)))
        if (
          /^(?:libmxc_ffi\.(?:so|dylib)|mxc_ffi\.dll)$/.test(file) &&
          file !== ffi
        )
          await rm(join(target, "bin", arch, file), { force: true });
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
