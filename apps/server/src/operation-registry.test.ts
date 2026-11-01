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
import { createServerOperationRegistry } from "./operation-registry.ts";

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
  ]) {
    assert.notEqual(registry.get(operationId), undefined, operationId);
  }
  assert.ok(registry.get("counter.increment"));
  // The four attach operations resolve a stored upload, so they are only bound
  // when the host composes a reader for them.
  for (const operationId of [
    "image.attachFile",
    "pdf.attachFile",
    "video.attachFile",
    "audio.attachFile",
  ]) {
    assert.equal(registry.get(operationId), undefined, operationId);
  }
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

test("an attach reads the stored upload instead of the client's address", async () => {
  const { port, recorded } = recorder();
  const registry = createServerOperationRegistry(
    () => port,
    undefined,
    () => attachmentReader(IMAGE_UPLOAD),
  );
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
      },
      userId: "user_alice",
      correlationId: "corr_1",
    },
  ]);
});

test("an attach refuses an upload the reader cannot resolve", async () => {
  const { port, recorded } = recorder();
  const registry = createServerOperationRegistry(
    () => port,
    undefined,
    () => attachmentReader(null),
  );

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
  const registry = createServerOperationRegistry(() => port);
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
  const registry = createServerOperationRegistry(() => port);

  assert.deepEqual(await registry.resolve("node.delete")({}, nodeContext()), {});
  assert.deepEqual(recorded.deleted, [
    { id: "node_1", userId: "user_alice", correlationId: "corr_1" },
  ]);
});
