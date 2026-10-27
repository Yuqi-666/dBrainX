// SPDX-License-Identifier: AGPL-3.0-only

"use client";

/**
 * One note, rendered as whichever card shape it is.
 *
 * The discriminator is `note.nodeId` and it is the **only** branch: a note that
 * points at a node is a 节点引用, and a note that does not is a 文本笔记. Both
 * write through the same `onPatch` / `onDelete`, so the list above does not have
 * to know which shape a card has either — it hands every card the same verbs.
 */
import type { NodeId, TimestampNoteData } from "@workspace/interfaces";

import type { MediaController } from "../media-player/types";

import { NoteReferenceCard } from "./note-reference-card";
import { NoteTextCard } from "./note-text-card";

export interface NoteCardProps {
  note: TimestampNoteData;
  controller: MediaController | null;
  /** Ringed because a progress-bar tick just sent the user here. */
  focused: boolean;
  /**
   * The unpersisted 加笔记 card. It renders as a 文本笔记 either way — a draft has
   * no `nodeId` — but it drops the 更多 menu, which would offer 转化为节点 on a
   * note that does not exist yet.
   */
  draft?: boolean;
  /** This is a fresh draft: its title takes the caret. */
  autoFocusTitle: boolean;
  onLocate: () => void;
  onPatch: (patch: Partial<TimestampNoteData>) => void;
  /** The host creates the node; the list then points this note at it. */
  onConvert: () => void;
  onDelete: () => void;
  /** Focus moved off the card entirely (the empty draft cancels itself). */
  onFocusLeave?: () => void;
  onOpenNode: (nodeId: NodeId) => void;
  cardRef?: (element: HTMLDivElement | null) => void;
}

export function NoteCard({
  note,
  controller,
  focused,
  draft = false,
  autoFocusTitle,
  onLocate,
  onPatch,
  onConvert,
  onDelete,
  onFocusLeave,
  onOpenNode,
  cardRef,
}: NoteCardProps) {
  if (note.nodeId) {
    const nodeId = note.nodeId;
    return (
      <NoteReferenceCard
        noteId={note.id}
        nodeId={nodeId}
        timeMs={note.timeMs}
        controller={controller}
        focused={focused}
        onLocate={onLocate}
        onOpenNode={() => onOpenNode(nodeId)}
        onUnreference={onDelete}
        cardRef={cardRef}
      />
    );
  }

  return (
    <NoteTextCard
      note={note}
      controller={controller}
      focused={focused}
      draft={draft}
      autoFocusTitle={autoFocusTitle}
      onLocate={onLocate}
      onPatch={onPatch}
      onConvert={onConvert}
      onDelete={onDelete}
      onFocusLeave={onFocusLeave}
      cardRef={cardRef}
    />
  );
}
