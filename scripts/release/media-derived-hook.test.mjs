// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

// The module runs inside PocketBase's Go-hosted runtime; `node:vm` gives it a
// plain global scope, which is enough because `deleteDerived` only touches the
// `e.app` it is handed.
const scope = { module: { exports: {} }, console: { warn() {} } };
runInNewContext(
  readFileSync(
    new URL("../../pb/pb_hooks/lib/media-derived.js", import.meta.url),
    "utf8",
  ),
  scope,
);
const { deleteDerived } = scope.module.exports;

/** Cross-realm objects fail `deepEqual` on their prototype; compare plain data. */
const plain = (value) => JSON.parse(JSON.stringify(value));

/** A file record with just the fields the cleanup reads. */
function fileRecord(id, derivedFrom = "") {
  return { id, derivedFrom };
}

/** An app stub whose filter implements `derivedFrom = {:source}`. */
function event(records, options = {}) {
  const event = {
    record: { id: "resource" },
    deleted: [],
    filtered: [],
    queries: [],
    app: {
      findRecordsByFilter(collection, filter, sort, limit, offset, params) {
        event.queries.push({ collection, filter, sort, limit, offset, params });
        const matches = records.filter(
          (record) => record.derivedFrom === params.source,
        );
        event.filtered.push(...matches.map((record) => record.id));
        return matches;
      },
      delete(record) {
        if (options.failFor === record.id) throw new Error("locked");
        const index = records.indexOf(record);
        if (index < 0) throw new Error("not found");
        records.splice(index, 1);
        event.deleted.push(record.id);
      },
    },
  };
  return event;
}

test("deletes every artifact of the resource and nothing else", () => {
  const records = [
    fileRecord("resource"),
    fileRecord("segment-1", "resource"),
    fileRecord("playlist", "resource"),
    fileRecord("cover", "resource"),
    fileRecord("other-segment", "another-resource"),
  ];
  const e = event(records);

  deleteDerived(e);

  // The query is scoped to the deleted resource, unbounded and unsorted.
  assert.deepEqual(plain(e.queries), [
    {
      collection: "files",
      filter: "derivedFrom = {:source}",
      sort: "",
      limit: 0,
      offset: 0,
      params: { source: "resource" },
    },
  ]);
  assert.deepEqual(e.deleted, ["segment-1", "playlist", "cover"]);
  assert.deepEqual(
    records.map((record) => record.id),
    ["resource", "other-segment"],
  );
});

test("a failing artifact does not stop the remaining cleanup", () => {
  const records = [
    fileRecord("segment-1", "resource"),
    fileRecord("segment-2", "resource"),
    fileRecord("playlist", "resource"),
  ];
  const e = event(records, { failFor: "segment-1" });

  deleteDerived(e);

  assert.deepEqual(e.deleted, ["segment-2", "playlist"]);
  assert.deepEqual(
    records.map((record) => record.id),
    ["segment-1"],
  );
});

test("a resource without artifacts deletes nothing", () => {
  const e = event([fileRecord("resource"), fileRecord("orphan", "gone")]);

  deleteDerived(e);

  assert.deepEqual(e.deleted, []);
});

test("files.pb.js wires the cleanup and the storage enforcement", () => {
  const source = readFileSync(
    new URL("../../pb/pb_hooks/files.pb.js", import.meta.url),
    "utf8",
  );
  assert.match(source, /onRecordCreateRequest\([\s\S]*lib\/storage-limits\.js/);
  assert.match(
    source,
    /onRecordAfterDeleteSuccess\([\s\S]*lib\/media-derived\.js/,
  );
  // The cleanup is bound to the `files` collection, not every collection.
  assert.match(source, /onRecordAfterDeleteSuccess\([\s\S]*?"files"\)/);
});
