// SPDX-License-Identifier: AGPL-3.0-only

import test from "node:test";
import assert from "node:assert/strict";
// File path logic has no dependencies on native modules or the database.
import { recordIdFromFileUrl, toFileEndpointPath } from "./file-address.ts";
test("deployment and desktop gateway addresses resolve only to stored files", () => {
  for (const prefix of [
    "",
    "https://example.test",
    "https://example.test/pb",
    "/session/abcdef",
  ]) {
    assert.equal(
      toFileEndpointPath(
        `${prefix}/api/files/files/abcdef123456789/sample.pdf`,
      ),
      "/api/files/files/abcdef123456789/sample.pdf",
    );
  }
  for (const url of [
    "http://169.254.169.254/latest/meta-data",
    "/api/files/files/a/../../health",
    "/api/collections/users/records",
    "/api/files/files/a/name/extra",
  ]) {
    assert.throws(() => toFileEndpointPath(url));
  }
});

test("a file address resolves to the record that owns the blob", () => {
  assert.equal(
    recordIdFromFileUrl(
      "https://example.test/pb/api/files/files/abcdef123456789/paper.pdf",
    ),
    "abcdef123456789",
  );
  assert.throws(() =>
    recordIdFromFileUrl("https://example.test/api/collections/users/records"),
  );
});
