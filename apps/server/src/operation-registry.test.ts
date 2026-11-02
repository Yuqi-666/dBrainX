// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The host composition: definitions from the plugin packages, handlers from
 * the application layer, served through the snapshot the plugin host swaps.
 *
 * The registry is what `operation.invoke` reads, so these cases assert the
 * properties that make an empty or half-bound registry impossible to miss: a
 * shipped package loads through the host, every operation it lists can be
 * resolved, the counter fixture is present without a static definition list in
 * the registry, and an operation this build does not implement refuses with a
 * named code instead of running nothing.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import type {
  CreateNodeCommand,
  DeleteNodeCommand,
  UpdateNodeCommand,
} from "../../../backend/application/src/commands/node/command.ts";
import type { NodeOperationPort } from "../../../backend/application/src/commands/operation/node-operation-handlers.ts";
import type { NodeDTO } from "../../../backend/application/src/dto/node.dto.ts";
import type {
  IStoredAttachmentReader,
  StoredAttachment,
} from "../../../backend/domain/src/ports/stored-attachment.ts";
import { createExecutionScope } from "../../../backend/domain/src/models/plugin/capability.ts";
import type { OperationContext } from "../../../backend/domain/src/ports/operation-context.ts";
import {
  createLivePluginRegistries,
  createPluginHost,
} from "../../../backend/plugin-host/src/index.ts";
import {
  OPERATION_NOT_IMPLEMENTED,
  createCounterOperationHandlers,
  createServerOperationHandlers,
  type AttachmentReaderProvider,
  type GraphOperationPortProvider,
} from "./operation-registry.ts";
import { createShippedPluginPackages } from "./plugin-packages.ts";

interface Recorded {
  readonly created: CreateNodeCommand[];
  readonly updated: UpdateNodeCommand[];
  readonly deleted: DeleteNodeCommand[];
}

function recorder(): { port: NodeOperationPort; recorded: Recorded } {
  const created: CreateNodeCommand[] = [];
  const updated: UpdateNodeCommand[] = [];
  const deleted: DeleteNodeCommand[] = [];
  const dto = (id: string) => ({ id }) as unknown as NodeDTO;
  return {
    recorded: { created, updated, deleted },
    port: {
      createNode: async (command) => {
        created.push(command);
        return dto("node_created");
      },
      updateNode: async (command) => {
        updated.push(command);
        return dto(command.id);
      },
      deleteNode: async (command) => {
        deleted.push(command);
      },
    },
  };
}

function graphStub(): GraphOperationPortProvider {
  const edge = { id: "edge_1" };
  const view = { id: "view_1" };
  return () => ({
    edges: {
      createEdge: async () => edge,
      updateEdge: async () => edge,
      deleteEdge: async () => undefined,
    },
    views: {
      createView: async () => view,
      updateView: async () => view,
      deleteView: async () => undefined,
    },
  });
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

function attachmentReader(
  facts: StoredAttachment | null,
): IStoredAttachmentReader {
  return { find: async () => facts };
}

const IMAGE_UPLOAD: StoredAttachment = {
  id: "rec_upload_1",
  url: "/api/files/files/rec_upload_1/photo_a1.png",
  fileName: "photo.png",
  fileSize: 2048,
  mimeType: "image/png",
  pageCount: 0,
  width: 640,
  height: 480,
  duration: 0,
  coverUrl: "",
  hlsUrl: "",
};

/** Load the shipped packages through the host, exactly as `index.ts` does. */
async function served(
  port: NodeOperationPort,
  options: {
    readonly attachments?: AttachmentReaderProvider;
    readonly graph?: GraphOperationPortProvider;
  } = {},
) {
  const packages = await createShippedPluginPackages({
    builtin: createServerOperationHandlers(
      () => port,
      options.graph ?? graphStub(),
      options.attachments ?? (() => attachmentReader(null)),
    ),
    counter: createCounterOperationHandlers(() => port),
  });
  const host = createPluginHost({ packages });
  await host.loadAll();
  const live = createLivePluginRegistries(host);
  return { host, live, registry: live.operations, nodeTypes: live.nodeTypes };
}

test("loads the shipped packages through the host and binds every listed operation", async () => {
  const { port } = recorder();
  const { registry, nodeTypes, live } = await served(port);

  assert.ok(live.revision() > 0);
  assert.ok(registry.list().length > 0);
  for (const definition of registry.list()) {
    assert.notEqual(
      registry.get(definition.id),
      undefined,
      `${definition.id} is listed without a handler`,
    );
  }
  for (const operationId of [
    "node.add",
    "node.setTitle",
    "node.setIcon",
    "node.clearIcon",
    "node.setCover",
    "node.clearCover",
    "node.setPermission",
    "node.addTag",
    "node.removeTag",
    "node.delete",
    "video.setCover",
    "website.setFavicon",
    "collection.setFilter",
    "webpage.replaceDocument",
    "counter.increment",
    "counter.tick",
  ]) {
    assert.notEqual(registry.get(operationId), undefined, operationId);
  }
  // The counter fixture reached the snapshot without a definition list in
  // `apps/server`; its type and operation are the same ones `node-type.list`
  // and `operation.list` answer from.
  assert.ok(nodeTypes.get("counter"));
  const forCounter = registry
    .listForNodeType("counter")
    .map((definition) => definition.id);
  assert.ok(forCounter.includes("counter.increment"));
  assert.ok(forCounter.includes("node.setTitle"));
  assert.ok(!forCounter.includes("node.add"));

  await assert.rejects(
    registry.resolve("text.setDocument")(
      { document: { type: "doc", content: [] }, expectedVersion: 1 },
      nodeContext(),
    ),
    (error: unknown) =>
      (error as { code?: string }).code === OPERATION_NOT_IMPLEMENTED,
  );
});

test("node.add takes the workspace and actor from the context, never from input", async () => {
  const { port, recorded } = recorder();
  const { registry } = await served(port);

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
  const { registry } = await served(port);

  await registry.resolve("node.setTitle")({ title: "Edited" }, nodeContext());

  assert.deepEqual(recorded.updated, [
    { id: "node_1", title: "Edited", userId: "user_alice", correlationId: "corr_1" },
  ]);
});

test("counter.increment applies the fixture rule to the reloaded snapshot", async () => {
  const { port, recorded } = recorder();
  const { registry } = await served(port);

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

test("an attach reads the stored upload instead of the client's address", async () => {
  const { port, recorded } = recorder();
  const { registry } = await served(port, {
    attachments: () => attachmentReader(IMAGE_UPLOAD),
  });
  assert.notEqual(registry.get("image.attachFile"), undefined);

  await registry.resolve("image.attachFile")(
    { uploadId: "rec_upload_1", url: "/api/files/files/forged/evil.png" },
    nodeContext({ url: "", width: 0, height: 0, fileSize: 0 }),
  );

  assert.deepEqual(recorded.updated, [
    {
      id: "node_1",
      content: {
        url: "/api/files/files/rec_upload_1/photo_a1.png",
        fileSize: 2048,
        width: 640,
        height: 480,
        source: "local",
      },
      userId: "user_alice",
      correlationId: "corr_1",
    },
  ]);
});

test("an attach refuses an upload the reader cannot resolve", async () => {
  const { port, recorded } = recorder();
  const { registry } = await served(port);

  await assert.rejects(
    registry.resolve("pdf.attachFile")(
      { uploadId: "rec_missing" },
      nodeContext({ url: "", fileSize: 0, pageCount: 0, coverUrl: "" }),
    ),
    /not a file the caller may attach/,
  );
  assert.deepEqual(recorded.updated, []);
});

test("a tag write adds and removes one value of the stored list", async () => {
  const { port, recorded } = recorder();
  const { registry } = await served(port);
  const context = { ...nodeContext(), node: { ...nodeContext().node!, tags: ["tag_a"] } };

  await registry.resolve("node.addTag")({ tag: "tag_b" }, context);
  await registry.resolve("node.removeTag")({ tag: "tag_a" }, context);
  await registry.resolve("node.addTag")({ tag: "tag_a" }, context);

  assert.deepEqual(
    recorded.updated.map((command) => command.tags),
    [["tag_a", "tag_b"], []],
  );
});

test("node.delete runs the command with the run's correlation id", async () => {
  const { port, recorded } = recorder();
  const { registry } = await served(port);

  assert.deepEqual(await registry.resolve("node.delete")({}, nodeContext()), {});
  assert.deepEqual(recorded.deleted, [
    { id: "node_1", userId: "user_alice", correlationId: "corr_1" },
  ]);
});
