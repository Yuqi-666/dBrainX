// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The write half of the attribute panel and the editor header, run against the
 * real service and the real store.
 *
 * `packages/ui` test files normally run under `node --test` with type
 * stripping, and that resolver rejects the workspace packages' extensionless
 * imports. This file therefore bundles the module under test with esbuild into
 * a temporary file and imports that bundle — the same recipe
 * `packages/services/test/run.mjs` uses. What runs is the real `NodeService` and
 * the real data store; `options.invoker` replaces only the transport call, at
 * the seam the service documents for tests.
 */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";
import type { NodeData } from "@workspace/interfaces";
import type {
  OperationInvokeBody,
  OperationResult,
} from "@workspace/api-client";
import type { NodeAttributeField } from "@workspace/plugin-sdk/ui";

import type {
  AttributeOperationOutcome,
  AttributeOperationRequest,
} from "./attribute-operations.ts";

const NODE_ID = "node-1";
const UPDATED_AT = "2026-11-01T00:00:00.000Z";
const LIB_DIR = fileURLToPath(new URL("./", import.meta.url));

const ENTRY = [
  'export * from "./attribute-operations.ts";',
  'export { useDataStore } from "@workspace/store";',
].join("\n");

interface DataStoreState {
  nodes: Map<string, NodeData>;
  reset: () => void;
  upsertNode: (node: NodeData) => void;
}

interface RuntimeModule {
  attributeFieldRequest: (
    nodeId: string,
    field: NodeAttributeField,
    value: string,
  ) => AttributeOperationRequest;
  titleRequest: (nodeId: string, title: string) => AttributeOperationRequest;
  abstractRequest: (
    nodeId: string,
    abstract: string,
  ) => AttributeOperationRequest;
  semanticRequest: (
    nodeId: string,
    semanticId: string,
  ) => AttributeOperationRequest;
  tagRequest: (
    nodeId: string,
    tagId: string,
    applied: boolean,
  ) => AttributeOperationRequest;
  runAttributeOperation: (
    request: AttributeOperationRequest,
    options?: { invoker?: (body: OperationInvokeBody) => Promise<OperationResult> },
  ) => Promise<AttributeOperationOutcome>;
  useDataStore: { getState: () => DataStoreState };
}

let outDir = "";
let runtime: RuntimeModule;

before(async () => {
  outDir = await mkdtemp(join(tmpdir(), "ui-attribute-operations-"));
  const outfile = join(outDir, "attribute-operations.mjs");
  await build({
    stdin: { contents: ENTRY, resolveDir: LIB_DIR, loader: "ts" },
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    outfile,
    logLevel: "warning",
  });
  runtime = (await import(pathToFileURL(outfile).href)) as RuntimeModule;
});

after(async () => {
  await rm(outDir, { recursive: true, force: true });
});

beforeEach(() => {
  runtime.useDataStore.getState().reset();
});

function videoNode(): NodeData {
  return {
    id: NODE_ID,
    title: "Clip",
    permission: "private",
    semanticId: "semantic-1",
    tags: [],
    isPinned: false,
    createdAt: UPDATED_AT,
    updatedAt: UPDATED_AT,
    nodeType: "video",
    content: { url: "/files/a.mp4", coverUrl: "", timestamps: [] },
  } as unknown as NodeData;
}

function reply(operationId: string, node: NodeData): OperationResult {
  return {
    operationId,
    correlationId: "correlation-1",
    output: {},
    eventIds: [],
    node,
  } as unknown as OperationResult;
}

function contentOf(nodeId: string): Record<string, unknown> {
  return runtime.useDataStore.getState().nodes.get(nodeId)?.content as Record<
    string,
    unknown
  >;
}

function fieldOf(overrides: Partial<NodeAttributeField>): NodeAttributeField {
  return {
    field: "coverUrl",
    label: "封面",
    kind: "cover",
    ...overrides,
  };
}

describe("a descriptor field edit", () => {
  it("issues the declared operation id with that operation's own input", async () => {
    runtime.useDataStore.getState().upsertNode(videoNode());
    const calls: OperationInvokeBody[] = [];
    const updated = videoNode();
    updated.content = {
      ...(updated.content as Record<string, unknown>),
      coverUrl: "/files/cover.png",
    } as NodeData["content"];

    const outcome = await runtime.runAttributeOperation(
      runtime.attributeFieldRequest(
        NODE_ID,
        fieldOf({ operationId: "video.setCover" }),
        "/files/cover.png",
      ),
      {
        invoker: async (body) => {
          calls.push(body);
          return reply("video.setCover", updated);
        },
      },
    );

    assert.deepEqual(calls, [
      {
        operationId: "video.setCover",
        target: { kind: "node", nodeId: NODE_ID },
        input: { coverUrl: "/files/cover.png" },
      },
    ]);
    assert.deepEqual(outcome, { ok: true, operationId: "video.setCover" });
    assert.equal(
      contentOf(NODE_ID).coverUrl,
      "/files/cover.png",
      "the store takes the reply's canonical snapshot, so the service really ran",
    );
  });

  it("builds a select field's input from its dotted path", async () => {
    runtime.useDataStore.getState().upsertNode(videoNode());
    const calls: OperationInvokeBody[] = [];

    const outcome = await runtime.runAttributeOperation(
      runtime.attributeFieldRequest(
        NODE_ID,
        fieldOf({
          field: "filterConfig.collectionType",
          kind: "select",
          operationId: "collection.setFilter",
        }),
        "cards",
      ),
      {
        invoker: async (body) => {
          calls.push(body);
          return reply("collection.setFilter", videoNode());
        },
      },
    );

    assert.equal(outcome.ok, true);
    assert.deepEqual(calls[0]?.input, {
      filterConfig: { collectionType: "cards" },
    });
    assert.equal("updates" in (calls[0] ?? {}), false);
  });
});

describe("a field that declares no operation", () => {
  it("is refused instead of patching the node", async () => {
    runtime.useDataStore.getState().upsertNode(videoNode());
    const calls: OperationInvokeBody[] = [];

    const outcome = await runtime.runAttributeOperation(
      runtime.attributeFieldRequest(
        NODE_ID,
        fieldOf({ field: "url", kind: "url", operationId: undefined }),
        "/files/b.mp4",
      ),
      {
        invoker: async (body) => {
          calls.push(body);
          return reply("node.setTitle", videoNode());
        },
      },
    );

    assert.deepEqual(calls, [], "no request is sent for a field with no operation");
    assert.equal(outcome.ok, false);
    assert.equal(outcome.ok === false && outcome.code, "OPERATION_NOT_DECLARED");
    assert.deepEqual(
      runtime.useDataStore.getState().nodes.get(NODE_ID)?.content,
      videoNode().content,
      "the local value is not merged into the node",
    );
  });
});

describe("a refused operation", () => {
  it("reports the server's code and leaves the store unchanged", async () => {
    runtime.useDataStore.getState().upsertNode(videoNode());
    const before = runtime.useDataStore.getState().nodes.get(NODE_ID);

    const outcome = await runtime.runAttributeOperation(
      runtime.attributeFieldRequest(
        NODE_ID,
        fieldOf({ operationId: "video.setCover" }),
        "/files/cover.png",
      ),
      {
        invoker: async () => {
          throw Object.assign(
            new Error("FORBIDDEN: only the owner may write this node"),
            { data: { code: "FORBIDDEN" } },
          );
        },
      },
    );

    assert.equal(outcome.ok, false);
    assert.equal(outcome.ok === false && outcome.code, "FORBIDDEN");
    assert.deepEqual(
      runtime.useDataStore.getState().nodes.get(NODE_ID),
      before,
      "a refused invoke writes nothing, so the control shows the stored value",
    );
  });
});

describe("the header and metadata fields", () => {
  it("name one operation each, with the field's own input key", () => {
    assert.deepEqual(runtime.titleRequest(NODE_ID, "Renamed"), {
      nodeId: NODE_ID,
      operationId: "node.setTitle",
      input: { title: "Renamed" },
    });
    assert.deepEqual(runtime.abstractRequest(NODE_ID, "摘要"), {
      nodeId: NODE_ID,
      operationId: "node.setAbstract",
      input: { abstract: "摘要" },
    });
    assert.deepEqual(runtime.semanticRequest(NODE_ID, "semantic-2"), {
      nodeId: NODE_ID,
      operationId: "node.setSemanticId",
      input: { semanticId: "semantic-2" },
    });
    assert.deepEqual(runtime.tagRequest(NODE_ID, "tag-1", false), {
      nodeId: NODE_ID,
      operationId: "node.addTag",
      input: { tag: "tag-1" },
    });
    assert.deepEqual(runtime.tagRequest(NODE_ID, "tag-1", true), {
      nodeId: NODE_ID,
      operationId: "node.removeTag",
      input: { tag: "tag-1" },
    });
  });

  it("sends an abstract edit as node.setAbstract and nothing else", async () => {
    runtime.useDataStore.getState().upsertNode(videoNode());
    const calls: OperationInvokeBody[] = [];
    const updated = videoNode();
    updated.abstract = "摘要";

    const outcome = await runtime.runAttributeOperation(
      runtime.abstractRequest(NODE_ID, "摘要"),
      {
        invoker: async (body) => {
          calls.push(body);
          return reply("node.setAbstract", updated);
        },
      },
    );

    assert.equal(outcome.ok, true);
    assert.deepEqual(calls[0], {
      operationId: "node.setAbstract",
      target: { kind: "node", nodeId: NODE_ID },
      input: { abstract: "摘要" },
    });
    assert.equal(
      runtime.useDataStore.getState().nodes.get(NODE_ID)?.abstract,
      "摘要",
    );
  });
});
