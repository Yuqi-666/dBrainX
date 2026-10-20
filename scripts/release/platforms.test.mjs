// SPDX-License-Identifier: AGPL-3.0-only

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  archsOf,
  containerMatrix,
  containerRunners,
  declarationOf,
  desktopMatrix,
  desktopRunners,
  selectTargets,
  splitNames,
} from "./platforms.mjs";

const desktop = ["linux-x64", "win32-x64", "darwin-x64", "darwin-arm64"];
const containers = ["linux/amd64", "linux/arm64"];

test("a selection without a list keeps the declared platforms", () => {
  assert.deepEqual(selectTargets("", desktop, "desktop target"), desktop);
  assert.deepEqual(
    selectTargets("  ", containers, "container platform"),
    containers,
  );
});

test("a selection narrows the declared list and keeps its order", () => {
  assert.deepEqual(selectTargets(" linux-x64 ", desktop, "desktop target"), [
    "linux-x64",
  ]);
  assert.deepEqual(
    selectTargets("darwin-arm64 linux-x64", desktop, "desktop target"),
    ["linux-x64", "darwin-arm64"],
  );
  assert.deepEqual(
    selectTargets("linux-x64,darwin-x64", desktop, "desktop target"),
    ["linux-x64", "darwin-x64"],
  );
});

test("a selection outside the declared list is refused", () => {
  assert.throws(
    () => selectTargets("linux-x64,solaris-x64", desktop, "desktop target"),
    /Unknown desktop target "solaris-x64"/,
  );
  assert.throws(
    () => selectTargets("linux-x64,linux-x64", desktop, "desktop target"),
    /repeats a name/,
  );
  assert.throws(
    () => selectTargets(",", desktop, "desktop target"),
    /selection is empty/,
  );
  // A name of the runner table is still refused when the release omits it.
  assert.throws(
    () => selectTargets("win32-x64", ["linux-x64"], "desktop target"),
    /Unknown desktop target "win32-x64"/,
  );
});

test("a declaration must name only platforms of the runner table", () => {
  assert.deepEqual(declarationOf({ desktopTargets: ["linux-x64"], desktopEnabled: false, containerPlatforms: ["linux/amd64"] }).desktopTargets, []);
  assert.deepEqual(declarationOf({ desktopTargets: ["linux-x64"], containerPlatforms: ["linux/amd64"], containerEnabled: false }).containerPlatforms, []);
  assert.throws(() => declarationOf({ desktopTargets: ["linux-x64"], desktopEnabled: false, containerPlatforms: ["linux/amd64"], containerEnabled: false }), /At least one product family/);
  assert.deepEqual(
    declarationOf({
      desktopTargets: ["linux-x64"],
      containerPlatforms: ["linux/arm64"],
    }),
    {
      version: undefined,
      desktopTargets: ["linux-x64"],
      containerPlatforms: ["linux/arm64"],
    },
  );
  assert.throws(
    () =>
      declarationOf({
        desktopTargets: ["solaris-x64"],
        containerPlatforms: ["linux/amd64"],
      }),
    /Unknown desktopTargets name "solaris-x64"/,
  );
  assert.throws(
    () =>
      declarationOf({
        desktopTargets: [],
        containerPlatforms: ["linux/amd64"],
      }),
    /desktopTargets is empty/,
  );
  assert.throws(
    () =>
      declarationOf({
        desktopTargets: ["linux-x64", "linux-x64"],
        containerPlatforms: ["linux/amd64"],
      }),
    /desktopTargets repeats a name/,
  );
  assert.throws(
    () =>
      declarationOf({
        desktopTargets: ["linux-x64"],
        containerPlatforms: ["linux/s390x"],
      }),
    /Unknown containerPlatforms name "linux\/s390x"/,
  );
});

test("the declaration in release.json names runners", async () => {
  const release = JSON.parse(
    await readFile(
      fileURLToPath(new URL("./release.json", import.meta.url)),
      "utf8",
    ),
  );
  const declared = declarationOf(release);
  for (const name of declared.desktopTargets)
    assert.ok(desktopRunners[name], `${name} has no runner`);
  for (const name of declared.containerPlatforms)
    assert.ok(containerRunners[name], `${name} has no runner`);
});

test("a matrix holds one runner for every selected name", () => {
  assert.deepEqual(desktopMatrix(["darwin-arm64"]), [
    { os: "macos-15", target: "darwin-arm64" },
  ]);
  assert.deepEqual(
    desktopMatrix(desktop).map((entry) => entry.target),
    desktop,
  );
  assert.deepEqual(containerMatrix(containers), [
    { os: "ubuntu-22.04", arch: "amd64" },
    { os: "ubuntu-24.04-arm", arch: "arm64" },
  ]);
  assert.throws(
    () => desktopMatrix(["solaris-x64"]),
    /Unknown desktop target "solaris-x64"/,
  );
  assert.throws(
    () => containerMatrix(["linux/s390x"]),
    /Unknown container platform "linux\/s390x"/,
  );
});

test("each container platform holds one architecture", () => {
  assert.deepEqual(archsOf(containers), ["amd64", "arm64"]);
  assert.deepEqual(archsOf(["linux/arm64"]), ["arm64"]);
  assert.throws(() => archsOf(["linux/s390x"]), /Unknown container platform/);
});

test("a name list splits on commas and spaces", () => {
  assert.deepEqual(splitNames(" a, b  c "), ["a", "b", "c"]);
  assert.deepEqual(splitNames(""), []);
  assert.deepEqual(splitNames(undefined), []);
});
