// SPDX-License-Identifier: AGPL-3.0-only

import test from "node:test";
import assert from "node:assert/strict";
import { pocketbaseVersion } from "../lib/runtime-manifest.mjs";

test("PocketBase's Windows executable name preserves exact version validation", () => {
  assert.equal(pocketbaseVersion("pocketbase version 0.40.4\n"), "0.40.4");
  assert.equal(pocketbaseVersion("pocketbase.exe version 0.40.4\r\n"), "0.40.4");
  assert.notEqual(pocketbaseVersion("pocketbase.exe version 0.40.3"), "0.40.4");
  assert.equal(pocketbaseVersion("other.exe version 0.40.4"), undefined);
});
