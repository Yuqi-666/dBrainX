// SPDX-License-Identifier: AGPL-3.0-only

// The platforms of one release candidate.
//
// `scripts/release/release.json` declares the release. It holds the version,
// the platform catalogs, and optional enabled flags. The catalogs remain
// nonempty for compatibility with the trusted main verifier. A disabled family
// contributes no target to the candidate.
//
// The runner tables below are the universe. Every declared name must appear in
// them, and no workflow reads a runner from anywhere else.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const releasePath = "scripts/release/release.json";
const desktopLabel = "desktop target";
const containerLabel = "container platform";

/** The runner that builds each desktop target. */
export const desktopRunners = {
  "linux-x64": "ubuntu-22.04",
  "win32-x64": "windows-2022",
  "darwin-x64": "macos-15-intel",
  "darwin-arm64": "macos-15",
};

/** The runner that builds each container platform. */
export const containerRunners = {
  "linux/amd64": { arch: "amd64", os: "ubuntu-22.04" },
  "linux/arm64": { arch: "arm64", os: "ubuntu-24.04-arm" },
};

/** Splits a name list on commas and spaces. */
export function splitNames(spec) {
  const text = typeof spec === "string" ? spec : "";
  return text.split(/[,\s]+/).filter((item) => item !== "");
}

function declaredList(value, key, universe) {
  assert.ok(Array.isArray(value), `${key} must hold a list of names.`);
  assert.ok(value.length > 0, `${key} is empty. Declare at least one name.`);
  assert.equal(new Set(value).size, value.length, `${key} repeats a name.`);
  for (const name of value)
    assert.ok(
      universe.includes(name),
      `Unknown ${key} name "${name}". The runner table holds ${universe.join(", ")}.`,
    );
  return [...value];
}

/**
 * Reads the declared lists of one `release.json` object.
 *
 * The declaration must stay inside the runner tables. A name outside them is a
 * mistake in the file, and the gate and the candidate both refuse it.
 */
export function declarationOf(release) {
  assert.ok(
    release && typeof release === "object",
    `${releasePath} must hold an object.`,
  );
  for (const key of ["desktopEnabled", "containerEnabled"])
    if (release[key] !== undefined) assert.equal(typeof release[key], "boolean", `${key} must be boolean.`);
  const desktopTargets = declaredList(
      release.desktopTargets,
      "desktopTargets",
      Object.keys(desktopRunners),
    );
  const containerPlatforms = declaredList(
      release.containerPlatforms,
      "containerPlatforms",
      Object.keys(containerRunners),
    );
  assert.ok(release.desktopEnabled !== false || release.containerEnabled !== false, "At least one product family must be enabled.");
  return {
    version: release.version,
    desktopTargets: release.desktopEnabled === false ? [] : desktopTargets,
    containerPlatforms: release.containerEnabled === false ? [] : containerPlatforms,
  };
}

/** Reads `scripts/release/release.json` and checks the declaration. */
export function loadDeclaration(root = ".") {
  return readFile(resolve(root, releasePath), "utf8").then((text) =>
    declarationOf(JSON.parse(text)),
  );
}

/**
 * Reads a selection.
 *
 * An empty text selects the declared list. A comma or space separated list
 * selects a part of it. A name outside the declared list is refused, so a start
 * cannot add a platform that this release does not declare. The result keeps
 * the order of the declared list.
 */
export function selectTargets(spec, declared, label) {
  const text = typeof spec === "string" ? spec.trim() : "";
  if (text === "") return [...declared];
  const wanted = splitNames(text);
  assert.ok(wanted.length > 0, `The ${label} selection is empty.`);
  for (const item of wanted)
    assert.ok(
      declared.includes(item),
      `Unknown ${label} "${item}". ${releasePath} declares ${declared.join(", ")}.`,
    );
  assert.equal(
    new Set(wanted).size,
    wanted.length,
    `The ${label} selection repeats a name.`,
  );
  return declared.filter((item) => wanted.includes(item));
}

/** The architecture of every container platform. */
export function archsOf(platforms) {
  return platforms.map((platform) => {
    const runner = containerRunners[platform];
    assert.ok(runner, `Unknown container platform "${platform}".`);
    return runner.arch;
  });
}

/** The matrix of the workflow `desktop-build.yml`. */
export function desktopMatrix(targets) {
  return targets.map((target) => {
    const os = desktopRunners[target];
    assert.ok(os, `Unknown desktop target "${target}".`);
    return { os, target };
  });
}

/** The matrix of the workflow `container-build.yml`. */
export function containerMatrix(platforms) {
  return platforms.map((platform) => {
    const runner = containerRunners[platform];
    assert.ok(runner, `Unknown container platform "${platform}".`);
    return { os: runner.os, arch: runner.arch };
  });
}

const usage = `Usage:
  platforms.mjs declaration [--json]
  platforms.mjs select desktop|containers [NAME,NAME]
  platforms.mjs matrix desktop|containers NAME,NAME [--archs]`;

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const positional = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
  const [mode, kind, spec] = positional;
  assert.ok(mode, usage);
  if (mode === "declaration") {
    const declared = await loadDeclaration();
    process.stdout.write(
      process.argv.includes("--json")
        ? `${JSON.stringify({
            desktopTargets: declared.desktopTargets,
            containerPlatforms: declared.containerPlatforms,
          })}\n`
        : `desktop ${declared.desktopTargets.join(" ")}\ncontainers ${declared.containerPlatforms.join(" ")}\n`,
    );
  } else if (mode === "select") {
    assert.ok(kind === "desktop" || kind === "containers", usage);
    const declared = await loadDeclaration();
    const desktop = kind === "desktop";
    const selected = selectTargets(
      spec ?? "",
      desktop ? declared.desktopTargets : declared.containerPlatforms,
      desktop ? desktopLabel : containerLabel,
    );
    process.stdout.write(`${selected.join(" ")}\n`);
  } else if (mode === "matrix") {
    assert.ok(kind === "desktop" || kind === "containers", usage);
    const names = splitNames(spec);
    assert.ok(names.length > 0, "The platform selection is empty.");
    if (process.argv.includes("--archs")) {
      assert.equal(kind, "containers", "--archs reads a container platform.");
      process.stdout.write(`${archsOf(names).join(" ")}\n`);
    } else {
      process.stdout.write(
        `${JSON.stringify(
          kind === "desktop" ? desktopMatrix(names) : containerMatrix(names),
        )}\n`,
      );
    }
  } else {
    throw new Error(usage);
  }
}
