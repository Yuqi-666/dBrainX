// SPDX-License-Identifier: AGPL-3.0-only

import { execFileSync } from "node:child_process";
import { chmod, copyFile, mkdir, realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { basename, dirname, join, relative, resolve } from "node:path";
// otool -L lists LC_ID_DYLIB as well as dependencies. Prebuilt .node files may
// retain their original build machine's ID, which need not exist on this host.
export function macLibraryMetadata(libraries, commands) {
  const id = commands.match(/cmd LC_ID_DYLIB\r?\n[\s\S]*?name (.+) \(offset/)?.[1];
  return {
    dependencies: libraries.split(/\r?\n/).slice(1)
      .map((line) => line.trim().split(" (compatibility")[0])
      .filter((dependency) => dependency && dependency !== id),
    rpaths: [...commands.matchAll(/cmd LC_RPATH[\s\S]*?path (.+) \(offset/g)]
      .map((match) => match[1]),
  };
}
/** Package Homebrew dylibs transitively and make every reference relative to its
 * loader. Fail on ambiguous/unresolvable libraries instead of shipping a host path. */
export async function bundleMacLibraries(
  destination,
  executables,
  nativeFiles,
) {
  if (process.platform !== "darwin") return;
  const libDir = join(destination, "lib");
  await mkdir(libDir, { recursive: true });
  const seen = new Map(),
    names = new Map();
  const extraSignTargets = new Set();
  async function inspect(source, target) {
    source = await realpath(source);
    if (seen.has(source)) return seen.get(source);
    seen.set(source, target);
    await chmod(target, 0o755);
    const output = execFileSync("otool", ["-L", source], { encoding: "utf8" });
    const commands = execFileSync("otool", ["-l", source], {
      encoding: "utf8",
    });
    const { dependencies, rpaths } = macLibraryMetadata(output, commands);
    for (const dependency of dependencies) {
      if (
        dependency.startsWith("/usr/lib/") ||
        dependency.startsWith("/System/Library/")
      )
        continue;
      // The dylib's own LC_ID_DYLIB is listed by otool too.
      if (
        dependency === source ||
        (dependency.startsWith("/") &&
          (await realpath(dependency).catch(() => "")) === source)
      )
        continue;
      let original;
      if (dependency.startsWith("@loader_path/"))
        original = resolve(dirname(source), dependency.slice(13));
      else if (dependency.startsWith("@rpath/")) {
        for (const rpath of rpaths) {
          const base = rpath.replace("@loader_path", dirname(source));
          const candidate = await realpath(
            join(base, dependency.slice(7)),
          ).catch(() => undefined);
          if (candidate) {
            original = candidate;
            break;
          }
        }
      } else if (dependency.startsWith("/")) original = dependency;
      if (!original)
        throw new Error(
          `Cannot resolve macOS library ${dependency} for ${source}`,
        );
      original = await realpath(original);
      const name = basename(original);
      if (names.has(name) && names.get(name) !== original)
        throw new Error(`Conflicting macOS library ${name}`);
      names.set(name, original);
      const packaged = join(libDir, name);
      if (!seen.has(original)) {
        await copyFile(original, packaged);
        await inspect(original, packaged);
      }
      execFileSync("install_name_tool", [
        "-change",
        dependency,
        `@loader_path/${relative(dirname(target), packaged)}`,
        target,
      ]);
    }
    if (target.endsWith(".dylib"))
      execFileSync("install_name_tool", [
        "-id",
        `@loader_path/${basename(target)}`,
        target,
      ]);
  }
  for (const [source, target] of [
    ...executables,
    ...nativeFiles.map((path) => [path, path]),
  ])
    await inspect(source, target);
  // Homebrew's SDL2 compatibility layer dlopens SDL3, so otool -L cannot
  // discover it. SDL2 searches @loader_path/libSDL3.dylib before host paths:
  // ship that exact name beside SDL2 and collect/sign SDL3's real dependencies.
  // https://github.com/libsdl-org/sdl2-compat/blob/main/src/sdl2_compat.c
  if ([...seen.keys()].some(path => path.includes("/sdl2-compat/") && basename(path).startsWith("libSDL2"))) {
    const prefix = execFileSync("brew", ["--prefix", "sdl3"], { encoding: "utf8", timeout: 30_000 }).trim();
    const source = await realpath(join(prefix, "lib/libSDL3.dylib"));
    const target = join(libDir, "libSDL3.dylib");
    if (seen.has(source) && seen.get(source) !== target) {
      // Preserve the loader-facing name even if a future linked dependency
      // already collected SDL3 under its versioned filename.
      await copyFile(seen.get(source), target);
      await chmod(target, 0o755);
      extraSignTargets.add(target);
    } else if (!seen.has(source)) {
      await copyFile(source, target);
      await inspect(source, target);
    }
  }
  // install_name_tool invalidates existing signatures. Re-sign with the release
  // identity if configured, otherwise use ad-hoc signatures for local builds.
  for (const target of [...new Set([...seen.values(), ...extraSignTargets])].sort((a, b) => b.length - a.length)) {
    execFileSync("codesign", [
      "--force",
      "--sign",
      process.env.APPLE_SIGNING_IDENTITY || "-",
      "--options",
      "runtime",
      ...(basename(target) === "node"
        ? [
            "--entitlements",
            fileURLToPath(
              new URL("../release/node-entitlements.plist", import.meta.url),
            ),
          ]
        : []),
      ...(process.env.APPLE_SIGNING_IDENTITY ? ["--timestamp"] : []),
      target,
    ]);
  }
}
