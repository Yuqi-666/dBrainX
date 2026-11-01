// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { useCallback, useRef } from "react";
import type { NodeData, NodeDataType, NodeId } from "@workspace/interfaces";
import {
  asOperationInvokeError,
  type OperationResult,
  type OperationTarget,
} from "@workspace/api-client";
import { NodeService, type GraphInvokeOptions } from "@workspace/services";
import { useDataStore } from "@workspace/store";
import { getNodeContentDescriptor } from "./registry";
import { emitContentConflict } from "./content-conflict";
import {
  coalesceIntents,
  intentPreview,
  isReplayableOperation,
  queuedContent,
  translateNodePatch,
  type ContentWriteIntent,
  type OperationWriteIntent,
} from "./node-content-patches";

/**
 * One queued write exactly as `operation.invoke` receives it (§4.3.2).
 *
 * The queue element used to be a `Partial<NodeData>`; it is this now, so a
 * drain can only send an operation id and that operation's own input.
 */
export interface ContentInvocation {
  readonly operationId: string;
  readonly target: OperationTarget;
  readonly input: Record<string, unknown>;
  readonly expectedVersion?: string;
  readonly correlationId?: string;
}

/** What one `apply` did. A refusal never writes and never retries. */
export type ContentWriteOutcome =
  | {
      readonly ok: true;
      readonly operationId: string;
      /** `result.node.updatedAt` — the version the next write carries. */
      readonly updatedAt?: string;
    }
  | {
      readonly ok: false;
      readonly operationId: string;
      /** The server's code, or `OPERATION_NOT_DECLARED` for a local refusal. */
      readonly code: string;
      readonly message: string;
    };

/** A write that failed; its input stays held so the draft is recoverable. */
export interface ContentWriteFailure {
  readonly operationId: string;
  readonly code: string;
  readonly message: string;
  readonly input: Record<string, unknown>;
}

/** The code a write gets when this node type declares no such operation. */
export const OPERATION_NOT_DECLARED = "OPERATION_NOT_DECLARED";

/** The code the server answers when the node moved on under the write. */
export const VERSION_CONFLICT = "VERSION_CONFLICT";

/**
 * A queue stopped by a version conflict.
 *
 * The queue refetched the node instead of replaying the invocation, and the
 * drafts below it are held rather than dropped: nothing in here is sent again
 * on its own.
 */
export interface ContentWriteConflict {
  readonly operationId: string;
  readonly code: typeof VERSION_CONFLICT;
  readonly message: string;
  readonly held: readonly ContentWriteIntent[];
}

/** The node operations every node type accepts (`plugins/builtin/server/operations.ts`). */
const SHARED_NODE_OPERATIONS: ReadonlySet<string> = new Set([
  "node.setTitle",
  "node.setAbstract",
  "node.setSemanticId",
  "node.setStateData",
  "node.setIcon",
  "node.clearIcon",
  "node.setCover",
  "node.clearCover",
  "node.setPermission",
  "node.pin",
  "node.unpin",
  "node.addTag",
  "node.removeTag",
]);

/**
 * Whether a node type may carry an operation id.
 *
 * A metadata operation targets any node; a type operation is named
 * `<type>.<verb>` and needs a registered descriptor. An unregistered type
 * therefore has no edit path at all — it is refused instead of falling back to
 * a whole-node patch that would look saved.
 */
function declaresByRegistry(nodeType: string, operationId: string): boolean {
  if (SHARED_NODE_OPERATIONS.has(operationId)) return true;
  if (getNodeContentDescriptor(nodeType) === undefined) return false;
  return operationId.startsWith(`${nodeType}.`);
}

let correlationSeed = 0;

function newCorrelationId(): string {
  correlationSeed += 1;
  return (
    globalThis.crypto?.randomUUID?.() ??
    `content-${Date.now().toString(36)}-${correlationSeed}`
  );
}

/** Test seams; a real writer leaves every one of them out. */
export interface ContentWriteQueueOptions {
  nodeId: NodeId;
  nodeType: string;
  declares?: (operationId: string) => boolean;
  isRegistered?: () => boolean;
  read?: (nodeId: NodeId) => NodeData | undefined;
  invoke?: (invocation: ContentInvocation) => Promise<OperationResult>;
  writeLegacy?: (nodeId: NodeId, patch: Partial<NodeData>) => Promise<void>;
  schedule?: (task: () => void) => void;
  onError?: (failure: ContentWriteFailure) => void;
  /** Refetch one node; the queue resumes from the version it returns. */
  resync?: (nodeId: NodeId) => Promise<void>;
  onConflict?: (conflict: ContentWriteConflict) => void;
}

/** The serial write queue one node-content host owns (§3.5.4.5). */
export interface ContentWriteQueue {
  readonly nodeId: NodeId;
  readonly nodeType: string;
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
  /** The last version conflict, or `null` when no queue stopped on one. */
  conflict(): ContentWriteConflict | null;
  /**
   * The refetch the last conflict started. Always awaitable once a conflict was
   * reported, so a caller never has to sleep to learn when it finished.
   */
  resyncing(): Promise<void> | null;
  pending(): number;
}

interface Waiter {
  readonly resolve: (outcome: ContentWriteOutcome) => void;
}

interface QueuedWrite {
  readonly intent: ContentWriteIntent;
  /** One per caller whose input this write carries (a coalesced burst). */
  readonly waiters: readonly Waiter[];
}

function failureOf(error: unknown): { code: string; message: string } {
  const invokeError = asOperationInvokeError(error);
  return { code: invokeError.code, message: invokeError.message };
}

function invocationOf(
  nodeId: NodeId,
  intent: OperationWriteIntent,
  version: string | undefined,
): ContentInvocation {
  return {
    operationId: intent.operationId,
    target: { kind: "node", nodeId },
    input: intent.input,
    ...(version === undefined ? {} : { expectedVersion: version }),
    correlationId: newCorrelationId(),
  };
}

/**
 * Create the queue one node-content host owns.
 *
 * It is a plain function, not a hook, so the concurrency rules can be tested
 * without a renderer: a burst of `apply` calls in one tick reaches the server as
 * one invocation, different operations keep their order, every write carries the
 * `updatedAt` of the previous reply, and a failure halts the queue instead of
 * replaying itself.
 */
export function createContentWriteQueue(
  options: ContentWriteQueueOptions,
): ContentWriteQueue {
  const { nodeId, nodeType } = options;
  const declares =
    options.declares ??
    ((operationId: string) => declaresByRegistry(nodeType, operationId));
  const isRegistered =
    options.isRegistered ??
    (() => getNodeContentDescriptor(nodeType) !== undefined);
  const read =
    options.read ?? ((id: NodeId) => useDataStore.getState().nodes.get(id));
  const invoke =
    options.invoke ??
    ((invocation: ContentInvocation) =>
      NodeService.invokeTypeOperation(
        invocation.operationId,
        nodeId,
        invocation.input,
        invokeOptionsOf(invocation),
      ));
  const writeLegacy =
    options.writeLegacy ??
    ((id: NodeId, patch: Partial<NodeData>) =>
      NodeService.upsert(id, patch).then(() => undefined));
  const schedule =
    options.schedule ?? ((task: () => void) => queueMicrotask(task));
  const onError =
    options.onError ??
    ((failed: ContentWriteFailure) =>
      console.error(
        `[${nodeType} content] ${failed.operationId} was refused: ${failed.code}`,
        failed.message,
      ));
  const resync =
    options.resync ??
    ((id: NodeId) => NodeService.sync([id]).then(() => undefined));
  const onConflict =
    options.onConflict ??
    ((conflict: ContentWriteConflict) => {
      console.error(
        `[${nodeType} content] the node moved on under ${conflict.operationId}; the queue refetched it and kept the draft`,
        conflict.message,
      );
      emitContentConflict({
        operationId: conflict.operationId,
        code: VERSION_CONFLICT,
        message: conflict.message,
      });
    });

  const queue: QueuedWrite[] = [];
  let heldIntents: ContentWriteIntent[] = [];
  let lastFailure: ContentWriteFailure | null = null;
  let lastConflict: ContentWriteConflict | null = null;
  let resyncPromise: Promise<void> | null = null;
  let resyncPending = false;
  let draining = false;
  let drainScheduled = false;
  let halted = false;
  /** The server version the next write names as `expectedVersion`. */
  let version: string | undefined = read(nodeId)?.updatedAt;

  const project = (preview: Partial<NodeData> | undefined): void => {
    if (preview === undefined) return;
    const live = read(nodeId);
    if (live === undefined) return;
    const next = { ...live, ...preview } as NodeData;
    if (preview.content !== undefined) {
      next.content = {
        ...(live.content as Record<string, unknown>),
        ...(preview.content as Record<string, unknown>),
      } as NodeData["content"];
    }
    useDataStore.getState().upsertNode(next);
  };

  const settle = (write: QueuedWrite, outcome: ContentWriteOutcome): void => {
    for (const waiter of write.waiters) waiter.resolve(outcome);
  };

  const operationIdOf = (intent: ContentWriteIntent): string =>
    intent.kind === "operation" ? intent.operationId : "node.patch";

  const inputOf = (intent: ContentWriteIntent): Record<string, unknown> =>
    intent.kind === "operation" ? intent.input : {};

  /**
   * Refetch the node a conflict stopped on, then accept new writes from its
   * version. The held drafts are never replayed here: only `retryHeld` may send
   * them, and only the replayable ones.
   */
  const requestResync = (): Promise<void> => {
    if (resyncPromise !== null && resyncPending) return resyncPromise;
    resyncPending = true;
    resyncPromise = (async () => {
      try {
        await resync(nodeId);
      } catch (error) {
        // The refetch failed, so the version the queue holds is unverified:
        // it stays halted instead of writing against a snapshot it could not
        // confirm.
        console.error(
          `[${nodeType} content] resync after VERSION_CONFLICT failed`,
          error,
        );
        return;
      }
      const fresh = read(nodeId)?.updatedAt;
      if (fresh === undefined) return;
      version = fresh;
      halted = false;
    })().finally(() => {
      resyncPending = false;
    });
    return resyncPromise;
  };

  const reportConflict = (operationId: string, message: string): void => {
    lastConflict = {
      operationId,
      code: VERSION_CONFLICT,
      message,
      held: heldIntents,
    };
    onConflict(lastConflict);
    void requestResync();
  };

  const fail = (write: QueuedWrite, code: string, message: string): void => {
    const operationId = operationIdOf(write.intent);
    lastFailure = { operationId, code, message, input: inputOf(write.intent) };
    // The write that failed and everything behind it are held, not dropped:
    // the editor keeps showing the draft, and only a replayable intent may be
    // retried (never an insertion or an attachment).
    heldIntents = [
      write.intent,
      ...queue.map((queued) => queued.intent),
      ...heldIntents,
    ];
    halted = true;
    for (const queued of queue.splice(0)) {
      settle(queued, { ok: false, operationId, code, message });
    }
    settle(write, { ok: false, operationId, code, message });
    onError(lastFailure);
    if (code === VERSION_CONFLICT) reportConflict(operationId, message);
  };

  const send = async (write: QueuedWrite): Promise<void> => {
    const { intent } = write;

    if (intent.kind === "legacy") {
      if (!isRegistered()) {
        fail(
          write,
          OPERATION_NOT_DECLARED,
          `node type "${nodeType}" is not registered, so it has no edit path`,
        );
        return;
      }
      NodeService.cancelPendingUpdate(nodeId);
      // `NodeService.upsert` replaces `content` whole, so a patch that names one
      // key has to be merged onto the freshest content or it drops its siblings.
      const live = read(nodeId);
      const patch: Partial<NodeData> =
        intent.patch.content === undefined || live === undefined
          ? intent.patch
          : {
              ...intent.patch,
              content: {
                ...(live.content as Record<string, unknown>),
                ...(intent.patch.content as Record<string, unknown>),
              } as NodeData["content"],
            };
      try {
        await writeLegacy(nodeId, patch);
        settle(write, { ok: true, operationId: "node.patch" });
      } catch (error) {
        const { code, message } = failureOf(error);
        fail(write, code, message);
      }
      return;
    }

    if (!declares(intent.operationId)) {
      fail(
        write,
        OPERATION_NOT_DECLARED,
        `node type "${nodeType}" declares no operation "${intent.operationId}"`,
      );
      return;
    }

    try {
      const result = await invoke(invocationOf(nodeId, intent, version));
      const updatedAt = result.node?.updatedAt;
      if (updatedAt !== undefined) version = updatedAt;
      settle(write, {
        ok: true,
        operationId: intent.operationId,
        ...(updatedAt === undefined ? {} : { updatedAt }),
      });
    } catch (error) {
      const { code, message } = failureOf(error);
      fail(write, code, message);
    }
  };

  /** Take the head of the queue plus every intent it may legally absorb. */
  const takeCoalescedHead = (): QueuedWrite | undefined => {
    const head = queue.shift();
    if (head === undefined) return undefined;
    let write = head;
    while (queue.length > 0) {
      const next = queue[0] as QueuedWrite;
      const merged = coalesceIntents([write.intent, next.intent]);
      if (merged.length !== 1) break;
      queue.shift();
      write = {
        intent: merged[0] as ContentWriteIntent,
        waiters: [...write.waiters, ...next.waiters],
      };
    }
    return write;
  };

  const drain = async (): Promise<void> => {
    if (draining) return;
    draining = true;
    try {
      // Re-check the queue every round, so a write raised while one is in
      // flight is picked up instead of waiting for the next gesture.
      while (queue.length > 0 && !halted) {
        const write = takeCoalescedHead();
        if (write === undefined) break;
        await send(write);
      }
    } finally {
      draining = false;
      if (queue.length > 0 && !halted) scheduleDrain();
    }
  };

  function scheduleDrain(): void {
    if (draining || drainScheduled) return;
    drainScheduled = true;
    schedule(() => {
      drainScheduled = false;
      void drain();
    });
  }

  const enqueue = (intent: ContentWriteIntent): Promise<ContentWriteOutcome> =>
    new Promise((resolve) => {
      if (halted) {
        heldIntents = [...heldIntents, intent];
        resolve({
          ok: false,
          operationId: operationIdOf(intent),
          code: lastFailure?.code ?? OPERATION_NOT_DECLARED,
          message: lastFailure?.message ?? "the write queue is halted",
        });
        return;
      }
      queue.push({ intent, waiters: [{ resolve }] });
      scheduleDrain();
    });

  const write = async (
    intent: ContentWriteIntent,
  ): Promise<ContentWriteOutcome> => {
    project(intent.kind === "legacy" ? intent.patch : intent.preview);
    return enqueue(intent);
  };

  const apply = (
    operationId: string,
    input: Record<string, unknown>,
    preview?: Partial<NodeData>,
  ): Promise<ContentWriteOutcome> => {
    const resolved = preview ?? intentPreview(operationId, input);
    return write({
      kind: "operation",
      operationId,
      input,
      ...(resolved === undefined ? {} : { preview: resolved }),
    });
  };

  const liveContent = <C>(fallback: C): C => {
    const live = read(nodeId);
    const content =
      live?.nodeType === nodeType ? (live.content as C) : fallback;
    return queuedContent(content, [
      ...queue.map((queued) => queued.intent),
      ...heldIntents,
    ]);
  };

  const retryHeld = async (): Promise<void> => {
    const replay = heldIntents.filter(
      (intent) =>
        intent.kind === "operation" &&
        isReplayableOperation(intent.operationId),
    );
    if (replay.length === 0) return;
    heldIntents = heldIntents.filter((intent) => !replay.includes(intent));
    lastFailure = null;
    halted = false;
    version = read(nodeId)?.updatedAt ?? version;
    for (const intent of replay) await write(intent);
  };

  return {
    nodeId,
    nodeType,
    apply,
    write,
    liveContent,
    failure: () => lastFailure,
    held: () => heldIntents,
    retryHeld,
    conflict: () => lastConflict,
    resyncing: () => resyncPromise,
    pending: () => queue.length,
  };
}

function invokeOptionsOf(invocation: ContentInvocation): GraphInvokeOptions {
  return {
    ...(invocation.expectedVersion === undefined
      ? {}
      : { expectedVersion: invocation.expectedVersion }),
    ...(invocation.correlationId === undefined
      ? {}
      : { correlationId: invocation.correlationId }),
  };
}

/** What {@link useNodeContentWriter} hands back to a node-content host. */
export interface NodeContentWriter<C> {
  /** The freshest content: the store, plus whatever is still queued. */
  liveContent(): C;
  /**
   * Persist one edit through the node type's declared operation.
   *
   * The queue coalesces a burst of same-operation input in one tick into one
   * invocation, sends different operations in order, and carries the previous
   * reply's `updatedAt` as this one's `expectedVersion`.
   */
  apply(
    operationId: string,
    input: Record<string, unknown>,
    preview?: Partial<NodeData>,
  ): Promise<ContentWriteOutcome>;
  /**
   * @deprecated Todo 43 removes the patch-shaped entry points; an editor names
   * its operation through {@link apply}.
   *
   * A metadata key (`title`, `abstract`, `icon`, …) and a document
   * (`content.docs`) are translated into their operations here. A content key
   * that has no whole-value operation yet is sent as the old whole-node write —
   * one at a time, never merged.
   */
  patchContent(patch: Partial<C>): void;
  /** @deprecated See {@link patchContent}. */
  patchNode(patch: Partial<NodeData>): void;
  /** The last refused write, with its server code and its input. */
  failure(): ContentWriteFailure | null;
  /** Every write still holding a draft after a failure, oldest first. */
  held(): readonly ContentWriteIntent[];
  /** Replay only the replayable intents of a halted queue. */
  retryHeld(): Promise<void>;
  /** The last version conflict, or `null` when the queue never stopped on one. */
  conflict(): ContentWriteConflict | null;
  /** The refetch a conflict started, awaitable without polling. */
  resyncing(): Promise<void> | null;
}

/**
 * The shared content writer every node-content host uses.
 *
 * Two rules make content persistence safe, and both survive the move from
 * whole-node patches to operations:
 *
 * 1. **One queue per node.** The queue serializes every write for the node, so
 *    two of them are never in flight together; PocketBase's SDK cancels a
 *    pending request when another one for the same record starts, which used to
 *    abort half of a gesture and roll the store back.
 * 2. **The order is the user's.** A burst of the *same* whole-value operation
 *    (typing a title, replacing a document) collapses to the last input; anything
 *    with its own identity (a timeline entry, a cell, an attachment) is sent in
 *    the order it happened.
 *
 * @param nodeId   the node whose content is being written
 * @param nodeType guards `liveContent` and names the operation domain
 * @param fallback this render's content, used only when the store has no live node
 * @param label    prefix for the error log; defaults to `nodeType`
 */
export function useNodeContentWriter<C>(
  nodeId: NodeId,
  nodeType: NodeDataType,
  fallback: C,
  label?: string,
): NodeContentWriter<C> {
  const queueRef = useRef<ContentWriteQueue | null>(null);
  if (queueRef.current?.nodeId !== nodeId) {
    queueRef.current = createContentWriteQueue({
      nodeId,
      nodeType,
      onError: (failed) =>
        console.error(
          `[${label ?? nodeType} content] ${failed.operationId} was refused: ${failed.code}`,
          failed.message,
        ),
    });
  }
  const queue = queueRef.current;

  const liveContent = useCallback(
    () => queue.liveContent(fallback),
    [queue, fallback],
  );

  const apply = useCallback(
    (
      operationId: string,
      input: Record<string, unknown>,
      preview?: Partial<NodeData>,
    ) => queue.apply(operationId, input, preview),
    [queue],
  );

  const writePatch = useCallback(
    (patch: Partial<NodeData>) => {
      for (const intent of translateNodePatch(nodeType, patch)) {
        void queue.write(intent);
      }
    },
    [queue, nodeType],
  );

  const patchContent = useCallback(
    (patch: Partial<C>) => {
      writePatch({ content: patch } as unknown as Partial<NodeData>);
    },
    [writePatch],
  );

  return {
    liveContent,
    apply,
    patchContent,
    patchNode: writePatch,
    failure: () => queue.failure(),
    held: () => queue.held(),
    retryHeld: () => queue.retryHeld(),
    conflict: () => queue.conflict(),
    resyncing: () => queue.resyncing(),
  };
}
