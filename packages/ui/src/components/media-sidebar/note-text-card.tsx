// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n } from "@workspace/ui/lib/i18n";

/**
 * A 文本笔记 card: a title, the 定位 / 更多 actions, and a rich-text body that is
 * **always editable** — there is no display mode and no 编辑 button.
 *
 * That is the one structural difference from the editor M6 shipped: the card is
 * the editor, because the note is a single paragraph and a second mode only
 * bought a click. Both fields therefore write on their own schedule
 * (`useAutoCommit`): a burst of typing becomes one write, a blur ends the burst,
 * and nothing has a save button to forget.
 *
 * The title is **uncontrolled** (`defaultValue`). The card is keyed by the
 * note's id and never re-seeds, and the store echoes a write straight back — a
 * controlled value would move the caret to the end of the line on every
 * keystroke, which is exactly the bug `node-content-header.tsx`'s
 * `useEchoSafeText` exists to fix. Not being controlled at all is the cheaper
 * answer here, because nothing else in the sidebar writes a note's title.
 *
 * 「更多」 is where a note leaves the timeline: **转化为节点** turns it into a
 * rich-text node (the sidebar asks the host, then points the note at the result)
 * and **删除** removes it. Both are one dropdown, so a destructive item is never
 * a stray click away from the body.
 */
import { FileInput, MoreHorizontal, Trash2 } from "lucide-react";
import type { TimestampNoteData } from "@workspace/interfaces";

import { Button } from "@workspace/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/ui/dropdown-menu";
import { Input } from "@workspace/ui/components/ui/input";

import type { MediaController, NoteDoc } from "../media-player/types";

import { NoteBodyEditor } from "./note-body-editor";
import { NoteCardShell } from "./note-card-shell";
import { useAutoCommit } from "./use-auto-commit";

export interface NoteTextCardProps {
  note: TimestampNoteData;
  controller: MediaController | null;
  focused: boolean;
  /**
   * The unpersisted 加笔记 card.
   *
   * A draft has no 更多 menu: 转化为节点 would build a node out of a note that has
   * not been written yet, and 删除 is the same act as walking away from it (which
   * the card does by itself). The timestamp's 定位 stays, because the frame the
   * note *will* land on is exactly what a user wants to confirm before typing.
   */
  draft?: boolean;
  /** This is a fresh draft: its title takes the caret. */
  autoFocusTitle: boolean;
  onLocate: () => void;
  /** A partial write onto this note (the sidebar merges it into the timeline). */
  onPatch: (patch: Partial<TimestampNoteData>) => void;
  /** 「转化为节点」 — the host creates the node; the sidebar then references it. */
  onConvert: () => void;
  onDelete: () => void;
  /** Focus left the card altogether — the empty draft cancels itself. */
  onFocusLeave?: () => void;
  cardRef?: (element: HTMLDivElement | null) => void;
}

export function NoteTextCard({
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
  cardRef,
}: NoteTextCardProps) {
  const { t } = useI18n();

  const { schedule: scheduleTitle, flush: flushTitle } = useAutoCommit<string>(
    (value: string) => onPatch({ title: value }),
  );
  const { schedule: scheduleBody } = useAutoCommit<NoteDoc>((doc: NoteDoc) =>
    onPatch({ content: doc }),
  );

  return (
    <NoteCardShell
      noteId={note.id}
      timeMs={note.timeMs}
      disabled={!controller}
      focused={focused}
      onLocate={onLocate}
      onFocusLeave={onFocusLeave}
      cardRef={cardRef}
      header={
        <Input
          defaultValue={note.title ?? ""}
          onChange={(event) => scheduleTitle(event.target.value)}
          onBlur={flushTitle}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            // The single-block body swallows `Enter`; a title that committed on
            // it would be the only control here with an invisible key. Ending
            // the burst is enough, and deliberately does not blur.
            event.preventDefault();
            flushTitle();
          }}
          placeholder={t("标题")}
          aria-label={t("笔记标题")}
          autoFocus={autoFocusTitle}
          className="h-7 min-w-0 flex-1 border-transparent bg-transparent px-1 text-sm font-medium shadow-none focus-visible:border-ring dark:bg-transparent"
        />
      }
      actions={
        // No 更多 on a draft — see the prop docs.
        draft ? undefined : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={t("更多操作")}
              >
                <MoreHorizontal aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={onConvert}>
                <FileInput aria-hidden />
                {t("转化为节点")}{" "}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                <Trash2 aria-hidden />
                {t("删除")}{" "}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )
      }
    >
      <NoteBodyEditor
        content={note.content}
        onCommit={(doc) => scheduleBody(doc)}
      />
    </NoteCardShell>
  );
}
