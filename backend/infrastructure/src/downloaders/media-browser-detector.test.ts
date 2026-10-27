// SPDX-License-Identifier: AGPL-3.0-only

/** Browser detection for the desktop "use my browser login" method. */
import assert from "node:assert/strict";
import { test } from "node:test";

import { SystemMediaBrowserDetector } from "./media-browser-detector.ts";

test("reports only browsers whose macOS application exists", () => {
  const installed = new Set([
    "/Applications/Google Chrome.app",
    "/Applications/Safari.app",
    "/Applications/Arc.app",
  ]);
  const detector = new SystemMediaBrowserDetector({
    platform: "darwin",
    exists: (path) => installed.has(path),
  });

  assert.deepEqual(detector.list(), [
    { name: "chrome", label: "Chrome" },
    { name: "safari", label: "Safari" },
    { name: "arc", label: "Arc" },
  ]);
});

test("reports Windows browsers from their install suffix", () => {
  const detector = new SystemMediaBrowserDetector({
    platform: "win32",
    exists: (path) =>
      path.endsWith("chrome.exe") || path.endsWith("msedge.exe"),
  });

  assert.deepEqual(
    detector.list().map((browser) => browser.name),
    ["chrome", "edge"],
  );
});

test("reports Linux browsers from their binary paths", () => {
  const detector = new SystemMediaBrowserDetector({
    platform: "linux",
    exists: (path) =>
      path === "/usr/bin/firefox" || path === "/usr/bin/brave-browser",
  });

  assert.deepEqual(
    detector.list().map((browser) => browser.name),
    ["firefox", "brave"],
  );
});

test("reports nothing on a platform it does not know", () => {
  const detector = new SystemMediaBrowserDetector({
    platform: "aix",
    exists: () => true,
  });

  assert.deepEqual(detector.list(), []);
});

test("treats a throwing existence check as absent", () => {
  const detector = new SystemMediaBrowserDetector({
    platform: "darwin",
    exists: () => {
      throw new Error("permission denied");
    },
  });

  assert.deepEqual(detector.list(), []);
});
