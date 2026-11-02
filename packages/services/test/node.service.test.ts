// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import type { EdgeData, NodeData, View } from "@workspace/interfaces";
import { useDataStore, useWorkspaceStore } from "@workspace/store";
import {
  OperationInvokeError,
  type OperationInvokeBody,
  type OperationResult,
} from "@workspace/api-client";

import { EdgeService } from "../src/graph/edge.service";
import { NodeService } from "../src/graph/node.service";
import { ViewService } from "../src/graph/view.service";
import type { GraphOperationId } from "../src/graph/operations";

const NODE_ID = "node-1";
const EDGE_ID = "edge-1";
const VIEW_ID = "view-1";
const WORKSPACE_ID = "workspace-1";
const UPDATED_AT = "2026-11-01T00:00:00.000Z";

function textNode(title: string, updatedAt: string = UPDATED_AT): NodeData {
  return {
    id: NODE_ID,
    title,
    permission: "private",
    semanticId: "semantic-1",
    tags: [],
    isPinned: false,
    createdAt: UPDATED_AT,
    updatedAt,
    nodeType: "text",
    content: { docs: {} },
  };
}

function forwardEdge(
  direction: EdgeData["direction"],
  updatedAt: string = UPDATED_AT,
): EdgeData {
  return {
    id: EDGE_ID,
    from: NODE_ID,
    to: "node-2",
    direction,
    semanticId: "semantic-1",
    createdAt: UPDATED_AT,
    updatedAt,
  };
}

function forceView(visualConfig: View["visualConfig"]): View {
  return {
    id: VIEW_ID,
    name: "View",
    viewType: "Force",
    visualConfig,
    filterConfig: {},
    isPinned: false,
    isDefault: false,
  };
}

function result(
  operationId: string,
  resource: { node?: NodeData; edge?: EdgeData; view?: View },
  correlationId = "correlation-1",
): OperationResult {
  return {
    operationId,
    correlationId,
    output: {},
    eventIds: [],
    ...resource,
  } as unknown as OperationResult;
}

function clientError(code: string, message: string): Error {
  return Object.assign(new Error(`${code}: ${message}`), {
    data: { code },
  });
}

beforeEach(() => {
  useDataStore.getState().reset();
  useWorkspaceStore.getState().setCurrentWorkspaceId(WORKSPACE_ID);
});

describe("NodeService.invoke", () => {
  it("updates the store from the reply of exactly one operation.invoke", async () => {
    useDataStore.getState().upsertNode(textNode("Before"));
    const calls: OperationInvokeBody[] = [];

    await NodeService.setTitle(NODE_ID, "After", {
      invoker: async (body) => {
        calls.push(body);
        return result("node.setTitle", { node: textNode("After") });
      },
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.operationId, "node.setTitle");
    assert.deepEqual(calls[0]?.target, { kind: "node", nodeId: NODE_ID });
    assert.deepEqual(calls[0]?.input, { title: "After" });
    assert.equal(useDataStore.getState().nodes.get(NODE_ID)?.title, "After");
  });

  it("sends a create to the active workspace without a whole-record body", async () => {
    const calls: OperationInvokeBody[] = [];

    await NodeService.add("text", {
      invoker: async (body) => {
        calls.push(body);
        return result("node.add", { node: textNode("Untitled") });
      },
    });

    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0]?.target, {
      kind: "workspace",
      workspaceId: WORKSPACE_ID,
    });
    assert.deepEqual(calls[0]?.input, { nodeType: "text" });
    assert.equal(useDataStore.getState().nodes.get(NODE_ID)?.title, "Untitled");
  });

  it("surfaces VERSION_CONFLICT and writes nothing to the store", async () => {
    useDataStore.getState().upsertNode(textNode("Before"));
    let calls = 0;

    await assert.rejects(
      () =>
        NodeService.setTitle(NODE_ID, "After", {
          expectedVersion: "stale-version",
          invoker: async (body) => {
            calls += 1;
            assert.equal(body.expectedVersion, "stale-version");
            throw clientError(
              "VERSION_CONFLICT",
              'the record changed since expectedVersion of operation "node.setTitle" (correlationId: correlation-2)',
            );
          },
        }),
      (error: unknown) => {
        assert.ok(error instanceof OperationInvokeError);
        assert.equal(error.code, "VERSION_CONFLICT");
        assert.equal(error.correlationId, "correlation-2");
        return true;
      },
    );

    assert.equal(calls, 1);
    assert.equal(useDataStore.getState().nodes.get(NODE_ID)?.title, "Before");
  });

  it("surfaces OPERATION_NOT_FOUND for an unknown operation id", async () => {
    let calls = 0;

    await assert.rejects(
      () =>
        NodeService.invoke(
          "node.nope" as GraphOperationId,
          { kind: "node", nodeId: NODE_ID },
          {},
          {
            invoker: async () => {
              calls += 1;
              throw clientError(
                "OPERATION_NOT_FOUND",
                'operation "node.nope" is not registered (correlationId: correlation-3)',
              );
            },
          },
        ),
      (error: unknown) => {
        assert.ok(error instanceof OperationInvokeError);
        assert.equal(error.code, "OPERATION_NOT_FOUND");
        assert.equal(error.correlationId, "correlation-3");
        return true;
      },
    );

    assert.equal(calls, 1);
    assert.equal(useDataStore.getState().nodes.has(NODE_ID), false);
  });
});

describe("the edge and view adapters", () => {
  it("delegates an edge write to operation.invoke", async () => {
    useDataStore.getState().upsertEdge(forwardEdge("forward"));
    const calls: OperationInvokeBody[] = [];

    await EdgeService.setDirection(EDGE_ID, "reverse", {
      invoker: async (body) => {
        calls.push(body);
        return result("edge.setDirection", { edge: forwardEdge("reverse") });
      },
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.operationId, "edge.setDirection");
    assert.deepEqual(calls[0]?.target, { kind: "edge", edgeId: EDGE_ID });
    assert.deepEqual(calls[0]?.input, { direction: "reverse" });
    assert.equal(
      useDataStore.getState().edges.get(EDGE_ID)?.direction,
      "reverse",
    );
  });

  it("delegates a view write to operation.invoke", async () => {
    useDataStore.getState().upsertView(forceView({}));
    const calls: OperationInvokeBody[] = [];

    await ViewService.setLayout(
      VIEW_ID,
      { backgroundColor: "#000000" },
      {
        invoker: async (body) => {
          calls.push(body);
          return result("view.setLayout", {
            view: forceView({ backgroundColor: "#000000" }),
          });
        },
      },
    );

    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.operationId, "view.setLayout");
    assert.deepEqual(calls[0]?.target, { kind: "view", viewId: VIEW_ID });
    assert.deepEqual(calls[0]?.input, {
      visualConfig: { backgroundColor: "#000000" },
    });
    assert.deepEqual(useDataStore.getState().views.get(VIEW_ID)?.visualConfig, {
      backgroundColor: "#000000",
    });
  });
});

describe("monotonic snapshot application (IS-3)", () => {
  const NEWER_AT = "2026-11-01T00:00:03.000Z";
  const STALE_AT = "2026-11-01T00:00:01.000Z";

  const store = () => useDataStore.getState();
  const finalNode = (): NodeData | undefined => store().nodes.get(NODE_ID);
  const settled = (): NodeData => textNode("After", NEWER_AT);

  /** The reply of the write the user's intent produced. */
  const reply = (correlationId: string): OperationResult =>
    result("node.setTitle", { node: settled() }, correlationId);

  /** The refetch the matching domain event triggers (result-free delivery). */
  const eventRefetch = (): NodeData[] => [settled()];

  async function deliverResult(correlationId: string): Promise<void> {
    await NodeService.setTitle(NODE_ID, "After", {
      invoker: async () => reply(correlationId),
    });
  }

  it("converges under result-first, event-first, duplicate and reconnect orderings", async () => {
    const finals: (NodeData | undefined)[] = [];

    await deliverResult("correlation-result-first");
    store().upsertNodes(eventRefetch());
    finals.push(finalNode());
    store().reset();

    store().upsertNodes(eventRefetch());
    await deliverResult("correlation-event-first");
    finals.push(finalNode());
    store().reset();

    await deliverResult("correlation-duplicate");
    store().clearDiff();
    await deliverResult("correlation-duplicate");
    assert.equal(
      store().isDiffEmpty(),
      true,
      "a duplicate reply is not a second write",
    );
    store().upsertNodes(eventRefetch());
    store().upsertNodes(eventRefetch());
    finals.push(finalNode());
    store().reset();

    await deliverResult("correlation-replay");
    store().loadWorkspaceData({ nodes: eventRefetch() });
    store().upsertNodes(eventRefetch());
    finals.push(finalNode());

    for (const [index, node] of finals.entries()) {
      assert.deepEqual(
        node,
        settled(),
        `ordering ${index} ends at the served snapshot`,
      );
      assert.equal(
        node?.updatedAt,
        NEWER_AT,
        `ordering ${index} keeps the newer updatedAt`,
      );
    }
  });

  it("keeps the newer event snapshot when a stale result arrives afterwards", async () => {
    store().upsertNodes([textNode("Newer", NEWER_AT)]);

    await NodeService.setTitle(NODE_ID, "Stale", {
      invoker: async () =>
        result(
          "node.setTitle",
          { node: textNode("Stale", STALE_AT) },
          "correlation-stale",
        ),
    });

    assert.equal(finalNode()?.title, "Newer");
    assert.equal(finalNode()?.updatedAt, NEWER_AT);
  });

  it("ignores a stale edge snapshot and keeps the newer one", async () => {
    await EdgeService.setDirection(EDGE_ID, "reverse", {
      invoker: async () =>
        result(
          "edge.setDirection",
          { edge: forwardEdge("reverse", NEWER_AT) },
          "correlation-edge-newer",
        ),
    });
    await EdgeService.setDirection(EDGE_ID, "forward", {
      invoker: async () =>
        result(
          "edge.setDirection",
          { edge: forwardEdge("forward", STALE_AT) },
          "correlation-edge-stale",
        ),
    });

    assert.equal(store().edges.get(EDGE_ID)?.direction, "reverse");
    assert.equal(store().edges.get(EDGE_ID)?.updatedAt, NEWER_AT);
  });

  it("orders an unversioned view by delivery identity, because the server has no view version", () => {
    store().upsertView(
      forceView({ backgroundColor: "#111111" }),
      "correlation-b",
    );
    store().upsertView(
      forceView({ backgroundColor: "#222222" }),
      "correlation-a",
    );
    assert.deepEqual(store().views.get(VIEW_ID)?.visualConfig, {
      backgroundColor: "#111111",
    });

    store().upsertView(
      forceView({ backgroundColor: "#333333" }),
      "correlation-c",
    );
    assert.deepEqual(store().views.get(VIEW_ID)?.visualConfig, {
      backgroundColor: "#333333",
    });
  });
});
