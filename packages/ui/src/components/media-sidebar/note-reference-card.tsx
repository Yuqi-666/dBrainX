// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { translate } from "@workspace/ui/lib/i18n/runtime";

import { useI18n } from "@workspace/ui/lib/i18n";

import { FileText, Unlink } from "lucide-react";

import { useDataStore } from "@workspace/store";

import { Button } from "@workspace/ui/components/ui/button";
import { IconView } from "@workspace/ui/components/icon/icon-view";
import { NODE_TYPE_ICONS } from "@workspace/ui/components/icon/node-type-icons";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/ui/tooltip";

import type { MediaController } from "../media-player/types";

import { NoteCardShell } from "./note-card-shell";

export interface NoteReferenceCardProps {
  noteId: string;
  /** The referenced node's id (`note.nodeId`). */
  nodeId: string;
  timeMs: number;
  controller: MediaController | null;
  focused: boolean;
  onLocate: () => void;
  /** Open the node's editor page. */
  onOpenNode: () => void;
  /** 「取消引用」 — removes this note (the node itself stays). */
  onUnreference: () => void;
  cardRef?: (element: HTMLDivElement | null) => void;
}

export function NoteReferenceCard({
  noteId,
  nodeId,
  timeMs,
  controller,
  focused,
  onLocate,
  onOpenNode,
  onUnreference,
  cardRef,
}: NoteReferenceCardProps) {
  const { t } = useI18n();

  const node = useDataStore((state) => state.getNode(nodeId));
  const TypeIcon = node ? NODE_TYPE_ICONS[node.nodeType] : FileText;
  const title = node?.title?.trim() || t("未命名节点");

  return (
    <NoteCardShell
      noteId={noteId}
      timeMs={timeMs}
      disabled={!controller}
      focused={focused}
      onLocate={onLocate}
      cardRef={cardRef}
      header={
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          <IconView
            icon={node?.icon ?? undefined}
            fallback={
              <TypeIcon
                className="size-4 shrink-0 text-muted-foreground"
                aria-hidden
              />
            }
            className="size-4 shrink-0 text-muted-foreground"
          />
          {node ? (
            <button
              type="button"
              onClick={onOpenNode}
              aria-label={translate("打开节点 {value1}", { value1: title })}
              title={t("打开节点")}
              className="min-w-0 truncate rounded-sm text-sm font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
            >
              {title}
            </button>
          ) : (
            <span className="min-w-0 truncate text-sm text-muted-foreground italic">
              {t("节点已删除")}{" "}
            </span>
          )}
        </span>
      }
      actions={
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={onUnreference}
              aria-label={t("取消引用")}
            >
              <Unlink aria-hidden />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left">{t("取消引用")}</TooltipContent>
        </Tooltip>
      }
    />
  );
}
