// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { translate } from "@workspace/ui/lib/i18n/runtime";

import { useI18n } from "@workspace/ui/lib/i18n";

/**
 * A note card's body: `packages/editor`'s one-paragraph rich-text editor, wired
 * for a surface that has no save button.
 *
 * The template (`SingleBlockEditor`) is uncontrolled — it seeds itself once from
 * `initialContent` and reports every change through `onContentChange` — which is
 * exactly right for a note: one paragraph of rich text, no collaboration, no
 * room for a second block. Two things it does not provide are added here:
 *
 * - **A write schedule.** `useAutoCommit` batches a burst of typing into one
 *   write and flushes it on blur and on unmount, so a card that is never
 *   "saved" still cannot lose a line.
 * - **A box that reads as editable.** The template draws only the ProseMirror
 *   surface; the focus ring the rest of the sidebar's inputs wear is applied by
 *   the wrapper on `focus-within`.
 *
 * Inline marks and the inline formula come with the template, plus its selection
 * bubble (`SingleBlockToolbar`), so a note can carry bold / italic / code / link
 * / colour / highlight without leaving the card. `Enter` never starts a second
 * paragraph: the template swallows it, which is also why the card's commit is a
 * blur rather than a key.
 */
import { SingleBlockEditor } from "@workspace/editor/components/tiptap-templates/single-block/single-block-editor";
import { cn } from "@workspace/ui/lib/utils";

import type { NoteDoc } from "../media-player/types";

import { useAutoCommit } from "./use-auto-commit";

export interface NoteBodyEditorProps {
  /**
   * The stored document (`note.content`).
   *
   * Read **once** by the editor: the card is keyed by the note's id, so a write
   * echoing back through the store re-renders the card without re-seeding the
   * editor under the caret.
   */
  content: unknown;
  /** Receives the whole document after the debounce (or on blur). */
  onCommit: (doc: NoteDoc) => void;
  placeholder?: string;
  className?: string;
}

export function NoteBodyEditor({
  content,
  onCommit,
  placeholder = translate("写点什么…"),
  className,
}: NoteBodyEditorProps) {
  useI18n();

  const { schedule, flush } = useAutoCommit<NoteDoc>(onCommit);

  return (
    <div
      onBlur={flush}
      className={cn(
        "rounded-md border border-transparent px-1.5 py-1 transition-[color,box-shadow,border-color] focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/40",
        className,
      )}
      data-slot="note-body-editor"
    >
      <SingleBlockEditor
        initialContent={content}
        placeholder={placeholder}
        className="text-xs leading-relaxed"
        onContentChange={(next) => schedule(next as NoteDoc)}
      />
    </div>
  );
}
