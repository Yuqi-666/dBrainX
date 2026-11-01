// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The legacy write surface is gone (plan items 43 and 44).
 *
 * These are the plan's two acceptance greps, run as a test so a regression
 * fails the gate instead of being noticed by hand:
 *
 * 1. The nine whole-record mutation hooks do not exist. The one `useDeleteNode`
 *    that survives is the Tiptap editor's node-delete button, which is a
 *    document gesture and never reaches the graph — it is listed here by path,
 *    which is the whitelist the plan asks for.
 * 2. The endpoint-shaped call of `node.add` / `node.update` / `node.delete`
 *    (and the edge and view equivalents) is gone, while the **operation ids**
 *    of the same names (`operation.invoke("node.add")`, `node.addTag`) stay —
 *    the second test proves the pattern tells the two apart instead of banning
 *    the words.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("../../", import.meta.url).pathname;

/** Generated or installed trees: rebuilt from source, never a caller. */
const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  "dist",
  ".git",
  "pb_data",
  "target",
  ".test-run",
]);

/** The Tiptap node-delete button: a document node, not a graph node. */
const TIPTAP_DELETE_NODE = new Set([
  "packages/editor/components/tiptap-ui/delete-node-button/delete-node-button.tsx",
  "packages/editor/components/tiptap-ui/delete-node-button/use-delete-node.ts",
  "packages/editor/components/tiptap-ui/drag-context-menu/drag-context-menu.tsx",
]);

const SOURCE = /\.(?:ts|tsx|mjs)$/;

function walk(directory, prefix = "", out = []) {
  for (const entry of readdirSync(join(root, directory), {
    withFileTypes: true,
  })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(`${directory}/${entry.name}`, prefix, out);
      continue;
    }
    if (!SOURCE.test(entry.name)) continue;
    out.push(`${directory}/${entry.name}`);
  }
  return out;
}

function matches(files, pattern) {
  const hits = [];
  for (const file of files) {
    const text = readFileSync(join(root, file), "utf8");
    text.split("\n").forEach((line, index) => {
      if (pattern.test(line)) hits.push(`${file}:${index + 1}: ${line.trim()}`);
      pattern.lastIndex = 0;
    });
  }
  return hits;
}

const LEGACY_HOOKS =
  /\b(?:useAddNode|useUpdateNode|useDeleteNode|useAddEdge|useUpdateEdge|useDeleteEdge|useAddView|useUpdateView|useDeleteView)\b/;

/** The plan's endpoint-shape pattern, verbatim. */
const ENDPOINT_SHAPE =
  /trpcClient\.node\.(?:add|update|invoke)\(|nodeRouter\.(?:add|update|invoke)\b|node\.(?:add|update|invoke)\.useMutation|addSchema/;

test("none of the nine whole-record mutation hooks is left", () => {
  const files = [...walk("packages"), ...walk("apps")];
  const hits = matches(files, LEGACY_HOOKS).filter((hit) => {
    const file = hit.slice(0, hit.indexOf(":"));
    return !TIPTAP_DELETE_NODE.has(file);
  });

  assert.deepEqual(hits, [], "a legacy mutation hook is back");
});

test("the endpoint shape is gone and the operation ids stay", () => {
  const files = [
    ...walk("apps/web"),
    ...walk("packages/services"),
    ...walk("packages/api-client"),
    ...walk("backend/adapter-front/src/trpc"),
  ];

  assert.deepEqual(
    matches(files, ENDPOINT_SHAPE),
    [],
    "a legacy endpoint call is back",
  );

  const operations = readFileSync(
    join(root, "packages/services/src/graph/operations.ts"),
    "utf8",
  );
  const handlers = readFileSync(
    join(root, "backend/application/src/commands/operation/node-operation-handlers.ts"),
    "utf8",
  );

  assert.match(operations, /"node\.add"/, "the create operation id stays");
  assert.match(
    handlers,
    /"node\.addTag"/,
    "the tag operation id stays",
  );
  assert.match(
    handlers,
    /"node\.delete"/,
    "the delete operation id stays",
  );
  assert.doesNotMatch(
    operations,
    ENDPOINT_SHAPE,
    "the catalogue names operations, never endpoints",
  );
});

test("no whole-node service write is left", () => {
  const files = [...walk("packages"), ...walk("backend")];
  assert.deepEqual(
    matches(files, /NodeService\.upsert\(|EdgeService\.upsert\(|ViewService\.upsert\(/),
    [],
    "a whole-record write is back",
  );
});
