// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { useCallback, useRef } from "react";
import type { NodeData, NodeDataType, NodeId } from "@workspace/interfaces";
import { NodeService } from "@workspace/services";
import { useDataStore } from "@workspace/store";
import { queuedContent, mergeNodePatches } from "./node-content-patches";

/** What {@link useNodeContentWriter} hands back to a node-content host. */
export interface NodeContentWriter<C> {
  /** The freshest content, read back from the store (never this render's snapshot). */
  liveContent(): C;
  /** Queue a content-half patch; patches raised in the same tick merge into one write. */
  patchContent(patch: Partial<C>): void;
  /**
   * Queue a **top-level** node patch (`title` / `abstract` / `semanticId` /
   * `icon` / `cover` …) through the *same* queue as {@link patchContent}.
   *
   * The shared queue is the point (plan `node-content-ui.md` §M3.2-10): a header
   * edit raised while the body is being typed must not become a second in-flight
   * request for the same record — PocketBase's SDK cancels the earlier one
   * (the repositories pass the record id as `requestKey`) and the aborted write
   * rolls the store back. Raised in one tick, a content patch and a top-level
   * patch are merged into a single upsert.
   *
   * Never route `content` through here; use {@link patchContent} so the content
   * half keeps its merge rule.
   */
  patchNode(patch: Partial<NodeData>): void;
}

/**
 * The shared content writer every node-content host uses.
 *
 * `database-node-content.tsx` and `collection-node-content.tsx` carried this
 * logic twice; this hook is a **dedup**, not a refactor. The concurrency
 * semantics are load-bearing and must stay verbatim: one gesture is one write,
 * several patches raised in the same tick merge into a single upsert, and the
 * drain keeps emptying the queue while it is running.
 *
 * Two rules make content persistence safe:
 *
 * 1. **Patch the freshest content, never the render's copy.** One gesture can
 *    report two changes (adding a field writes its column config _and_ the
 *    field), and a patch built from a snapshot taken before the first write
 *    silently drops it. {@link NodeContentWriter.liveContent} therefore reads
 *    the node back from the store and applies queued content patches, so a
 *    second cell edit sees the first even before the microtask drain begins.
 * 2. **Serialize the writes.** Two writes for the same node must never be in
 *    flight together: PocketBase's SDK cancels a pending request when another
 *    one for the same record starts (the repositories pass the record id as the
 *    `requestKey`), which used to abort the first half of a gesture and roll the
 *    store back — the new row of an empty table flashed and vanished with
 *    `TRPCClientError: The request was aborted (most likely autocancelled…)`.
 *    A microtask-queued drain merges every patch raised in the same tick into a
 *    single upsert, then awaits it before sending the next.
 *
 * Since M3 the same queue also carries **top-level** patches
 * ({@link NodeContentWriter.patchNode}), because a node can be edited from two
 * places at once — the rich-text content header writes `title`/`icon`/`cover`
 * while the body editor writes `docs`. Two queues would be two in-flight requests
 * for one record; one queue is the invariant above, kept.
 *
 * @param nodeId   the node whose `content` is being written
 * @param nodeType guards `liveContent` against reading another node type's content
 * @param fallback this render's content, used only when the store has no live node
 * @param label    prefix for the error log; defaults to `nodeType`
 */
export function useNodeContentWriter<C>(
  nodeId: NodeId,
  nodeType: NodeDataType,
  fallback: C,
  label?: string,
): NodeContentWriter<C> {
  /** Patches queued for the current drain; merged one write at a time. */
  const pendingPatches = useRef<Partial<NodeData>[]>([]);
  const draining = useRef(false);
  const drainScheduled = useRef(false);

  const liveContent = useCallback((): C => {
    const live = useDataStore.getState().nodes.get(nodeId);
    const content =
      live?.nodeType === nodeType ? (live.content as C) : fallback;
    return queuedContent(content, pendingPatches.current);
  }, [fallback, nodeId, nodeType]);

  const drainWrites = useCallback(async () => {
    if (draining.current) return;
    draining.current = true;
    try {
      // Re-checks the queue every round, so a patch raised while a write is in
      // flight is picked up instead of being left to a later gesture.
      while (pendingPatches.current.length > 0) {
        const merged = mergeNodePatches(pendingPatches.current.splice(0));

        // The content half is merged onto the freshest content, so a patch that
        // names one key never drops its siblings.
        if (merged.content !== undefined) {
          merged.content = {
            ...liveContent(),
            ...(merged.content as Partial<C>),
          } as unknown as NodeData["content"];
        }

        // Any debounced payload already scheduled for this node was captured from
        // the store this write is about to read, i.e. it is a strict subset of
        // what we send — and it would otherwise fire *after* us and put a stale
        // copy back (a title typed earlier would revert an icon set since).
        NodeService.cancelPendingUpdate(nodeId);

        try {
          // `C` is the content half of one node type; TypeScript cannot see that
          // through the generic, so assert at this single boundary.
          await NodeService.upsert(nodeId, merged);
        } catch (error) {
          console.error(
            `[${label ?? nodeType} content] Failed to persist content`,
            error,
          );
        }
      }
    } finally {
      draining.current = false;
    }
  }, [label, liveContent, nodeId, nodeType]);

  const enqueue = useCallback(
    (patch: Partial<NodeData>) => {
      pendingPatches.current.push(patch);
      if (draining.current || drainScheduled.current) return;
      drainScheduled.current = true;
      queueMicrotask(() => {
        drainScheduled.current = false;
        void drainWrites();
      });
    },
    [drainWrites],
  );

  const patchContent = useCallback(
    (patch: Partial<C>) => {
      enqueue({ content: patch } as unknown as Partial<NodeData>);
    },
    [enqueue],
  );

  const patchNode = useCallback(
    (patch: Partial<NodeData>) => {
      enqueue(patch);
    },
    [enqueue],
  );

  return { liveContent, patchContent, patchNode };
}
