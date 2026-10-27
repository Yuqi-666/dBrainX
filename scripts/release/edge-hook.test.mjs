// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const scope = { module: { exports: {} }, BadRequestError: Error };
runInNewContext(readFileSync(new URL("../../pb/pb_hooks/lib/edge.js", import.meta.url), "utf8"), scope);
const { validateEdge } = scope.module.exports;

function event({ semanticId = "", targetWorkspace = "w", semanticWorkspace = "w" } = {}) {
  const lookups = [];
  const values = { workspaceId: "w", from: "source", to: "target", semanticId };
  return {
    lookups,
    record: { getString: (field) => values[field] },
    app: { findRecordById(collection, id) {
      lookups.push([collection, id]);
      if (!id) throw new Error("Record not found");
      return { getString: () => collection === "edge_semantics" ? semanticWorkspace : id === "target" ? targetWorkspace : "w" };
    } },
    next: () => "saved",
  };
}

test("untyped edges validate both endpoints without looking up an empty semantic", () => {
  const e = event();
  assert.equal(validateEdge(e), "saved");
  assert.deepEqual(e.lookups, [["nodes", "source"], ["nodes", "target"]]);
});

test("semantic selection validates its workspace and rejects missing records", () => {
  assert.equal(validateEdge(event({ semanticId: "semantic" })), "saved");
  assert.throws(() => validateEdge(event({ semanticId: "semantic", semanticWorkspace: "foreign" })), /semantic must belong/);
  const e = event({ semanticId: "missing" });
  const lookup = e.app.findRecordById;
  e.app.findRecordById = (collection, id) => {
    if (collection === "edge_semantics") throw new Error("Record not found");
    return lookup(collection, id);
  };
  assert.throws(() => validateEdge(e), /Record not found/);
});

test("omitting semantics does not bypass endpoint workspace checks", () => {
  assert.throws(() => validateEdge(event({ targetWorkspace: "foreign" })), /endpoints must belong/);
});
