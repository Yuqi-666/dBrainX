"use client";

/**
 * The timestamp plumbing an audio/video node content needs, in one place.
 *
 * Both media hosts do exactly the same things, and they must keep doing them the
 * same way:
 *
 * 1. **Read the one stored list through its normalizer** (`normalizeTimestamps`
 *    upgrades a pre-unification note — an M6 `text` body, or a separate `doc` —
 *    to a `content` document, and a pre-unification cue's `startMs` to `timeMs`).
 *    Reading is lazy — nothing is written back until an edit.
 * 2. **Write through the shared queue** (`useNodeContentWriter`): one gesture is
 *    one upsert, and a content patch merges onto the **live** content half, so
 *    adding a note cannot wipe `url` / `hlsUrl` / `coverUrl`.
 * 3. **Hold the transport** the player reports, so the sidebar can seek and the
 *    keyboard path can read the playhead.
 * 4. **Mint the two request tokens** — `Mod-Enter`/加笔记 → the note list, and a
 *    tick's click → the card. A token is what makes a repeat work: the same
 *    millisecond produces the same request, and only a changed token tells the
 *    sidebar to run it again.
 * 5. **Capture `Mod-Enter` on the content box, never on `document`** — the node
 *    editor dialog and the dynamic island own their own keys (plan §M6.2-④).
 * 6. **Own the two node-level intents** the sidebar raises — 「转化为节点」 and
 *    「打开节点」. Both need the *node* (the new node inherits its `semanticId`),
 *    and both are host concerns: the sidebar reports the gesture and never
 *    reaches for `NodeService` or `useUIStore` itself.
 */
import * as React from "react";
import type {
  NodeData,
  NodeId,
  RichTextNodeData,
  TimestampData,
  TimestampNoteData,
  TimestampSubtitleData,
} from "@workspace/interfaces";

import { NodeService } from "@workspace/services";
import { useUIStore } from "@workspace/store";

import {
  normalizeTimestamps,
  noteTitle,
  notesOf,
  sortTimestamps,
  subtitlesOf,
} from "@workspace/ui/components/media-player/types";
import type {
  MediaController,
  MediaControllerCallback,
  TimestampAddRequest,
  TimestampFocusRequest,
  TimestampNoteActivation,
} from "@workspace/ui/components/media-player/types";

import { useNodeContentWriter } from "./use-node-content-writer";

/**
 * The half of a media node's `content` this layer owns.
 *
 * One key, not the two it used to be: notes and subtitle cues are one array of
 * one discriminated type in one `nodes` column, so a write is one content patch
 * and there is no cross-half merge to get wrong.
 */
export interface MediaTimestampHalves {
  timestamps?: TimestampData[];
}

/** The node facts this layer needs — `id` to write, `semanticId` to convert. */
export type MediaTimestampNode = Pick<
  NodeData,
  "id" | "nodeType" | "semanticId"
>;

export interface MediaTimestampLayer {
  /** The player's transport (or `null` before it reports one). */
  controller: MediaController | null;
  /** Pass to the player's `onMediaController`. */
  onMediaController: MediaControllerCallback;
  /** The node's whole normalized timeline (notes and cues, stored order). */
  timestamps: TimestampData[];
  /**
   * The notes among them — what the player draws as progress-bar ticks.
   *
   * Memoized here rather than filtered in the host's render, so the player's own
   * `useMemo` over this prop keeps its identity between renders. Cues are
   * deliberately not ticks: a transcript's hundreds of them would bury the bar.
   */
  notes: TimestampNoteData[];
  /**
   * The subtitle cues among them, ascending by start time — what the player
   * draws over the picture.
   *
   * Sorted here, not in the player: `activeCueIndex` assumes `sortTimestamps`
   * order, and doing it once keeps the overlay and the sidebar agreeing on
   * which line is "current" for a timeline stored out of order.
   */
  subtitles: TimestampSubtitleData[];
  /** The complete next timeline — the writer persists it verbatim. */
  onTimestampsChange: (timestamps: TimestampData[]) => void;
  /** The `Mod-Enter` / 加笔记 request in flight. */
  addRequest: TimestampAddRequest | null;
  /** The "focus this note card" request in flight. */
  focusRequest: TimestampFocusRequest | null;
  /** The player's control-bar 加笔记 button, with the playhead. */
  onAddNoteRequest: (timeMs: number) => void;
  /** A progress-bar tick's click, with the notes that live there. */
  onActivateNote: (activation: TimestampNoteActivation) => void;
  /** The content box's `onKeyDown` (only `Mod-Enter` is acted on). */
  onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  /** 「转化为节点」 — create a `rich-text` node from a note, answer its id. */
  onCreateNodeFromNote: (note: TimestampNoteData) => Promise<NodeId | null>;
  /** 「打开节点」 on a 节点引用 card. */
  onOpenNode: (nodeId: NodeId) => void;
}

export function useMediaTimestamps<C extends MediaTimestampHalves>(
  node: MediaTimestampNode,
  content: C,
): MediaTimestampLayer {
  const { patchContent } = useNodeContentWriter<C>(
    node.id,
    node.nodeType,
    content,
  );

  const [controller, setController] = React.useState<MediaController | null>(
    null,
  );
  const [addRequest, setAddRequest] =
    React.useState<TimestampAddRequest | null>(null);
  const [focusRequest, setFocusRequest] =
    React.useState<TimestampFocusRequest | null>(null);

  // One counter per request kind: the token only has to be new, and keeping the
  // two apart means a tick's click cannot be mistaken for a capture.
  const addToken = React.useRef(0);
  const focusToken = React.useRef(0);

  // `?? []` before the normalizer: a record that never had a timestamp is the
  // normal case, not a malformed one.
  const timestamps = React.useMemo(
    () => normalizeTimestamps(content.timestamps ?? []),
    [content.timestamps],
  );

  const notes = React.useMemo(() => notesOf(timestamps), [timestamps]);

  const subtitles = React.useMemo(
    () => sortTimestamps(subtitlesOf(timestamps)),
    [timestamps],
  );

  const onTimestampsChange = React.useCallback(
    (next: TimestampData[]) => {
      patchContent({ timestamps: next } as Partial<C>);
    },
    [patchContent],
  );

  const onAddNoteRequest = React.useCallback((timeMs: number) => {
    addToken.current += 1;
    setAddRequest({ timeMs, token: addToken.current });
  }, []);

  const onActivateNote = React.useCallback(
    (activation: TimestampNoteActivation) => {
      focusToken.current += 1;
      setFocusRequest({ ...activation, token: focusToken.current });
    },
    [],
  );

  const onKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (!(event.metaKey || event.ctrlKey) || event.key !== "Enter") return;
      event.preventDefault();
      // Before metadata there is no playhead to anchor to; `0` is the honest
      // answer and the card the sidebar opens shows where the note will land.
      onAddNoteRequest(controller ? controller.getCurrentTimeMs() : 0);
    },
    [controller, onAddNoteRequest],
  );

  /**
   * 「转化为节点」: a note becomes a `rich-text` node.
   *
   * The new node carries the note's title ({@link noteTitle} stands in for an
   * untitled one) and its document under `docs` — which is the key
   * `<RichTextNodeContent>` seeds its `NotionEditor` from, so the body arrives
   * intact rather than as an empty page. It inherits the media node's
   * `semanticId`, because a note has no semantic of its own and asking the user
   * for one mid-gesture would be a second modal for a single click.
   *
   * A failed create answers `null` and logs: the sidebar then leaves the note as
   * a 文本笔记 rather than turning it into a reference to nothing.
   */
  const onCreateNodeFromNote = React.useCallback(
    async (note: TimestampNoteData): Promise<NodeId | null> => {
      const now = new Date().toISOString();
      const draft: RichTextNodeData = {
        // The backend mints the real id; the placeholder is the same one
        // `useGraph`'s create path sends.
        id: "tmp_",
        title: noteTitle(note),
        nodeType: "rich-text",
        permission: "private",
        semanticId: node.semanticId,
        createdAt: now,
        updatedAt: now,
        content: { referencedNodes: [], docs: note.content },
      };

      try {
        const created = (await NodeService.upsert(draft)) as NodeData | void;
        return created?.id ?? null;
      } catch (error) {
        console.error("[media] 转化为节点失败:", error);
        return null;
      }
    },
    [node.semanticId],
  );

  const onOpenNode = React.useCallback((nodeId: NodeId) => {
    useUIStore.getState().handleNodeEdit(nodeId);
  }, []);

  return {
    controller,
    onMediaController: setController,
    timestamps,
    notes,
    subtitles,
    onTimestampsChange,
    addRequest,
    focusRequest,
    onAddNoteRequest,
    onActivateNote,
    onKeyDown,
    onCreateNodeFromNote,
    onOpenNode,
  };
}
