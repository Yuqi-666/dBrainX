// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The content write queue is an `OperationInvocation` producer (todo 40).
 *
 * The queue is a plain factory, so these tests drive it directly: no renderer,
 * no store writes needed. The transport is the seam the service documents for
 * tests, so what runs is the real merge and drain logic with a fake
 * `operation.invoke`.
 *
 * `packages/ui` test files normally run under `node --test` with type stripping,
 * and that resolver rejects the workspace packages' extensionless imports. This
 * file therefore bundles the module under test with esbuild, the same recipe
 * `attribute-operations.test.ts` and `packages/services/test/run.mjs` use.
 */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";
import type { NodeData } from "@workspace/interfaces";

const NODE_ID = "node-1";
const VERSION = "2026-11-01T00:00:00.000Z";
const DIR = fileURLToPath(new URL("./", import.meta.url));

const ENTRY = [
  'export { createContentWriteQueue } from "./use-node-content-writer.ts";',
  'export { coalesceIntents, intentPreview } from "./node-content-patches.ts";',
  'export { useDataStore } from "@workspace/store";',
].join("\n");

const DOC_A = { type: "doc", content: [{ type: "paragraph", content: "A" }] };
const DOC_B = { type: "doc", content: [{ type: "paragraph", content: "B" }] };
const DOC_C = { type: "doc", content: [{ type: "paragraph", content: "C" }] };

interface ContentInvocation {
  readonly operationId: string;
  readonly target: { readonly kind: string; readonly nodeId?: string };
  readonly input: Record<string, unknown>;
  readonly expectedVersion?: string;
  readonly correlationId?: string;
}

interface OperationResult {
  readonly operationId: string;
  readonly correlationId: string;
  readonly output: unknown;
  readonly eventIds: readonly string[];
  readonly node?: NodeData;
}

type ContentWriteOutcome =
  | {
      readonly ok: true;
      readonly operationId: string;
      readonly updatedAt?: string;
    }
  | {
      readonly ok: false;
      readonly operationId: string;
      readonly code: string;
      readonly message: string;
    };

interface ContentWriteFailure {
  readonly operationId: string;
  readonly code: string;
  readonly message: string;
  readonly input: Record<string, unknown>;
}

interface ContentWriteIntent {
  readonly kind: "operation";
  readonly operationId: string;
  readonly input: Record<string, unknown>;
  readonly preview?: Partial<NodeData>;
}

interface QueueOptions {
  nodeId: string;
  nodeType: string;
  declares?: (operationId: string) => boolean;
  read?: (nodeId: string) => NodeData | undefined;
  invoke?: (invocation: ContentInvocation) => Promise<OperationResult>;
  schedule?: (task: () => void) => void;
  onError?: (failure: ContentWriteFailure) => void;
  resync?: (nodeId: string) => Promise<void>;
  onConflict?: (conflict: ContentWriteConflict) => void;
}

interface ContentWriteConflict {
  readonly operationId: string;
  readonly code: string;
  readonly message: string;
  readonly held: readonly ContentWriteIntent[];
}

interface ContentWriteQueue {
  apply(
    operationId: string,
    input: Record<string, unknown>,
    preview?: Partial<NodeData>,
  ): Promise<ContentWriteOutcome>;
  write(intent: ContentWriteIntent): Promise<ContentWriteOutcome>;
  liveContent<C>(fallback: C): C;
  failure(): ContentWriteFailure | null;
  held(): readonly ContentWriteIntent[];
  retryHeld(): Promise<void>;
  conflict(): ContentWriteConflict | null;
  resyncing(): Promise<void> | null;
  pending(): number;
  dispose(): void;
}

interface RuntimeModule {
  createContentWriteQueue: (options: QueueOptions) => ContentWriteQueue;
  coalesceIntents: (
    intents: readonly ContentWriteIntent[],
  ) => ContentWriteIntent[];
  intentPreview: (
    operationId: string,
    input: Record<string, unknown>,
  ) => Partial<NodeData> | undefined;
  useDataStore: {
    getState: () => {
      nodes: Map<string, NodeData>;
      reset?: () => void;
      upsertNode: (node: NodeData) => void;
    };
  };
}

let outDir = "";
let runtime: RuntimeModule;

before(async () => {
  outDir = await mkdtemp(join(tmpdir(), "ui-node-content-writer-"));
  const outfile = join(outDir, "writer.mjs");
  await build({
    stdin: { contents: ENTRY, resolveDir: DIR, loader: "ts" },
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
  runtime.useDataStore.getState().reset?.();
});

/**
 * Every queue a test creates is disposed afterwards. The conflict path refetches
 * the node, so a queue left halted holds callers and a refetch nobody awaits.
 */
const queues: ContentWriteQueue[] = [];

function createQueue(options: QueueOptions): ContentWriteQueue {
  const queue = runtime.createContentWriteQueue(options);
  queues.push(queue);
  return queue;
}

afterEach(() => {
  for (const queue of queues.splice(0)) queue.dispose();
});

function textNode(): NodeData {
  return {
    id: NODE_ID,
    title: "Title",
    permission: "private",
    semanticId: "semantic-1",
    createdAt: VERSION,
    updatedAt: VERSION,
    nodeType: "text",
    content: { docs: DOC_A },
  } as unknown as NodeData;
}

function reply(
  invocation: ContentInvocation,
  updatedAt: string,
): OperationResult {
  return {
    operationId: invocation.operationId,
    correlationId: invocation.correlationId ?? "correlation",
    output: {},
    eventIds: [],
    node: { ...textNode(), updatedAt } as NodeData,
  };
}

describe("content write queue", () => {
  it("coalesces a burst of one operation into one invocation with the settled input", async () => {
    const calls: ContentInvocation[] = [];
    const queue = createQueue({
      nodeId: NODE_ID,
      nodeType: "text",
      declares: () => true,
      read: () => textNode(),
      invoke: async (invocation) => {
        calls.push(invocation);
        return reply(invocation, "2026-11-01T00:00:01.000Z");
      },
    });

    const outcomes = await Promise.all([
      queue.apply("text.setDocument", { docs: DOC_A }),
      queue.apply("text.setDocument", { docs: DOC_B }),
      queue.apply("text.setDocument", { docs: DOC_C }),
    ]);

    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0]?.input, { docs: DOC_C });
    assert.equal(calls[0]?.target.kind, "node");
    assert.equal(calls[0]?.expectedVersion, VERSION);
    for (const outcome of outcomes) assert.equal(outcome.ok, true);
  });

  it("keeps different operations separate, in order, each carrying the last reply's version", async () => {
    const calls: ContentInvocation[] = [];
    const queue = createQueue({
      nodeId: NODE_ID,
      nodeType: "text",
      declares: () => true,
      read: () => textNode(),
      invoke: async (invocation) => {
        calls.push(invocation);
        return reply(invocation, `2026-11-01T00:00:0${calls.length}.000Z`);
      },
    });

    await Promise.all([
      queue.apply("video.timeline.add", { item: { id: "note_1" } }),
      queue.apply("video.timeline.add", { item: { id: "note_2" } }),
      queue.apply("node.setTitle", { title: "Renamed" }),
    ]);

    assert.deepEqual(
      calls.map((call) => call.operationId),
      ["video.timeline.add", "video.timeline.add", "node.setTitle"],
    );
    assert.deepEqual(calls[0]?.input, { item: { id: "note_1" } });
    assert.deepEqual(calls[1]?.input, { item: { id: "note_2" } });
    assert.equal(calls[0]?.expectedVersion, VERSION);
    assert.equal(calls[1]?.expectedVersion, "2026-11-01T00:00:01.000Z");
    assert.equal(calls[2]?.expectedVersion, "2026-11-01T00:00:02.000Z");
  });

  it("surfaces a conflict, stops the queue, and keeps the draft", async () => {
    const calls: ContentInvocation[] = [];
    // The refetch a conflict starts is a seam: the default one is the live tRPC
    // client, which has no server to answer it under `node --test`. Held shut
    // here so the queue stays stopped while the test asserts, and released at
    // the end so no promise outlives the test.
    let releaseResync: (() => void) | undefined;
    const resyncGate = new Promise<void>((resolve) => {
      releaseResync = resolve;
    });
    const queue = createQueue({
      nodeId: NODE_ID,
      nodeType: "text",
      declares: () => true,
      read: () => textNode(),
      invoke: async (invocation) => {
        calls.push(invocation);
        throw new Error("VERSION_CONFLICT: the node moved on");
      },
      resync: () => resyncGate,
    });

    const [document, title] = await Promise.all([
      queue.apply("text.setDocument", { docs: DOC_B }),
      queue.apply("node.setTitle", { title: "Renamed" }),
    ]);

    assert.equal(calls.length, 1);
    assert.equal(document.ok, false);
    assert.equal(
      document.ok === false ? document.code : "",
      "VERSION_CONFLICT",
    );
    assert.equal(title.ok, false);
    assert.equal(title.ok === false ? title.code : "", "VERSION_CONFLICT");
    assert.equal(queue.failure()?.code, "VERSION_CONFLICT");

    const held = queue.held();
    assert.equal(held.length, 2);
    assert.equal(held[0]?.operationId, "text.setDocument");
    assert.equal(held[1]?.operationId, "node.setTitle");

    const content = queue.liveContent({ docs: null }) as { docs: unknown };
    assert.deepEqual(content.docs, DOC_B);

    releaseResync?.();
    await queue.resyncing();
  });

  it("replays only a replayable write after a conflict, never an insertion", async () => {
    const calls: ContentInvocation[] = [];
    // Same seam as above: a conflict must not reach for a live server, and the
    // refetch stays shut until this test has asserted the stopped queue.
    let releaseResync: (() => void) | undefined;
    const resyncGate = new Promise<void>((resolve) => {
      releaseResync = resolve;
    });
    const queue = createQueue({
      nodeId: NODE_ID,
      nodeType: "video",
      declares: () => true,
      read: () => textNode(),
      invoke: async (invocation) => {
        calls.push(invocation);
        throw new Error("VERSION_CONFLICT: the node moved on");
      },
      resync: () => resyncGate,
    });

    await queue.apply("video.timeline.add", { item: { id: "note_1" } });
    const after = await queue.apply("node.setTitle", { title: "Renamed" });

    assert.equal(calls.length, 1);
    assert.equal(after.ok, false);
    assert.equal(queue.held()[0]?.operationId, "video.timeline.add");

    await queue.retryHeld();
    assert.deepEqual(
      calls.map((call) => call.operationId),
      ["video.timeline.add", "node.setTitle"],
    );
    assert.deepEqual(
      queue.held().map((intent) => intent.operationId),
      ["node.setTitle", "video.timeline.add"],
    );

    releaseResync?.();
    await queue.resyncing();
  });

  it("requests one refetch on VERSION_CONFLICT and sends nothing while it runs", async () => {
    let stored = textNode();
    const calls: ContentInvocation[] = [];
    const resynced: string[] = [];
    const conflicts: ContentWriteConflict[] = [];
    let releaseResync: (() => void) | undefined;
    const resyncGate = new Promise<void>((resolve) => {
      releaseResync = resolve;
    });
    const queue = createQueue({
      nodeId: NODE_ID,
      nodeType: "text",
      declares: () => true,
      read: () => stored,
      invoke: async (invocation) => {
        calls.push(invocation);
        throw new Error("VERSION_CONFLICT: the node moved on");
      },
      resync: async (nodeId) => {
        resynced.push(nodeId);
        await resyncGate;
        stored = {
          ...textNode(),
          title: "Theirs",
          updatedAt: "2026-11-01T00:00:09.000Z",
        } as unknown as NodeData;
      },
      onConflict: (conflict) => conflicts.push(conflict),
    });

    const [document] = await Promise.all([
      queue.apply("text.setDocument", { docs: DOC_B }),
      queue.apply("node.setTitle", { title: "Renamed" }),
    ]);

    assert.equal(calls.length, 1);
    assert.equal(document.ok, false);
    assert.deepEqual(resynced, [NODE_ID]);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0]?.code, "VERSION_CONFLICT");
    assert.equal(queue.conflict()?.code, "VERSION_CONFLICT");

    const heldWhileStopped = queue.held();
    assert.deepEqual(
      heldWhileStopped.map((intent) => intent.operationId),
      ["text.setDocument", "node.setTitle"],
    );

    const refused = await queue.apply("node.setAbstract", { abstract: "x" });
    assert.equal(refused.ok, false);
    assert.equal(calls.length, 1);
    assert.equal(queue.pending(), 0);

    releaseResync?.();
    await queue.resyncing();
    assert.equal(queue.conflict()?.held.length, 2);
  });

  it("accepts a later edit from the refetched version and never replays the draft", async () => {
    let stored = textNode();
    const latestVersion = "2026-11-01T00:00:09.000Z";
    const calls: ContentInvocation[] = [];
    const queue = createQueue({
      nodeId: NODE_ID,
      nodeType: "text",
      declares: () => true,
      read: () => stored,
      invoke: async (invocation) => {
        calls.push(invocation);
        if (calls.length === 1) {
          throw new Error("VERSION_CONFLICT: the node moved on");
        }
        return reply(invocation, "2026-11-01T00:00:10.000Z");
      },
      resync: async () => {
        stored = {
          ...textNode(),
          title: "Theirs",
          updatedAt: latestVersion,
        } as unknown as NodeData;
      },
    });

    const conflicted = await queue.apply("node.setTitle", {
      title: "Mine",
    });
    assert.equal(conflicted.ok, false);
    await queue.resyncing();

    const later = await queue.apply("node.setAbstract", { abstract: "Later" });
    assert.equal(later.ok, true);
    assert.deepEqual(
      calls.map((call) => call.operationId),
      ["node.setTitle", "node.setAbstract"],
    );
    assert.equal(calls[1]?.expectedVersion, latestVersion);
    assert.deepEqual(
      queue.held().map((intent) => intent.operationId),
      ["node.setTitle"],
    );
  });

  it("refuses an unregistered type's edit instead of writing anything", async () => {
    const calls: ContentInvocation[] = [];
    const queue = createQueue({
      nodeId: NODE_ID,
      nodeType: "ghost",
      declares: () => false,
      read: () => ({ ...textNode(), nodeType: "ghost" }) as NodeData,
      invoke: async (invocation) => {
        calls.push(invocation);
        return reply(invocation, VERSION);
      },
    });

    const refused = await queue.apply("ghost.setPayload", { payload: 1 });

    assert.equal(refused.ok, false);
    assert.equal(
      refused.ok === false ? refused.code : "",
      "OPERATION_NOT_DECLARED",
    );
    assert.equal(calls.length, 0);
  });

  it("settles the caller of a write the surface closed on, and refuses later ones", async () => {
    const calls: ContentInvocation[] = [];
    let releaseSend: (() => void) | undefined;
    const sendGate = new Promise<void>((resolve) => {
      releaseSend = resolve;
    });
    const queue = createQueue({
      nodeId: NODE_ID,
      nodeType: "text",
      declares: () => true,
      read: () => textNode(),
      // `task()` runs the drain at once, so the first write is in flight when
      // the second one is queued behind it.
      schedule: (task) => task(),
      invoke: async (invocation) => {
        calls.push(invocation);
        await sendGate;
        return reply(invocation, VERSION);
      },
    });

    const inFlight = queue.apply("text.setDocument", { docs: DOC_B });
    const queued = queue.apply("node.setTitle", { title: "Renamed" });

    queue.dispose();

    const settled = await queued;
    assert.equal(settled.ok, false);
    assert.equal(
      settled.ok === false ? settled.code : "",
      "CONTENT_QUEUE_DISPOSED",
    );

    const refused = await queue.apply("node.setAbstract", { abstract: "x" });
    assert.equal(refused.ok, false);
    assert.equal(
      refused.ok === false ? refused.code : "",
      "CONTENT_QUEUE_DISPOSED",
    );
    assert.equal(calls.length, 1);
    assert.equal(queue.pending(), 0);

    releaseSend?.();
    const sent = await inFlight;
    assert.equal(sent.ok, true);
  });
});

describe("content write intents", () => {
  it("previews only the payload the named operation owns", () => {
    assert.deepEqual(
      runtime.intentPreview("text.setDocument", { docs: DOC_A }),
      { content: { docs: DOC_A } },
    );
    assert.deepEqual(
      runtime.intentPreview("video.setTimeline", { timestamps: [] }),
      { content: { timestamps: [] } },
    );
    assert.equal(runtime.intentPreview("edge.create", {}), undefined);
  });

  it("merges only adjacent inputs of one mergeable operation", () => {
    const writes = runtime.coalesceIntents([
      {
        kind: "operation",
        operationId: "text.setDocument",
        input: { docs: DOC_A },
      },
      {
        kind: "operation",
        operationId: "text.setDocument",
        input: { docs: DOC_B },
      },
      {
        kind: "operation",
        operationId: "node.setTitle",
        input: { title: "T" },
      },
      {
        kind: "operation",
        operationId: "text.setDocument",
        input: { docs: DOC_C },
      },
    ]);

    assert.deepEqual(
      writes.map((write) => [write.operationId, write.input]),
      [
        ["text.setDocument", { docs: DOC_B }],
        ["node.setTitle", { title: "T" }],
        ["text.setDocument", { docs: DOC_C }],
      ],
    );
  });
});
