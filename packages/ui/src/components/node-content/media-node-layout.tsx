// SPDX-License-Identifier: AGPL-3.0-only

"use client";

/**
 * The box an audio/video node content draws: the player on the left, the media
 * sidebar on the right.
 *
 * One component because the layout rules are the same for both node types and
 * are easy to get subtly wrong:
 *
 * - **`min-h-0` at every level.** Node content is mounted both full-screen and
 *   inside a `w-[1200px] h-[80vh]` dialog, so the media box must be able to
 *   shrink below its content — without `min-h-0` the flex children push the box
 *   past the dialog and the sidebar's scroll box never gets a height
 *   (`node-content/README.md` §0.3-9, gate G6-7).
 * - **The sidebar is measured, not proportional.** A fixed `lg:w-80` keeps the
 *   cards a readable measure and leaves the player the rest; below `lg` the two
 *   stack, because a 320px sidebar next to a 320px player is useless.
 * - **The sidebar collapses.** The picture is what the node is for, so the panel
 *   can be hidden and the player takes the width back. The collapsed state lives
 *   here because the rail that restores the panel is a sibling of it, and the
 *   panel is only *hidden*, never unmounted: a draft note in 笔记 and the tab
 *   selection are local state there. A capture (`Mod-Enter`, the control bar's
 *   加笔记) or a progress-bar tick is a request to see the panel, so both
 *   expand it.
 * - **The keyboard lives on this box.** `tabIndex={0}` + `onKeyDown` is where
 *   `Mod-Enter` is captured — never on `document` (plan §M6.2-④), so the node
 *   editor dialog and the dynamic island keep their own keys.
 *
 * The three node-level intents (`转化为节点` / `打开节点` / `生成字幕`) are props
 * rather than calls into the store from the sidebar, so the panel stays a
 * presentational surface and the host keeps the write path.
 */
import * as React from "react";
import type { ReactNode } from "react";
import { PanelRightOpenIcon } from "lucide-react";
import type {
  NodeId,
  TimestampData,
  TimestampNoteData,
} from "@workspace/interfaces";

import { MediaSidebar } from "@workspace/ui/components/media-sidebar/media-sidebar";
import { useI18n } from "@workspace/ui/lib/i18n";
import { cn } from "@workspace/ui/lib/utils";

import type {
  MediaController,
  TimestampAddRequest,
  TimestampFocusRequest,
} from "@workspace/ui/components/media-player/types";

export interface MediaNodeLayoutProps {
  /** The player (or the host's failure panel) — the left column. */
  children: ReactNode;
  /** The node's whole timeline — notes and cues, one array (`content.timestamps`). */
  timestamps: readonly TimestampData[];
  /** The complete next timeline; the sidebar's 笔记 tab is the only writer. */
  onTimestampsChange: (timestamps: TimestampData[]) => void;
  controller: MediaController | null;
  addRequest: TimestampAddRequest | null;
  focusRequest: TimestampFocusRequest | null;
  /** 「转化为节点」 — the host creates the node and answers its id. */
  onConvertNote: (note: TimestampNoteData) => Promise<NodeId | null>;
  /** 「打开节点」 on a 节点引用 card. */
  onOpenNode: (nodeId: NodeId) => void;
  /** 「生成字幕」 — reserved for the transcription job. */
  onGenerateSubtitles?: () => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  className?: string;
}

export function MediaNodeLayout({
  children,
  timestamps,
  onTimestampsChange,
  controller,
  addRequest,
  focusRequest,
  onConvertNote,
  onOpenNode,
  onGenerateSubtitles,
  onKeyDown,
  className,
}: MediaNodeLayoutProps) {
  const { t } = useI18n();
  const [collapsed, setCollapsed] = React.useState(false);

  // Both requests exist to put something *in front of the reader*: a capture
  // opens the draft in 笔记, a tick focuses a card. A hidden panel would swallow
  // the gesture, so the request expands it before the sidebar's own effect
  // selects the tab.
  React.useEffect(() => {
    if (addRequest) setCollapsed(false);
  }, [addRequest]);
  React.useEffect(() => {
    if (focusRequest) setCollapsed(false);
  }, [focusRequest]);

  return (
    <div
      tabIndex={0}
      onKeyDown={onKeyDown}
      className={cn(
        "flex h-full min-h-0 w-full flex-col gap-3 p-4 outline-none lg:flex-row",
        className,
      )}
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>

      {/* Hidden, not unmounted: 笔记's draft and the selected tab survive a
          collapse (see the module docs). `hidden` is `display: none`, so the
          player's `flex-1` takes the width the panel gave back. */}
      <MediaSidebar
        timestamps={timestamps}
        onTimestampsChange={onTimestampsChange}
        controller={controller}
        addRequest={addRequest}
        focusRequest={focusRequest}
        onGenerateSubtitles={onGenerateSubtitles}
        onConvertNote={onConvertNote}
        onOpenNode={onOpenNode}
        onCollapse={() => setCollapsed(true)}
        className={cn("w-full shrink-0 lg:w-80", collapsed && "hidden")}
      />

      {/* The rail that brings the panel back. On `lg` it is a narrow full-height
          column on the right edge, where the panel was; below `lg` the columns
          stack, so it becomes a full-width row under the player. */}
      {collapsed ? (
        <button
          type="button"
          aria-label={t("展开侧栏")}
          aria-expanded={false}
          onClick={() => setCollapsed(false)}
          className={cn(
            "flex shrink-0 items-center justify-center gap-2 rounded-lg border border-border/60 bg-muted/20 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
            "w-full py-2 lg:w-9 lg:py-0",
          )}
        >
          <PanelRightOpenIcon className="size-4" />
          <span className="lg:hidden">{t("展开侧栏")}</span>
        </button>
      ) : null}
    </div>
  );
}
