// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Every builtin node type, walked through `operation.invoke` end to end.
 *
 * Plan row 32 requires one regression per builtin type: create, retitle, tag,
 * write the view state, attach a stored upload (media) or read the payload back
 * (everything else), then delete. Row 101 found that regression missing, so this
 * file is that regression and nothing else.
 *
 * What is real here:
 *
 * - the served registry, built by the plugin host from the shipped
 *   `plugin.json` files and the operation definitions they export
 *   (`createShippedPluginPackages` + `createLivePluginRegistries`);
 * - the handlers the server binds in production (`createServerOperationHandlers`,
 *   i.e. `createNodeOperationHandlers` over the node command service);
 * - the tRPC `operation.invoke` contract: every step is a tRPC caller built
 *   from `operationInvokeSchema` and the shipped `invokeOperation`, exactly like
 *   `backend/adapter-front/src/trpc/router/operation.test.ts`;
 * - the capability gateway, the run ledger and `OperationService`.
 *
 * What is a double: storage. Nodes live in an in-memory repository whose
 * `save` mimics the PocketBase repository's `tmp_` create signal, and the
 * stored upload reader answers with the fixture bytes below. Neither double
 * replaces `operation.invoke`; both sit under it.
 *
 * A step that answers an error code fails the case: the tRPC caller throws, and
 * `step` also refuses a result that carries an `error`/`code` field or a
 * different operation id. A skipped case is caught by the final guard, which
 * asserts every one of the ten cases actually ran.
 */
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { after, before, describe, it } from "node:test";
import type { TestContext } from "node:test";

import { initTRPC } from "@trpc/server";

import { OperationService } from "../../../backend/application/src/commands/operation/operation.service.ts";
import type { OperationResult } from "../../../backend/application/src/commands/operation/operation-result.ts";
import type { NodeOperationPort } from "../../../backend/application/src/commands/operation/node-operation-handlers.ts";
import { NodeCommandService } from "../../../backend/application/src/commands/node/node-command.service.ts";
import { CapabilityGateway } from "../../../backend/application/src/engine/capability-gateway.ts";
import { createNodeAccessPolicy } from "../../../backend/application/src/engine/adapters/node-access.adapter.ts";
import { createWorkspaceAccessPolicy } from "../../../backend/application/src/engine/adapters/workspace-access.adapter.ts";
import { Node } from "../../../backend/domain/src/models/node/entities.ts";
import {
  NodeId,
  type Permission,
} from "../../../backend/domain/src/models/node/base-values.ts";
import type { NodeTypeDefinition } from "../../../backend/domain/src/models/node-type/definition.ts";
import type { EventEnvelope } from "../../../backend/domain/src/event-bus/envelope.ts";
import type {
  EventDraft,
  IEventPublisher,
} from "../../../backend/domain/src/ports/event-publisher.ts";
import type { IEdgeRepository } from "../../../backend/domain/src/repositories/edge.repository.ts";
import type { INodeRepository } from "../../../backend/domain/src/repositories/node.repository.ts";
import type { OperationRun } from "../../../backend/domain/src/repositories/operation-run.repository.ts";
import type {
  IWorkspaceMemberRepository,
  IWorkspaceRepository,
} from "../../../backend/domain/src/repositories/workspace.repository.ts";
import type {
  IStoredAttachmentReader,
  StoredAttachment,
} from "../../../backend/domain/src/ports/stored-attachment.ts";
import {
  createLivePluginRegistries,
  createPluginHost,
} from "../../../backend/plugin-host/src/index.ts";
import type { LivePluginRegistries } from "../../../backend/plugin-host/src/live-registry.ts";
import { createProcessOperationRunStore } from "../../../backend/adapter-front/src/di/operation-run-store.ts";
import {
  invokeOperation,
  operationInvokeSchema,
} from "../../../backend/adapter-front/src/trpc/router/operation-invoke.ts";
import type {
  OperationInvokeBody,
  OperationRouteContext,
} from "../../../backend/adapter-front/src/trpc/router/operation-invoke.ts";
import {
  createCounterOperationHandlers,
  createServerOperationHandlers,
} from "./operation-registry.ts";
import type { GraphOperationPortProvider } from "./operation-registry.ts";
import { createShippedPluginPackages } from "./plugin-packages.ts";

const WORKSPACE_ID = "workspace-alice";
const OWNER_ID = "user-owner";
const NOW = "2026-11-03T00:00:00.000Z";

/** The ten builtin ids, in the product order `node-types.ts` declares. */
const BUILTIN_TYPES = [
  "text",
  "rich-text",
  "image",
  "pdf",
  "video",
  "audio",
  "webpage",
  "website",
  "collection",
  "database",
] as const;

type BuiltinType = (typeof BUILTIN_TYPES)[number];

/**
 * The media types own a `*.attachFile` operation; every other type is read
 * back from the canonical node the invoke reply already carries.
 */
const ATTACH_OPERATION: Readonly<Partial<Record<BuiltinType, string>>> = {
  image: "image.attachFile",
  pdf: "pdf.attachFile",
  video: "video.attachFile",
  audio: "audio.attachFile",
  webpage: "webpage.attachFile",
};

const TITLE = "Regression title";
const TAG = "regression";
const STATE_DATA = { client: { x: 12, y: 34 }, server: { collapsed: false } };

/** A 1x1 PNG: the upload has real bytes, not only a made-up size. */
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const PDF_BYTES = Buffer.from(
  "%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n",
  "utf8",
);
const MP4_BYTES = Buffer.from(
  "\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00mp42isom",
  "utf8",
);
const MP3_BYTES = Buffer.from("ID3\x03\x00\x00\x00\x00\x00\x00", "utf8");
const HTML_BYTES = Buffer.from(
  "<!doctype html><html><body>fixture</body></html>\n",
  "utf8",
);

/**
 * The stored upload results the attach operations read back by id (§4.3.4).
 *
 * `fileSize` is the fixture buffer's length, so a handler that trusts a
 * client-supplied size instead of the record would not match.
 */
const ATTACHMENTS: Readonly<Record<string, StoredAttachment>> = {
  "upload-image": {
    id: "upload-image",
    url: "/api/files/files/rec_image_1/photo.png",
    fileName: "photo.png",
    fileSize: PNG_BYTES.byteLength,
    mimeType: "image/png",
    pageCount: 0,
    width: 1,
    height: 1,
    duration: 0,
    coverUrl: "",
    hlsUrl: "",
  },
  "upload-pdf": {
    id: "upload-pdf",
    url: "/api/files/files/rec_pdf_1/paper.pdf",
    fileName: "paper.pdf",
    fileSize: PDF_BYTES.byteLength,
    mimeType: "application/pdf",
    pageCount: 3,
    width: 0,
    height: 0,
    duration: 0,
    coverUrl: "/api/files/files/rec_pdf_1/paper.cover.png",
    hlsUrl: "",
  },
  "upload-video": {
    id: "upload-video",
    url: "/api/files/files/rec_video_1/clip.mp4",
    fileName: "clip.mp4",
    fileSize: MP4_BYTES.byteLength,
    mimeType: "video/mp4",
    pageCount: 0,
    width: 1920,
    height: 1080,
    duration: 12.5,
    coverUrl: "/api/files/files/rec_video_1/clip.cover.jpg",
    hlsUrl: "/api/files/files/rec_video_1/clip.m3u8",
  },
  "upload-audio": {
    id: "upload-audio",
    url: "/api/files/files/rec_audio_1/take.mp3",
    fileName: "take.mp3",
    fileSize: MP3_BYTES.byteLength,
    mimeType: "audio/mpeg",
    pageCount: 0,
    width: 0,
    height: 0,
    duration: 42,
    coverUrl: "/api/files/files/rec_audio_1/take.cover.jpg",
    hlsUrl: "",
  },
  "upload-webpage": {
    id: "upload-webpage",
    url: "/api/files/files/rec_webpage_1/page.html",
    fileName: "page.html",
    fileSize: HTML_BYTES.byteLength,
    mimeType: "text/html",
    pageCount: 0,
    width: 0,
    height: 0,
    duration: 0,
    coverUrl: "",
    hlsUrl: "",
  },
};

/** Top-level facts the DTO must carry back from the stored record. */
const ATTACHED_FACTS: Readonly<
  Partial<Record<BuiltinType, Readonly<Record<string, unknown>>>>
> = {
  image: { width: 1, height: 1, fileSize: PNG_BYTES.byteLength },
  pdf: { pageCount: 3, fileSize: PDF_BYTES.byteLength },
  video: { duration: 12.5, fileSize: MP4_BYTES.byteLength },
  audio: { duration: 42, fileSize: MP3_BYTES.byteLength },
  webpage: { fileSize: HTML_BYTES.byteLength },
};

/** Payload keys the attach handler writes into `content` for that type. */
const ATTACHED_CONTENT: Readonly<
  Partial<Record<BuiltinType, readonly string[]>>
> = {
  image: ["url"],
  pdf: ["url", "coverUrl"],
  video: ["url", "coverUrl", "hlsUrl"],
  audio: ["url", "coverUrl"],
  webpage: ["url"],
};

const workspaceRow = {
  id: { value: WORKSPACE_ID },
  ownerId: OWNER_ID,
};

const workspaces = {
  async findById(id: { value: string }) {
    return id.value === WORKSPACE_ID ? workspaceRow : null;
  },
} as unknown as IWorkspaceRepository;

/** The owner comes from the workspace row; no member row is needed. */
const members = {
  async findByWorkspaceAndUser() {
    return null;
  },
} as unknown as IWorkspaceMemberRepository;

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

interface Harness {
  readonly invoke: (body: OperationInvokeBody) => Promise<OperationResult>;
  readonly nodes: Map<string, Node>;
  readonly live: LivePluginRegistries;
  readonly runs: ReturnType<typeof createProcessOperationRunStore>;
  readonly close: () => Promise<void>;
}

/**
 * Builds the served registry, the shipped handlers and the invoke contract.
 *
 * The handler table is built before the host loads (the host asks for one
 * handler per definition) and resolves the command service lazily: the service
 * needs the node-type registry, which only exists after the host's snapshot is
 * built.
 */
async function startHarness(): Promise<Harness> {
  const nodes = new Map<string, Node>();
  let assigned = 0;

  const repository = {
    async findById(id: { value: string }) {
      return nodes.get(id.value) ?? null;
    },
    async save(node: Node) {
      if (!node.id.value.startsWith("tmp_")) {
        nodes.set(node.id.value, node);
        return node;
      }
      assigned += 1;
      // The PocketBase repository assigns the id on create; the fake does the
      // same so the sequence used here is the one a real store produces.
      const persisted = Node.create({
        id: new NodeId(`node_${assigned}`),
        title: node.title,
        abstract: node.abstract,
        permission: node.permission as Permission,
        semanticId: node.semanticId,
        tags: node.tags,
        isPinned: node.isPinned,
        stateData: node.stateData,
        icon: node.icon ?? null,
        cover: node.cover ?? null,
        workspaceId: node.workspaceId,
        nodeType: node.nodeType,
        typeVersion: node.typeVersion,
        content: node.content,
        media: node.media,
        createdAt: node.createdAt,
        updatedAt: node.updatedAt,
      });
      nodes.set(persisted.id.value, persisted);
      return persisted;
    },
    async delete(id: { value: string }) {
      nodes.delete(id.value);
    },
  } as unknown as INodeRepository;

  const edges = {
    async findByNodeId() {
      return [];
    },
    async deleteMany() {
      return undefined;
    },
  } as unknown as IEdgeRepository;

  const published: EventEnvelope[] = [];
  const publisher: IEventPublisher = {
    async publish<T>(draft: EventDraft<T>): Promise<EventEnvelope<T>> {
      const envelope: EventEnvelope<T> = {
        ...draft,
        eventId: `event_${published.length + 1}`,
        eventVersion: 1,
        occurredAt: NOW,
        sequence: published.length + 1,
        workspaceSequence: published.length + 1,
      };
      published.push(envelope);
      return envelope;
    },
  };

  const holder: { current?: NodeCommandService } = {};
  const port: () => NodeOperationPort = () => {
    if (holder.current === undefined) {
      throw new Error("the node command service is used before the host loaded");
    }
    return holder.current;
  };

  const attachments: IStoredAttachmentReader = {
    async find(attachmentId: string) {
      return ATTACHMENTS[attachmentId] ?? null;
    },
  };

  const packages = await createShippedPluginPackages({
    "dbrainx.builtin": createServerOperationHandlers(
      port,
      graphStub(),
      () => attachments,
    ),
    // The counter fixture ships next to builtin; binding its application
    // handlers keeps the host from starting a worker this test does not use.
    "dbrainx.counter": createCounterOperationHandlers(port),
  });

  const host = createPluginHost({ packages });
  await host.loadAll();
  const live = createLivePluginRegistries(host);

  holder.current = new NodeCommandService(
    repository,
    edges,
    publisher,
    live.nodeTypes,
  );

  const runs = createProcessOperationRunStore();
  const gateway = new CapabilityGateway({
    operations: live.operations,
    nodes: createNodeAccessPolicy({ nodes: repository, members, workspaces }),
    workspaces: createWorkspaceAccessPolicy({ workspaces, members }),
    runs,
    now: () => NOW,
  });
  const service = new OperationService({
    operations: live.operations,
    gateway,
    runs,
    nodes: repository,
    now: () => NOW,
    generateCorrelationId: () => "generated-correlation",
  });

  return {
    invoke: callerFor(service),
    nodes,
    live,
    runs,
    close: async () => {
      await host.shutdown();
      // The host served staged copies under the system temp directory; remove
      // them so a test run leaves nothing behind.
      for (const shipped of packages) {
        await rm(shipped.directory, { recursive: true, force: true });
      }
    },
  };
}

/**
 * The tRPC `operation.invoke` caller (the same construction the router test
 * uses): the shipped body schema, the shipped route body, the shipped executor.
 */
function callerFor(
  service: OperationService,
): (body: OperationInvokeBody) => Promise<OperationResult> {
  const t = initTRPC.context<OperationRouteContext>().create();
  const app = t.router({
    invoke: t.procedure
      .input(operationInvokeSchema)
      .mutation(({ ctx, input }) => invokeOperation(input, ctx, { service })),
  });
  const caller = t.createCallerFactory(app)({
    userId: OWNER_ID,
    activeWorkspaceId: WORKSPACE_ID,
  });
  return (body) => caller.invoke(body);
}

/**
 * Runs one step through the tRPC caller and refuses a misleading success.
 *
 * A thrown `TRPCError` already carries the stable operation code
 * (`OPERATION_FAILED`, `SCHEMA_INVALID`, ...); the assertions below also cover
 * a transport that answered `{ error }` with a 2xx shape.
 */
async function step(
  t: TestContext,
  harness: Harness,
  type: BuiltinType,
  label: string,
  body: OperationInvokeBody,
  expectedOperationId: string,
): Promise<OperationResult> {
  let result: OperationResult;
  try {
    result = await harness.invoke(body);
  } catch (error) {
    const failure = error as { code?: string; message?: string };
    return assert.fail(
      `${type}: ${label} (${expectedOperationId}) failed with ${failure.code ?? "NO_CODE"}: ${failure.message ?? String(error)}`,
    );
  }

  const returned = result as unknown as {
    operationId?: unknown;
    correlationId?: unknown;
    error?: unknown;
    code?: unknown;
  };
  assert.equal(
    returned.operationId,
    expectedOperationId,
    `${type}: ${label} returned a different operation id`,
  );
  assert.equal(
    returned.error,
    undefined,
    `${type}: ${label} returned an error payload instead of a result`,
  );
  assert.equal(
    returned.code,
    undefined,
    `${type}: ${label} returned an error code instead of a result`,
  );
  assert.equal(
    typeof returned.correlationId,
    "string",
    `${type}: ${label} returned no correlation id`,
  );
  assert.ok(
    Object.prototype.hasOwnProperty.call(returned, "output"),
    `${type}: ${label} returned no output`,
  );
  t.diagnostic(`${type} ${label}: ${expectedOperationId} ok`);
  return result;
}

function bodyFor(
  operationId: string,
  nodeId: string | undefined,
  input: unknown,
  correlationId: string,
): OperationInvokeBody {
  return {
    operationId,
    target:
      nodeId === undefined
        ? { kind: "workspace", workspaceId: WORKSPACE_ID }
        : { kind: "node", nodeId },
    input,
    correlationId,
  };
}

describe("builtin type CRUD through operation.invoke", () => {
  let harness: Harness;
  const executed = new Set<BuiltinType>();

  before(async () => {
    harness = await startHarness();
  });

  after(async () => {
    if (harness !== undefined) await harness.close();
  });

  for (const type of BUILTIN_TYPES) {
    const attachOperation = ATTACH_OPERATION[type];
    const finalStep = attachOperation ?? "read content";
    it(`${type}: node.add -> node.setTitle -> node.addTag -> node.setStateData -> ${finalStep} -> node.delete`, async (t) => {
      const correlation = (stepName: string) => `${type}--${stepName}`;
      const steps: string[] = [];

      const added = await step(
        t,
        harness,
        type,
        "1-add",
        bodyFor("node.add", undefined, { nodeType: type }, correlation("1-add")),
        "node.add",
      );
      steps.push("node.add");
      const nodeId = (added.output as { nodeId?: unknown }).nodeId;
      assert.equal(
        typeof nodeId,
        "string",
        `${type}: node.add returned no nodeId`,
      );
      assert.equal(
        added.node?.nodeType,
        type,
        `${type}: node.add stored another type`,
      );

      const titled = await step(
        t,
        harness,
        type,
        "2-set-title",
        bodyFor(
          "node.setTitle",
          nodeId as string,
          { title: TITLE },
          correlation("2-set-title"),
        ),
        "node.setTitle",
      );
      steps.push("node.setTitle");
      assert.equal(
        titled.node?.title,
        TITLE,
        `${type}: node.setTitle did not persist`,
      );

      const tagged = await step(
        t,
        harness,
        type,
        "3-add-tag",
        bodyFor(
          "node.addTag",
          nodeId as string,
          { tag: TAG },
          correlation("3-add-tag"),
        ),
        "node.addTag",
      );
      steps.push("node.addTag");
      assert.deepEqual(
        tagged.node?.tags,
        [TAG],
        `${type}: node.addTag did not persist`,
      );

      const stated = await step(
        t,
        harness,
        type,
        "4-set-state",
        bodyFor(
          "node.setStateData",
          nodeId as string,
          { stateData: STATE_DATA },
          correlation("4-set-state"),
        ),
        "node.setStateData",
      );
      steps.push("node.setStateData");
      assert.deepEqual(
        stated.node?.stateData,
        STATE_DATA,
        `${type}: node.setStateData did not persist`,
      );

      if (attachOperation !== undefined) {
        const uploadId = `upload-${type}`;
        const attached = await step(
          t,
          harness,
          type,
          "5-attach",
          bodyFor(
            attachOperation,
            nodeId as string,
            { uploadId },
            correlation("5-attach"),
          ),
          attachOperation,
        );
        steps.push(attachOperation);

        const dto = attached.node as unknown as
          | Record<string, unknown>
          | undefined;
        assert.ok(dto, `${type}: ${attachOperation} returned no node`);
        const content = dto.content as Record<string, unknown> | undefined;
        assert.ok(content, `${type}: ${attachOperation} left no content`);

        const facts = ATTACHED_FACTS[type] ?? {};
        for (const [key, value] of Object.entries(facts)) {
          assert.equal(
            dto[key],
            value,
            `${type}: ${attachOperation} did not read ${key} off the stored upload`,
          );
        }
        const fixture = ATTACHMENTS[uploadId];
        assert.ok(fixture, `${type}: no stored upload fixture`);
        for (const key of ATTACHED_CONTENT[type] ?? []) {
          assert.equal(
            content[key],
            (fixture as unknown as Record<string, unknown>)[key],
            `${type}: ${attachOperation} wrote the wrong ${key}`,
          );
        }
        assert.equal(
          dto.source,
          "local",
          `${type}: attach did not record its provenance`,
        );
      } else {
        const definition = harness.live.nodeTypes.get(type) as
          | NodeTypeDefinition
          | undefined;
        assert.ok(definition, `${type}: the type is not registered`);
        // The read surface is the canonical node the invoke reply reloaded; it
        // adds no run row, so it is not an invocation of its own.
        assert.deepEqual(
          stated.node?.content,
          definition.defaultContent(),
          `${type}: the stored content did not read back`,
        );
      }

      const deleted = await step(
        t,
        harness,
        type,
        "6-delete",
        bodyFor(
          "node.delete",
          nodeId as string,
          {},
          correlation("6-delete"),
        ),
        "node.delete",
      );
      steps.push("node.delete");
      assert.deepEqual(
        deleted.output,
        {},
        `${type}: node.delete returned output`,
      );
      assert.equal(
        deleted.node,
        undefined,
        `${type}: node.delete still returned the node`,
      );
      assert.equal(
        harness.nodes.has(nodeId as string),
        false,
        `${type}: the node survived node.delete`,
      );

      // The run ledger is the second success witness: a returned value cannot
      // hide a run the executor recorded as failed.
      const rows = (await harness.runs.listRecent(WORKSPACE_ID, 200)).filter(
        (row: OperationRun) => row.correlationId.startsWith(`${type}--`),
      );
      assert.equal(
        rows.length,
        steps.length,
        `${type}: expected ${steps.length} run rows for ${steps.join(", ")}, got ${rows.length}`,
      );
      for (const row of rows) {
        assert.equal(
          row.status,
          "succeeded",
          `${type}: run ${row.id} for ${row.operationId} is ${row.status}`,
        );
      }

      executed.add(type);
    });
  }

  it("covers exactly the ten builtin types, and every case ran", () => {
    const registered = harness.live.nodeTypes
      .list()
      .filter((definition) => definition.pluginId === "dbrainx.builtin")
      .map((definition) => definition.type)
      .sort();
    assert.deepEqual(
      registered,
      [...BUILTIN_TYPES].sort(),
      "the builtin registry and this regression drifted apart",
    );
    assert.equal(
      executed.size,
      BUILTIN_TYPES.length,
      `only ${executed.size} of ${BUILTIN_TYPES.length} builtin cases ran: ${[...executed].join(", ")}`,
    );
    for (const type of BUILTIN_TYPES) {
      assert.ok(executed.has(type), `the ${type} case did not run`);
    }
  });
});
