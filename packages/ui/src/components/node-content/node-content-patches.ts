// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The write intents the node-content queue carries (§3.5.4.5, todo 40).
 *
 * An edit is one operation with one input, and only the fields that operation
 * owns may change. This module keeps the facts the queue needs — what an intent
 * is, and which intents a drain may merge — so both are testable without React.
 *
 * Two rules come straight from the plan:
 *
 * 1. **Only the same operation may merge.** Two different operations are two
 *    writes in the order the user made them; merging them would send one input
 *    that neither operation's schema accepts.
 * 2. **Only a whole-value operation may merge.** `text.setDocument` replaces
 *    the document, so the last document of a burst is the one to send. A
 *    timeline insertion or a file attachment is an event with its own identity;
 *    dropping one of them loses the user's work, so those are always sent in
 *    order.
 */
import type { NodeData } from "@workspace/interfaces";

/** One write the queue will send as `operation.invoke`. */
export interface ContentWriteIntent {
  readonly kind: "operation";
  /** The id the server resolves; `text.setDocument`, `node.setTitle`, … */
  readonly operationId: string;
  /** The input that operation's own schema declares — never a node snapshot. */
  readonly input: Record<string, unknown>;
  /**
   * The local projection of the write, applied before the server answers
   * (§3.5.4.3). It may only carry fields this operation is allowed to change.
   */
  readonly preview?: Partial<NodeData>;
}

/** Alias kept for the queue's public shape: one intent is one operation. */
export type OperationWriteIntent = ContentWriteIntent;

/**
 * Operations whose input replaces the whole value they name.
 *
 * A later input for the same operation in one drain window supersedes the
 * earlier one; everything else (timeline entries, cells, attachments,
 * annotations) is an ordered event and is never merged.
 */
const MERGEABLE_OPERATION_IDS: ReadonlySet<string> = new Set([
  "node.setTitle",
  "node.setAbstract",
  "node.setSemanticId",
  "node.setStateData",
  "node.setIcon",
  "node.clearIcon",
  "node.setCover",
  "node.clearCover",
  "node.pin",
  "node.unpin",
  "text.setDocument",
  "rich-text.setDocument",
  "image.setAnnotations",
  "pdf.setAnnotations",
  "video.setTimeline",
  "audio.setTimeline",
  "database.setRows",
  "database.setFields",
  "collection.setViews",
  "database.setViews",
]);

/** True when a drain may replace an earlier input of the same operation. */
export function isMergeableOperation(operationId: string): boolean {
  return MERGEABLE_OPERATION_IDS.has(operationId);
}

/**
 * The operations a retry may replay after a conflict (§3.5.4.5).
 *
 * They carry the whole value the user sees, so replaying one cannot duplicate a
 * user action; an insertion or an attachment never qualifies.
 */
export function isReplayableOperation(operationId: string): boolean {
  return MERGEABLE_OPERATION_IDS.has(operationId);
}

function mergePreview(
  previous: Partial<NodeData> | undefined,
  next: Partial<NodeData> | undefined,
): Partial<NodeData> | undefined {
  if (previous === undefined) return next;
  if (next === undefined) return previous;
  const merged: Partial<NodeData> = { ...previous, ...next };
  if (previous.content !== undefined && next.content !== undefined) {
    merged.content = {
      ...(previous.content as Record<string, unknown>),
      ...(next.content as Record<string, unknown>),
    } as NodeData["content"];
  }
  return merged;
}

function mergeIntents(
  previous: ContentWriteIntent,
  next: ContentWriteIntent,
): ContentWriteIntent {
  return {
    kind: "operation",
    operationId: previous.operationId,
    input: { ...previous.input, ...next.input },
    ...(() => {
      const preview = mergePreview(previous.preview, next.preview);
      return preview === undefined ? {} : { preview };
    })(),
  };
}

/** True when `next` may be folded into `previous` in one invocation. */
function canMerge(
  previous: ContentWriteIntent,
  next: ContentWriteIntent,
): boolean {
  return (
    previous.operationId === next.operationId &&
    isMergeableOperation(previous.operationId)
  );
}

/**
 * Fold a drain window into the writes it should send, in order.
 *
 * Only **adjacent** intents coalesce: `setDocument(a)`, `setTitle(t)`,
 * `setDocument(b)` is three writes, because the title has to land between the
 * two documents to keep the order the user produced.
 */
export function coalesceIntents(
  intents: readonly ContentWriteIntent[],
): ContentWriteIntent[] {
  const writes: ContentWriteIntent[] = [];
  for (const intent of intents) {
    const previous = writes[writes.length - 1];
    if (previous !== undefined && canMerge(previous, intent)) {
      writes[writes.length - 1] = mergeIntents(previous, intent);
      continue;
    }
    writes.push(intent);
  }
  return writes;
}

/** Include the local projections of queued writes in the next edit's base. */
export function queuedContent<C>(
  content: C,
  intents: readonly ContentWriteIntent[],
): C {
  const overlays = intents
    .map((intent) => intent.preview?.content)
    .filter(
      (overlay): overlay is NonNullable<typeof overlay> => overlay != null,
    );
  if (overlays.length === 0) return content;
  return Object.assign({}, content, ...overlays) as C;
}

/**
 * The local projection of an operation's input, or `undefined` when the
 * operation is not previewable (§3.5.4.3).
 *
 * It names exactly the fields the operation owns: `node.setTitle` may change
 * `title` and nothing else, and `text.setDocument` may change `content.docs`.
 */
export function intentPreview(
  operationId: string,
  input: Record<string, unknown>,
): Partial<NodeData> | undefined {
  switch (operationId) {
    case "node.setTitle":
      return { title: input.title as string };
    case "node.setAbstract":
      return { abstract: input.abstract as string };
    case "node.setSemanticId":
      return { semanticId: input.semanticId as string };
    case "node.setStateData":
      return { stateData: input.stateData as NodeData["stateData"] };
    case "node.setIcon":
      return { icon: input.icon as NodeData["icon"] };
    case "node.clearIcon":
      return { icon: null };
    case "node.setCover":
      return { cover: input.cover as NodeData["cover"] };
    case "node.clearCover":
      return { cover: null };
    case "node.pin":
      return { isPinned: true };
    case "node.unpin":
      return { isPinned: false };
    case "text.setDocument":
    case "rich-text.setDocument":
      return {
        content: { docs: input.docs } as unknown as NodeData["content"],
      };
    case "image.setAnnotations":
    case "pdf.setAnnotations":
      return {
        content: {
          annotations: input.annotations,
        } as unknown as NodeData["content"],
      };
    case "video.setTimeline":
    case "audio.setTimeline":
      return {
        content: {
          timestamps: input.timestamps,
        } as unknown as NodeData["content"],
      };
    case "database.setRows":
      return {
        content: { rows: input.rows } as unknown as NodeData["content"],
      };
    case "database.setFields":
      return {
        content: {
          fields: input.fields,
          rows: input.rows,
        } as unknown as NodeData["content"],
      };
    case "database.setViews":
    case "collection.setViews":
      return {
        content: { views: input.views } as unknown as NodeData["content"],
      };
    default:
      return undefined;
  }
}
