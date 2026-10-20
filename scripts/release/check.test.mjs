// SPDX-License-Identifier: AGPL-3.0-only

import test from "node:test";
import assert from "node:assert/strict";
import { checkRelease, lockedAppVersion } from "./check.mjs";
test("Windows CRLF and Unix LF lockfiles identify the same app version", () => {
  const lock = '[[package]]\nname = "another"\nversion = "9.0.0"\n\n[[package]]\nname = "app"\nversion = "0.1.0"\n';
  assert.equal(lockedAppVersion(lock), "0.1.0");
  assert.equal(lockedAppVersion(lock.replaceAll("\n", "\r\n")), "0.1.0");
  assert.equal(lockedAppVersion(lock.replace('name = "app"', 'name = "missing"')), undefined);
});
test("release metadata is consistent and mismatched tags fail", async () => {
  assert.match(await checkRelease(), /^\d+\.\d+\.\d+/);
  await assert.rejects(checkRelease("v999.0.0"));
});
