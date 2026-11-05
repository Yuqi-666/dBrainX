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
 * It also carries the editor vocabulary a node type's editor is built from: the
 * content header and its icon classes, the media layout the audio and video
 * editors share, the shadcn primitives they draw with, the players and viewers
 * they embed, and the pickers they open. Those were deep imports of
 * `components/*` before this list existed (§0.3 第 3 行, §14 第 10 行).
 *
 * The list is closed. Every export here becomes public API that a plugin package
 * outside this repository may import, so nothing is added "while we are there":
 * a new name is a new contract, and the export set is asserted by
 * `exports.test.ts`.
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

/** The node content header, its icon classes, and the media editor's layout. */
export {
  NodeContentHeader,
  NODE_ICON_PLATE,
  NODE_ICON_GLYPH,
  NODE_ICON_FALLBACK,
} from "../components/node-content/node-content-header";
export { MediaNodeLayout } from "../components/node-content/media-node-layout";
export { useMediaTimestamps } from "../components/node-content/use-media-timestamps";
export { getNodeContentDescriptor } from "../components/node-content/registry";

/** The primitives an editor draws with, and the toast it reports through. */
export { Button } from "../components/ui/button";
export { Input } from "../components/ui/input";
export { toast } from "../components/ui/toast";

/** The players and the preview cover a content editor embeds. */
export { AudioPlayer } from "../components/media-player/audio-player/audio-player";
export { VideoPlayer } from "../components/media-player/video-player/video-player";
export { NativeVideoPlayer } from "../components/media-player/video-player/native-video-player";
export { NodePreviewCover } from "../components/preview-block/node-preview-cover";
export type { NodeCoverContribution } from "../components/preview-block/node-preview-cover";

/** The pickers and viewers an editor opens. */
export { CollectionFilterDialog } from "../components/dialog/collection-filter-dialog";
export { CoverSelectorPopover } from "../components/selector/cover-selector-popover";
export { IconSelectorPopover } from "../components/selector/icon-selector-popover";
export { IconView } from "../components/icon/icon-view";
export { ImageViewer } from "../components/image-viewer/image-viewer";
export { PdfViewer } from "../components/pdf-viewer/pdf-viewer";
export type { PdfLoadFailure } from "../components/pdf-viewer/types";
export { CodeEditor, languageFromFilename } from "../components/code-editor/code-editor";

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
