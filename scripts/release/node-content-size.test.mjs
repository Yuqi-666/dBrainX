// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The JSON ceiling of `nodes.content` and the migration that retires it.
 *
 * A `webpage` node used to keep its whole HTML source in that JSON field. A
 * source the storage policy accepts (the web page category defaults to 16 MiB)
 * made the node update fail with "The maximum allowed JSON size is 1048576
 * bytes" and the editor showed a failed import, so the base schema and
 * `0000000006_node_content_size.js` raised the ceiling to 24 MiB.
 *
 * The node now stores an address instead of the source
 * (`0000000007_webpage_object_storage.js`), so 24 MiB is only a compatibility
 * bound for a database that still holds an inline source before an upgrade.
 * This test keeps the two schema scripts in step and pins the conversion the
 * upgrade runs.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const root = new URL("../../", import.meta.url);
const base = readFileSync(
  new URL("pb/pb_migrations_base/0000000001_base_schema.js", root),
  "utf8",
);
const change = readFileSync(
  new URL("pb/pb_migrations_changes/0000000006_node_content_size.js", root),
  "utf8",
);
const objectStorage = readFileSync(
  new URL("pb/pb_migrations_changes/0000000007_webpage_object_storage.js", root),
  "utf8",
);

/** Reads the `N * 1024 * 1024` expression that follows `anchor`. */
function limitAfter(source, anchor) {
  const match = new RegExp(
    `${anchor}[\\s\\S]{0,200}?(\\d+) \\* 1024 \\* 1024`,
  ).exec(source);
  assert.ok(match, `a mebibyte expression follows ${anchor}`);
  return Number(match[1]) * 1024 * 1024;
}

test("the base schema raises the content field ceiling", () => {
  const block =
    /name: "content",\s*\n\s*type: "json",\s*\n\s*maxSize: [\d\s*]+/.exec(base);
  assert.ok(block, "nodes.content declares a JSON size");
  const limit = limitAfter(block[0], "maxSize:");
  assert.equal(limit, 24 * 1024 * 1024, "the fresh-database schema uses 24 MiB");
  // The default web page category accepts 16 MiB, and JSON escaping of a source
  // adds a little: the compatibility ceiling stays above it with headroom.
  assert.ok(
    limit >= 16 * 1024 * 1024 * 1.25,
    "the node content ceiling leaves headroom over the 16 MiB source limit",
  );
});

test("the change migration raises the ceiling and a rollback restores the default", () => {
  assert.equal(
    limitAfter(change, "const NODE_CONTENT_MAX_BYTES ="),
    24 * 1024 * 1024,
    "the migration value matches the base schema",
  );
  assert.match(
    change,
    /fields\.getByName\("content"\)\.maxSize = NODE_CONTENT_MAX_BYTES/,
    "the up path writes the raised ceiling",
  );
  assert.match(
    change,
    /fields\.getByName\("content"\)\.maxSize = 0/,
    "the down path returns to the PocketBase default",
  );
});

test("the object-storage migration writes the source into the files collection", () => {
  // The JSON column returns the serialized JSON text in the PocketBase JSVM, so
  // the source must be decoded before it becomes a file.
  assert.match(objectStorage, /JSON\.parse\(raw\)/, "the source is JSON-decoded");
  assert.match(
    objectStorage,
    /\$filesystem\.fileFromBytes\(source, name\)/,
    "the source becomes a stored file",
  );
  assert.match(
    objectStorage,
    /record\.set\("size", file\.size\)/,
    "the file record carries the byte length",
  );
  assert.match(
    objectStorage,
    /record\.set\("mimeType", resourceMimeType\(/,
    "the file record carries the MIME type",
  );
  assert.match(
    objectStorage,
    /node\.set\(\s*"content",\s*`\/api\/files\/files\/\$\{record\.id\}\/\$\{record\.getString\("file"\)\}`/,
    "the node keeps the stored address",
  );
  assert.match(
    objectStorage,
    /node\.set\("fileSize", file\.size\)/,
    "the node keeps the byte length",
  );
  assert.match(
    objectStorage,
    /isStoredUrl\(source\)/,
    "a record that is already converted is skipped",
  );
  // The reverse would pull a library resource out of the library; the down path
  // deliberately keeps the blob.
  assert.match(
    objectStorage,
    /One-way, see the header: the blobs stay in the library/,
  );
});
