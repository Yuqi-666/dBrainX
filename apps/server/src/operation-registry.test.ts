// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The host binding: definitions from the plugin packages, handlers from the
 * application layer.
 *
 * The registry is what `operation.invoke` reads, so these cases assert the two
 * properties that make an empty or half-bound registry impossible to miss
 * again: every operation it lists can actually run, and an operation it does
 * not bind answers `OPERATION_NOT_FOUND` instead of running nothing.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import type {
  CreateNodeCommand,
  UpdateNodeCommand,
} from "../../../backend/application/src/commands/node/command.ts";
import type { NodeOperationPort } from "../../../backend/application/src/commands/operation/node-operation-handlers.ts";
import type { NodeDTO } from "../../../backend/application/src/dto/node.dto.ts";
import { createExecutionScope } from "../../../backend/domain/src/models/plugin/capability.ts";
import type { OperationContext } from "../../../backend/domain/src/ports/operation-context.ts";
import { createServerOperationRegistry } from "./operation-registry.ts";

interface Recorded {
  readonly created: CreateNodeCommand[];
  readonly updated: UpdateNodeCommand[];
}

function recorder(): { port: NodeOperationPort; recorded: Recorded } {
  const created: CreateNodeCommand[] = [];
  const updated: UpdateNodeCommand[] = [];
  const dto = (id: string) => ({ id }) as unknown as NodeDTO;
  return {
    recorded: { created, updated },
    port: {
      createNode: async (command) => {
        created.push(command);
        return dto("node_created");
      },
      updateNode: async (command) => {
        updated.push(command);
        return dto(command.id);
      },
    },
  };
}

function nodeContext(content: unknown = {}): OperationContext {
  return {
    actor: { kind: "user", userId: "user_alice" },
    workspaceId: "ws_1",
    scope: createExecutionScope({ kind: "workspace", workspaceId: "ws_1" }),
    target: { kind: "node", nodeId: "node_1" },
    correlationId: "corr_1",
    node: {
      id: "node_1",
      nodeType: "counter",
      workspaceId: "ws_1",
      title: "",
      permission: "private",
      semanticId: "node:node_1",
      tags: [],
      isPinned: false,
      content,
      typeVersion: 1,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  };
}

function workspaceContext(): OperationContext {
  return {
    actor: { kind: "user", userId: "user_alice" },
    workspaceId: "ws_1",
    scope: createExecutionScope({ kind: "workspace", workspaceId: "ws_1" }),
    target: { kind: "workspace", workspaceId: "ws_1" },
    correlationId: "corr_add",
  };
}

test("binds every listed operation and refuses the ones this build cannot run", () => {
  const { port } = recorder();
  const registry = createServerOperationRegistry(() => port);

  for (const definition of registry.list()) {
    assert.notEqual(
      registry.get(definition.id),
      undefined,
      `${definition.id} is listed without a handler`,
    );
  }
  assert.ok(registry.get("node.add"));
  assert.ok(registry.get("node.setTitle"));
  assert.ok(registry.get("counter.increment"));
  assert.equal(registry.get("node.setPermission"), undefined);
  assert.throws(
    () => registry.resolve("text.setDocument"),
    (error: unknown) =>
      error instanceof Error && error.name === "OperationRegistryError",
  );
  const forCounter = registry
    .listForNodeType("counter")
    .map((definition) => definition.id);
  assert.ok(forCounter.includes("counter.increment"));
  assert.ok(forCounter.includes("node.setTitle"));
  assert.ok(!forCounter.includes("node.add"));
  assert.ok(!forCounter.includes("text.setDocument"));
});

test("node.add takes the workspace and actor from the context, never from input", async () => {
  const { port, recorded } = recorder();
  const registry = createServerOperationRegistry(() => port);

  const output = await registry.resolve("node.add")(
    { nodeType: "counter", workspaceId: "ws_other", userId: "user_mallory" },
    workspaceContext(),
  );

  assert.deepEqual(output, { nodeId: "node_created" });
  assert.deepEqual(recorded.created, [
    {
      nodeType: "counter",
      workspaceId: "ws_1",
      userId: "user_alice",
      correlationId: "corr_add",
    },
  ]);
});

test("a metadata operation writes one patch and shares the run's correlation id", async () => {
  const { port, recorded } = recorder();
  const registry = createServerOperationRegistry(() => port);

  await registry.resolve("node.setTitle")({ title: "Edited" }, nodeContext());

  assert.deepEqual(recorded.updated, [
    { id: "node_1", title: "Edited", userId: "user_alice", correlationId: "corr_1" },
  ]);
});

test("counter.increment applies the fixture rule to the reloaded snapshot", async () => {
  const { port, recorded } = recorder();
  const registry = createServerOperationRegistry(() => port);

  const output = await registry.resolve("counter.increment")(
    { by: 5 },
    nodeContext({ value: 2 }),
  );

  assert.deepEqual(output, { nodeId: "node_1" });
  assert.deepEqual(recorded.updated, [
    {
      id: "node_1",
      content: { value: 7 },
      userId: "user_alice",
      correlationId: "corr_1",
    },
  ]);
});
