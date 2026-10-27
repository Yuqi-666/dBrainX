// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n } from "@workspace/ui/lib/i18n";

/**
 * The media sidebar — the panel beside an audio/video node's player.
 *
 * Three tabs over the node's **one** timeline (`content.timestamps`):
 *
 * - **字幕** renders the cues (`type: "subtitle"`) as a stream that follows
 *   playback (`subtitle-stream.tsx`). It has no writer: nothing transcribes yet,
 *   so its empty state carries 「生成字幕」 and its cards only seek.
 * - **笔记** renders the notes (`type: "note"`) and is the only writer of the
 *   timeline (`note-cards.tsx`): 加笔记, per-card title/body edits, 转化为节点,
 *   删除.
 * - **AI 总结** is deliberately empty — a reserved surface, not a placeholder
 *   with prose.
 *
 * 字幕 and 笔记 are **two filters over one list** (`subtitlesOf` / `notesOf`),
 * not two readers of two fields: a note and a cue are one stored type in one
 * `nodes` column, so a write from 笔记 rewrites the whole array and carries the
 * transcript along untouched.
 *
 * What lives here, and nowhere else:
 *
 * - **The playhead.** `usePlayhead` is called once, not once per tab: Radix
 *   unmounts the inactive `Tabs.Content` (`Presence`, no `forceMount`), so a
 *   subscription per tab would attach and detach on every switch.
 * - **One `TooltipProvider`.** Radix's tooltip context has no default, and the
 *   alternative — a provider per card — is a provider per row.
 * - **The collapse button.** `onCollapse` is optional: the button beside the
 *   tabs only exists when the host can hide this panel (`MediaNodeLayout` owns
 *   the collapsed state and draws the rail that brings the panel back). The
 *   panel stays **mounted** while hidden, because a draft note in 笔记 and the
 *   tab selection are local state that a collapse must not discard.
 *
 * It is deliberately **stateless about the node**: it receives the timeline and
 * the transport, and reports changes and intents upward. The host
 * (`audio-node-content` / `video-node-content`) owns persistence, node creation,
 * opening a node, and the `Mod-Enter` listener, so this component has no store
 * dependency of its own beyond the node lookup a reference card needs.
 *
 * Sizing: the root fills its box (`h-full min-h-0`) and each tab's list is its
 * only scroll container. Node content is mounted both in a `w-[1200px] h-[80vh]`
 * dialog and full-screen, so the host decides the width and this decides only
 * that nothing here may grow the page (design `node-content/README.md` §0.3-9).
 */
import * as React from "react";
import type {
  NodeId,
  TimestampData,
  TimestampNoteData,
} from "@workspace/interfaces";

import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/ui/tabs";
import { Button } from "@workspace/ui/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@workspace/ui/components/ui/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import { PanelRightCloseIcon } from "lucide-react";

import { subtitlesOf } from "../media-player/types";
import type {
  MediaController,
  TimestampAddRequest,
  TimestampFocusRequest,
} from "../media-player/types";

import { NoteCards } from "./note-cards";
import { SubtitleStream } from "./subtitle-stream";
import { usePlayhead } from "./use-playhead";

/** The three tabs' ids; also the controlled `Tabs` value. */
export type MediaSidebarTab = "subtitles" | "notes" | "summary";

export interface MediaSidebarProps {
  /** The node's timeline (`normalizeTimestamps(...)` of its content). */
  timestamps: readonly TimestampData[];
  /** The complete next timeline — the host writes it verbatim. */
  onTimestampsChange: (timestamps: TimestampData[]) => void;
  /** The player's transport; `null` until it reports one. */
  controller: MediaController | null;
  /** External capture request (`Mod-Enter` / the control bar's 加笔记). */
  addRequest?: TimestampAddRequest | null;
  /** "Focus this note card" — a progress-bar tick's click. */
  focusRequest?: TimestampFocusRequest | null;
  /** 「生成字幕」 — the host's hook for a transcription job. */
  onGenerateSubtitles?: () => void;
  /** 「转化为节点」 — creates the node and answers its id (or `null`). */
  onConvertNote: (note: TimestampNoteData) => Promise<NodeId | null>;
  /** 「打开节点」 on a 节点引用 card. */
  onOpenNode: (nodeId: NodeId) => void;
  /**
   * Hide the panel. The host owns the collapsed state and the rail that brings
   * it back; no button is rendered when the host does not pass this.
   */
  onCollapse?: () => void;
  className?: string;
}

/** `笔记 3` — the count only when there is one, so an empty tab stays quiet. */
function tabLabel(label: string, count: number): React.ReactNode {
  return (
    <>
      {label}
      {count > 0 ? (
        <span className="text-xs tabular-nums text-muted-foreground">
          {count}
        </span>
      ) : null}
    </>
  );
}

export function MediaSidebar({
  timestamps,
  onTimestampsChange,
  controller,
  addRequest,
  focusRequest,
  onGenerateSubtitles,
  onConvertNote,
  onOpenNode,
  onCollapse,
  className,
}: MediaSidebarProps) {
  const { t } = useI18n();

  const [tab, setTab] = React.useState<MediaSidebarTab>("notes");

  // The tabs' contents. Derived here rather than passed in, so the count and the
  // list cannot disagree with the array being written. 笔记 deliberately carries
  // no count: the list is the panel, and a number beside the label was only ever
  // a second way to see the same thing.
  const subtitles = React.useMemo(() => subtitlesOf(timestamps), [timestamps]);
  // One subscription for both lists (see the module docs).
  const playhead = usePlayhead(controller);

  /**
   * The capture request the 笔记 tab has not seen yet.
   *
   * `addRequest` has to survive the switch to 笔记 (the tab that owns the draft),
   * because Radix mounts that panel *after* the tab changes — but it must not
   * survive the panel's next unmount, or every return to 笔记 would re-open a
   * draft from a capture the user made minutes ago. So the token is remembered
   * here, at the level that stays mounted, and only once 笔记 is actually on
   * screen: from then on the request is stale by construction.
   */
  const handledAddTokenRef = React.useRef<number | null>(null);
  const pendingAdd =
    addRequest && addRequest.token !== handledAddTokenRef.current
      ? addRequest
      : null;

  // Capturing a note is a request to *see* it: the draft is created in 笔记, so
  // an unmounted panel would swallow the gesture whole.
  React.useEffect(() => {
    if (addRequest) setTab("notes");
  }, [addRequest]);

  React.useEffect(() => {
    if (tab === "notes" && pendingAdd) {
      handledAddTokenRef.current = pendingAdd.token;
    }
  }, [tab, pendingAdd]);

  // A tick's click focuses a note card, so it also selects the tab that holds
  // it. `token` is what makes a repeat re-focus (the sidebar may be showing 字幕
  // again by then).
  React.useEffect(() => {
    if (focusRequest) setTab("notes");
  }, [focusRequest]);

  return (
    <TooltipProvider delayDuration={200}>
      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as MediaSidebarTab)}
        className={cn("flex h-full min-h-0 flex-col gap-2", className)}
        data-slot="media-sidebar"
      >
        {/* The tabs share the row with the collapse button. `min-w-0 flex-1`
            rather than `w-full`: the list has to give the button its 32px even
            when the labels already want more than the panel has. */}
        <div className="flex shrink-0 items-center gap-1">
          <TabsList className="min-w-0 flex-1">
            <TabsTrigger value="subtitles">
              {tabLabel(t("字幕"), subtitles.length)}
            </TabsTrigger>
            <TabsTrigger value="notes">{t("笔记")}</TabsTrigger>
            <TabsTrigger value="summary">{t("AI 总结")}</TabsTrigger>
          </TabsList>
          {onCollapse ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("收起侧栏")}
                  onClick={onCollapse}
                  className="text-muted-foreground"
                >
                  <PanelRightCloseIcon />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left">{t("收起侧栏")}</TooltipContent>
            </Tooltip>
          ) : null}
        </div>

        {/* `min-h-0` on each panel is what lets the tab's own scroll area be the
            thing that shrinks, instead of the list pushing the box past the
            host's height. No `display` utility: Radix marks a panel it is not
            showing with the `hidden` **attribute**, and an author `display` class
            would win over it. */}
        <TabsContent value="subtitles" className="min-h-0 flex-1">
          <SubtitleStream
            timestamps={subtitles}
            controller={controller}
            playhead={playhead}
            onGenerateSubtitles={onGenerateSubtitles}
          />
        </TabsContent>
        <TabsContent value="notes" className="min-h-0 flex-1">
          <NoteCards
            timestamps={timestamps}
            controller={controller}
            onTimestampsChange={onTimestampsChange}
            addRequest={pendingAdd}
            focusRequest={focusRequest}
            playhead={playhead}
            onConvertNote={onConvertNote}
            onOpenNode={onOpenNode}
          />
        </TabsContent>
        {/* Deliberately empty: a reserved tab, with no prose pretending it is
            a feature. */}
        <TabsContent value="summary" className="min-h-0 flex-1" />
      </Tabs>
    </TooltipProvider>
  );
}
