// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The media attach path of an upload, run against the real service and the real
 * store (plan item 41).
 *
 * `packages/ui` test files normally run under `node --test` with type stripping,
 * and that resolver rejects the workspace packages' extensionless imports. This
 * file therefore bundles the module under test with esbuild into a temporary
 * file and imports that bundle — the same recipe
 * `attribute-operations.test.ts` uses. What runs is the real `NodeService` and
 * the real data store; `options.invoker` replaces only the transport call, at
 * the seam the service documents for tests.
 *
 * What matters here: a completed upload names exactly one operation for its
 * media type and sends nothing but the upload id, and a refused attach writes
 * nothing — the node never ends up with a file address and zeroed measurements.
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

import type { MediaAttachOutcome, MediaType } from "./media-attach.ts";

const NODE_ID = "node-1";
const UPLOAD_ID = "upload-1";
const UPDATED_AT = "2026-11-01T00:00:00.000Z";
const LIB_DIR = fileURLToPath(new URL("./", import.meta.url));

const ENTRY = [
  'export * from "./media-attach.ts";',
  'export { useDataStore } from "@workspace/store";',
].join("\n");

interface DataStoreState {
  nodes: Map<string, NodeData>;
  reset: () => void;
  upsertNode: (node: NodeData) => void;
}

interface RuntimeModule {
  MEDIA_ATTACH_OPERATIONS: Record<MediaType, string>;
  MEDIA_TYPE_NOT_ATTACHABLE: string;
  attachOperationFor: (mediaType: string) => string | undefined;
  attachMediaFile: (
    request: { nodeId: string; mediaType: string; uploadId: string },
    options?: {
      invoker?: (body: OperationInvokeBody) => Promise<OperationResult>;
    },
  ) => Promise<MediaAttachOutcome>;
  useDataStore: { getState: () => DataStoreState };
}

let outDir = "";
let runtime: RuntimeModule;

before(async () => {
  outDir = await mkdtemp(join(tmpdir(), "ui-media-attach-"));
  const outfile = join(outDir, "media-attach.mjs");
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

/** The draft content each media type starts from, before any file is attached. */
const DRAFT_CONTENT: Record<MediaType, Record<string, unknown>> = {
  image: { url: "" },
  pdf: { url: "", coverUrl: "" },
  video: { url: "", coverUrl: "", timestamps: [] },
  audio: { url: "", timestamps: [] },
};

/** What the server reads off the stored file: the facts the client never sends. */
const SERVER_METADATA: Record<MediaType, Record<string, unknown>> = {
  image: { fileSize: 2048, width: 640, height: 480 },
  pdf: { fileSize: 4096, pageCount: 7 },
  video: { fileSize: 8192, duration: 12.5 },
  audio: { fileSize: 1024, duration: 3.25 },
};

const CASES: readonly { mediaType: MediaType; operationId: string }[] = [
  { mediaType: "image", operationId: "image.attachFile" },
  { mediaType: "pdf", operationId: "pdf.attachFile" },
  { mediaType: "video", operationId: "video.attachFile" },
  { mediaType: "audio", operationId: "audio.attachFile" },
];

function draftNode(mediaType: MediaType): NodeData {
  return {
    id: NODE_ID,
    title: "Draft",
    permission: "private",
    semanticId: "semantic-1",
    tags: [],
    isPinned: false,
    createdAt: UPDATED_AT,
    updatedAt: UPDATED_AT,
    nodeType: mediaType,
    fileSize: 0,
    content: DRAFT_CONTENT[mediaType],
  } as unknown as NodeData;
}

/** The snapshot the server would reload after attaching the stored file. */
function attachedNode(mediaType: MediaType): NodeData {
  return {
    ...draftNode(mediaType),
    ...SERVER_METADATA[mediaType],
    content: { ...DRAFT_CONTENT[mediaType], url: "/api/files/files/r1/clip" },
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

describe("a completed upload", () => {
  for (const { mediaType, operationId } of CASES) {
    it(`attaches ${mediaType} through ${operationId} with only the upload id`, async () => {
      runtime.useDataStore.getState().upsertNode(draftNode(mediaType));
      const calls: OperationInvokeBody[] = [];

      const outcome = await runtime.attachMediaFile(
        { nodeId: NODE_ID, mediaType, uploadId: UPLOAD_ID },
        {
          invoker: async (body) => {
            calls.push(body);
            return reply(operationId, attachedNode(mediaType));
          },
        },
      );

      assert.deepEqual(
        calls,
        [
          {
            operationId,
            target: { kind: "node", nodeId: NODE_ID },
            input: { uploadId: UPLOAD_ID },
          },
        ],
        "one invoke, and the input carries the upload id and nothing else",
      );
      assert.equal(outcome.ok, true);
      assert.equal(outcome.ok === true && outcome.operationId, operationId);

      const stored = runtime.useDataStore.getState().nodes.get(NODE_ID);
      assert.deepEqual(
        { ...stored, content: undefined },
        { ...attachedNode(mediaType), content: undefined },
        "the store takes the reply's canonical snapshot, measurements included",
      );
      assert.equal(
        (stored?.content as Record<string, unknown> | undefined)?.url,
        "/api/files/files/r1/clip",
        "the file address comes from the server, never from the picked File",
      );
    });
  }

  it("maps every media type through one table", () => {
    assert.deepEqual(runtime.MEDIA_ATTACH_OPERATIONS, {
      image: "image.attachFile",
      pdf: "pdf.attachFile",
      video: "video.attachFile",
      audio: "audio.attachFile",
    });
  });
});

describe("a media type with no attach operation", () => {
  it("is refused without sending a request", async () => {
    runtime.useDataStore.getState().upsertNode(draftNode("image"));
    const calls: OperationInvokeBody[] = [];

    const outcome = await runtime.attachMediaFile(
      { nodeId: NODE_ID, mediaType: "text", uploadId: UPLOAD_ID },
      {
        invoker: async (body) => {
          calls.push(body);
          return reply("node.setTitle", draftNode("image"));
        },
      },
    );

    assert.deepEqual(calls, [], "no catch-all branch guesses an operation id");
    assert.equal(
      runtime.attachOperationFor("text"),
      undefined,
      "an unknown type has no row, so it has no operation",
    );
    assert.equal(outcome.ok, false);
    assert.equal(
      outcome.ok === false && outcome.code,
      runtime.MEDIA_TYPE_NOT_ATTACHABLE,
    );
  });
});

describe("a refused attach", () => {
  it("reports the server's code and leaves the node untouched", async () => {
    const draft = draftNode("video");
    runtime.useDataStore.getState().upsertNode(draft);

    const outcome = await runtime.attachMediaFile(
      { nodeId: NODE_ID, mediaType: "video", uploadId: UPLOAD_ID },
      {
        invoker: async () => {
          throw Object.assign(
            new Error(
              "OPERATION_NOT_FOUND: video.attachFile has no handler in this build",
            ),
            { data: { code: "NOT_FOUND" } },
          );
        },
      },
    );

    assert.equal(outcome.ok, false);
    assert.equal(outcome.ok === false && outcome.code, "OPERATION_NOT_FOUND");
    assert.deepEqual(
      runtime.useDataStore.getState().nodes.get(NODE_ID),
      draft,
      "a refused attach writes nothing: no file address, no zeroed measurements",
    );
  });
});
