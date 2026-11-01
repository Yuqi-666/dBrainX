// SPDX-License-Identifier: AGPL-3.0-only

/**
 * What each graph gesture asks the service layer to write.
 *
 * The hook no longer owns a write: every gesture is a sequence of invocations
 * handed to an injected invoker, so the assertions here are about the calls
 * that reach that seam (operation id, target, input, correlation id) rather
 * than about internals a mock could satisfy without the write happening.
 *
 * The file is `.mjs` on purpose: `packages/hooks` has no `@types/node`, so a
 * `.ts` test importing `node:test` would fail `pnpm check-types`, and adding
 * the dependency would drag a lockfile change into a refactor that must not
 * touch it. `graph-gestures.ts` itself imports only types, so plain node with
 * `--experimental-strip-types` loads it without a `@workspace/*` alias.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  addNode,
  changeEdgeDirection,
  changeEdgeSemantic,
  changeNodeSemantic,
  createEdge,
  deleteEdge,
  deleteSelected,
} from "./graph-gestures.ts";

const CREATED_NODE = {
  id: "node-created",
  nodeType: "text",
  title: "New Node",
};
const CREATED_EDGE = { id: "edge-created" };

function makePorts(overrides = {}) {
  const calls = [];
  const reported = [];
  const opened = [];
  const edgeCreates = [];
  const ports = {
    invoke: async (invocation) => {
      calls.push(invocation);
      return { node: CREATED_NODE };
    },
    createEdge: async (input) => {
      edgeCreates.push(input);
      return { ...CREATED_EDGE, id: `edge-${edgeCreates.length}` };
    },
    currentWorkspaceId: "workspace-1",
    openNodeEditor: (nodeId) => opened.push(nodeId),
    reportFailure: (failure) => reported.push(failure),
    ...overrides,
  };
  return { ports, calls, reported, opened, edgeCreates };
}

const operationIds = (calls) => calls.map((call) => call.operationId);

test("adding a node is one intent: add, semantic, position under one correlation id", async () => {
  const { ports, calls, opened, reported } = makePorts();

  const result = await addNode(ports, "text", "semantic-1", {
    simX: 10,
    simY: 20,
    viewId: "view-1",
  });

  assert.deepEqual(operationIds(calls), [
    "node.add",
    "node.setSemanticId",
    "node.setStateData",
  ]);
  assert.deepEqual(calls[0].target, {
    kind: "workspace",
    workspaceId: "workspace-1",
  });
  assert.deepEqual(calls[0].input, { nodeType: "text" });
  assert.deepEqual(calls[1].target, { kind: "node", nodeId: "node-created" });
  assert.deepEqual(calls[1].input, { semanticId: "semantic-1" });
  assert.deepEqual(calls[2].input, {
    stateData: {
      client: {
        position: [{ viewId: "view-1", x: 10, y: 20, mode: "force" }],
      },
      server: {},
    },
  });

  const correlationIds = new Set(calls.map((call) => call.correlationId));
  assert.equal(correlationIds.size, 1);
  const [correlationId] = correlationIds;
  assert.equal(typeof correlationId, "string");
  assert.ok(correlationId.length > 0);

  assert.equal(result.nodeId, "node-created");
  assert.deepEqual(result.failures, []);
  assert.deepEqual(opened, ["node-created"]);
  assert.deepEqual(reported, []);
});

test("a node created without semantics or position is a single node.add", async () => {
  const { ports, calls } = makePorts();

  const result = await addNode(ports, "rich-text", "");

  assert.deepEqual(operationIds(calls), ["node.add"]);
  assert.deepEqual(calls[0].input, { nodeType: "rich-text" });
  assert.equal(result.nodeId, "node-created");
});

test("a failing follow-up keeps the created node and reports it", async () => {
  const { ports, calls, opened, reported } = makePorts({
    invoke: async (invocation) => {
      calls.push(invocation);
      if (invocation.operationId === "node.setSemanticId") {
        throw new Error("VERSION_CONFLICT");
      }
      return { node: CREATED_NODE };
    },
  });

  const result = await addNode(ports, "text", "semantic-1");

  assert.equal(result.nodeId, "node-created");
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].operationId, "node.setSemanticId");
  assert.deepEqual(operationIds(calls), ["node.add", "node.setSemanticId"]);
  assert.deepEqual(opened, ["node-created"]);
  assert.equal(reported.length, 1);
  assert.ok(!operationIds(calls).includes("node.delete"));
});

test("a failed node.add writes nothing else and opens no editor", async () => {
  const { ports, calls, opened, reported } = makePorts({
    invoke: async (invocation) => {
      calls.push(invocation);
      throw new Error("SCHEMA_INVALID");
    },
  });

  const result = await addNode(ports, "text", "semantic-1");

  assert.equal(result.nodeId, null);
  assert.deepEqual(operationIds(calls), ["node.add"]);
  assert.deepEqual(opened, []);
  assert.equal(reported.length, 1);
});

test("no active workspace is reported instead of inventing a target", async () => {
  const { ports, calls, reported } = makePorts({ currentWorkspaceId: null });

  const result = await addNode(ports, "text", "semantic-1");

  assert.equal(result.nodeId, null);
  assert.deepEqual(calls, []);
  assert.equal(reported.length, 1);
  assert.equal(reported[0].operationId, "node.add");
});

test("deleting one edge is one edge.delete on that edge", async () => {
  const { ports, calls } = makePorts();

  await deleteEdge(ports, "edge-1");

  assert.deepEqual(operationIds(calls), ["edge.delete"]);
  assert.deepEqual(calls[0].target, { kind: "edge", edgeId: "edge-1" });
  assert.deepEqual(calls[0].input, {});
});

test("deleting a selection removes edges first, then nodes, under one correlation id", async () => {
  const { ports, calls } = makePorts();

  await deleteSelected(ports, ["node-1", "node-2"], ["edge-1"]);

  assert.deepEqual(operationIds(calls), [
    "edge.delete",
    "node.delete",
    "node.delete",
  ]);
  assert.deepEqual(calls[1].target, { kind: "node", nodeId: "node-1" });
  assert.deepEqual(calls[2].target, { kind: "node", nodeId: "node-2" });
  assert.equal(new Set(calls.map((call) => call.correlationId)).size, 1);
});

test("a failing delete does not stop the rest of the selection", async () => {
  const { ports, calls, reported } = makePorts({
    invoke: async (invocation) => {
      calls.push(invocation);
      if (
        invocation.operationId === "node.delete" &&
        invocation.target.nodeId === "node-1"
      ) {
        throw new Error("TARGET_NOT_FOUND");
      }
      return {};
    },
  });

  await deleteSelected(ports, ["node-1", "node-2"], []);

  assert.deepEqual(operationIds(calls), ["node.delete", "node.delete"]);
  assert.equal(reported.length, 1);
});

test("each field edit is its own operation, never a whole-node write", async () => {
  const { ports, calls } = makePorts();

  await changeNodeSemantic(ports, "node-1", "semantic-1");
  await changeEdgeSemantic(ports, "edge-1", "semantic-2");
  await changeEdgeDirection(ports, "edge-1", "bidirectional");

  assert.deepEqual(operationIds(calls), [
    "node.setSemanticId",
    "edge.setSemanticId",
    "edge.setDirection",
  ]);
  assert.deepEqual(calls[0].input, { semanticId: "semantic-1" });
  assert.deepEqual(calls[1].input, { semanticId: "semantic-2" });
  assert.deepEqual(calls[2].input, { direction: "bidirectional" });
});

test("an edge gesture with no target opens the add-edge menu and writes nothing", async () => {
  const { ports, calls, edgeCreates } = makePorts();
  const menus = [];

  const result = await createEdge(ports, ["node-1"], null, 12, 34, (menu) =>
    menus.push(menu),
  );

  assert.equal(result, null);
  assert.deepEqual(calls, []);
  assert.deepEqual(edgeCreates, []);
  assert.deepEqual(menus, [
    {
      x: 12,
      y: 34,
      type: "add-edge",
      context: { sourceIds: ["node-1"], targetId: null },
      visible: true,
    },
  ]);
});

test("creating edges writes one edge per source and opens the new edge menu", async () => {
  const { ports, edgeCreates } = makePorts();
  const menus = [];

  const result = await createEdge(
    ports,
    ["node-1", "node-2", "node-3"],
    "node-3",
    12,
    34,
    (menu) => menus.push(menu),
  );

  assert.deepEqual(edgeCreates, [
    { from: "node-1", to: "node-3", direction: "forward" },
    { from: "node-2", to: "node-3", direction: "forward" },
  ]);
  assert.equal(result, "edge-1");
  assert.deepEqual(menus, [
    {
      x: 12,
      y: 34,
      type: "edge",
      context: { edgeId: "edge-1" },
      visible: true,
    },
  ]);
});

test("a failed edge create is reported and leaves the menu closed", async () => {
  const { ports, reported } = makePorts({
    createEdge: async () => {
      throw new Error("OUT_OF_SCOPE");
    },
  });
  const menus = [];

  const result = await createEdge(ports, ["node-1"], "node-2", 12, 34, (menu) =>
    menus.push(menu),
  );

  assert.equal(result, null);
  assert.deepEqual(menus, []);
  assert.equal(reported.length, 1);
  assert.equal(reported[0].operationId, "edge.create");
});
