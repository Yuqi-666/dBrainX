// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { test } from "node:test";
import { allowedOrigin, allowedFileRequest, sessionPath } from "./security.ts";

test("gateway requires the exact session secret and rejects arbitrary browser origins", () => {
  assert.equal(sessionPath("/session/secret/trpc", "secret"), "/trpc");
  assert.equal(sessionPath("/session/secret/trpc?connectionParams=1", "secret")?.split("?")[0], "/trpc");
  for (const url of ["/session/secret2/trpc", "/session/secret", "/trpc"]) assert.equal(sessionPath(url, "secret"), undefined);
  assert.equal(allowedOrigin("http://localhost:3002"), true);
  assert.equal(allowedOrigin("tauri://localhost"), true);
  assert.equal(allowedOrigin("https://hostile.example"), false);
  assert.equal(allowedOrigin("null"), false);
});
test("file gateway permits only file reads, upload creates, and the files collection", () => {
  assert.equal(allowedFileRequest("/api/files/files/abcdef/file.png", "GET"), true);
  assert.equal(allowedFileRequest("/api/files/files/abcdef/file.mp4", "HEAD"), true);
  assert.equal(allowedFileRequest("/api/collections/files/records", "POST"), true);
  // The resource library lists, renames and deletes on the record itself.
  assert.equal(allowedFileRequest("/api/collections/files/records", "GET"), true);
  assert.equal(
    allowedFileRequest("/api/collections/files/records/abcdef", "PATCH"),
    true,
  );
  assert.equal(
    allowedFileRequest("/api/collections/files/records/abcdef", "DELETE"),
    true,
  );
  for (const path of ["/_/", "/api/collections/users/records", "/api/files/files/abcdef/../file.png"]) assert.equal(allowedFileRequest(path, "GET"), false);
  assert.equal(allowedFileRequest("/api/collections/files/records", "DELETE"), false);
  // The boundary is still the one collection: no other collection, and no
  // write to a blob URL or a record through another method.
  assert.equal(
    allowedFileRequest("/api/collections/users/records/abcdef", "PATCH"),
    false,
  );
  assert.equal(
    allowedFileRequest("/api/collections/files/records/abcdef/other", "PATCH"),
    false,
  );
  assert.equal(allowedFileRequest("/api/collections/files/records", "PUT"), false);
  assert.equal(
    allowedFileRequest("/api/files/files/abcdef/file.png", "DELETE"),
    false,
  );
});
