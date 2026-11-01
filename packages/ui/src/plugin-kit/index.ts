// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The plugin kit: the only `@workspace/ui` surface a plugin package may import
 * (§4.10.2).
 *
 * A node type's editor lives in its plugin package, but the stable pieces it
 * needs are shared — the drop zone that turns a dropped file into a stored
 * resource, the writer every editor persists through, the merge rules behind
 * that writer, and the media vocabulary the players and the timeline agree on.
 * They are re-exported here instead of reaching into
 * `components/node-content/*`, so a third-party plugin depends on one documented
 * subpath (`@workspace/ui/plugin-kit`) and the internals stay free to move.
 *
 * Nothing else belongs in this file. Every export here becomes public API that
 * a plugin package outside this repository may import, and the editor internals
 * (headers, media layouts, pickers, viewers) are deliberately not part of it.
 */

export { FileDropZone } from "../components/node-content/file-drop-zone";
export {
  useNodeContentWriter,
  createContentWriteQueue,
  OPERATION_NOT_DECLARED,
  type ContentInvocation,
  type ContentWriteFailure,
  type ContentWriteOutcome,
  type ContentWriteQueue,
  type NodeContentWriter,
} from "../components/node-content/use-node-content-writer";
export {
  coalesceIntents,
  intentPreview,
  isMergeableOperation,
  isReplayableOperation,
  queuedContent,
  type ContentWriteIntent,
  type OperationWriteIntent,
} from "../components/node-content/node-content-patches";

/** The media layer's own types (players, timeline, notes). */
export type {
  MediaController,
  MediaControllerCallback,
  NoteCluster,
  NoteDoc,
  TimestampAddRequest,
  TimestampFocusRequest,
  TimestampNoteActivation,
  TooltipAlignment,
} from "../components/media-player/types";
/** The media payload vocabulary a node's `content` carries. */
export type {
  MediaKind,
  TimestampData,
  TimestampKind,
  TimestampNoteData,
  TimestampSubtitleData,
} from "@workspace/interfaces";
