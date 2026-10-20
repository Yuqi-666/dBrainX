// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n } from "@workspace/ui/lib/i18n";

import { useCallback, useEffect, useRef } from "react";
import type {
  NodeData,
  RichTextContent,
  RichTextNodeData,
} from "@workspace/interfaces";
import { NotionEditor } from "@workspace/editor/components/tiptap-templates/notion-like/notion-like-editor";
import { useDataStore, useUIStore } from "@workspace/store";
import { Button } from "@workspace/ui/components/ui/button";
import { CoverSelectorPopover } from "@workspace/ui/components/selector/cover-selector-popover";
import { IconSelectorPopover } from "@workspace/ui/components/selector/icon-selector-popover";
import { IconView } from "@workspace/ui/components/icon/icon-view";
import { NODE_TYPE_ICONS } from "@workspace/ui/components/icon/node-type-icons";
import { NodePreviewCover } from "@workspace/ui/components/preview-block/node-preview-cover";
import { cn } from "@workspace/ui/lib/utils";
import {
  NODE_ICON_FALLBACK,
  NODE_ICON_GLYPH,
  NODE_ICON_PLATE,
  NodeContentHeader,
} from "./node-content-header";
import { useNodeContentWriter } from "./use-node-content-writer";

/** How many nodes 「从节点选」offers before the search narrows it. */
const CANDIDATE_LIMIT = 24;

/** How long typing has to pause before the body is written. */
const RICH_TEXT_WRITE_DEBOUNCE_MS = 400;

interface RichTextNodeContentProps {
  node: RichTextNodeData;
  className?: string;
}

export function RichTextNodeContent({
  node,
  className,
}: RichTextNodeContentProps) {
  const { t } = useI18n();

  // The host renders the live node: the header's inputs are one-way (`node.title`
  // in, `patchNode` out) and `NodeService.upsert` updates the store synchronously,
  // so this subscription is what makes typing echo back.
  const liveNode = useDataStore((state) => state.getNode(node.id)) ?? node;
  // Bumped only when the store content is replaced from outside (清空节点, a
  // deleted file stripping an embedded image). It joins the editor key below,
  // so such a replacement remounts the uncontrolled editor; typing does not
  // touch it.
  const contentReset = useUIStore(
    (state) => state.nodeContentReset[node.id] ?? 0,
  );
  const writer = useNodeContentWriter<RichTextContent>(
    node.id,
    "rich-text",
    node.content,
  );

  // The document the editor is about to persist, **together with the writer that
  // owns it**, and the timer that will send it — the same shape as the text
  // node's host (`text-node-content.tsx`). Carrying the writer is what makes a
  // node switch safe: a debounce armed for the old node cannot fire through the
  // new node's writer and copy one node's body into another.
  const pending = useRef<{
    patchContent: (patch: Partial<RichTextContent>) => void;
    docs: RichTextContent["docs"];
  } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // `patchContent` changes identity whenever the store does (its live-content
  // reader depends on this render's node), so hold it in a ref instead of
  // rebuilding the flush callback — the unmount cleanup has to stay stable.
  const patchRef = useRef(writer.patchContent);
  useEffect(() => {
    patchRef.current = writer.patchContent;
  }, [writer.patchContent]);

  const flush = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const queued = pending.current;
    if (queued === null) return;
    pending.current = null;
    queued.patchContent({ docs: queued.docs });
  }, []);

  const handleBodyChange = useCallback(
    (docs: unknown) => {
      pending.current = {
        patchContent: patchRef.current,
        docs: docs as RichTextContent["docs"],
      };
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(flush, RICH_TEXT_WRITE_DEBOUNCE_MS);
    },
    [flush],
  );

  // Unmount (closing the dialog, switching the node) persists whatever the
  // debounce still holds, so the last keystrokes survive an immediate close.
  useEffect(() => flush, [flush]);

  // An external replacement wins over whatever the debounce still holds: drop
  // the queued document so a timer armed a moment ago cannot write the old
  // content back after the clear.
  useEffect(() => {
    pending.current = null;
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, [contentReset]);

  const listNodes = useCallback(
    (query: string): NodeData[] => {
      const needle = query.trim().toLowerCase();
      return [...useDataStore.getState().nodes.values()]
        .filter((candidate) => candidate.id !== node.id)
        .filter((candidate) =>
          needle ? candidate.title.toLowerCase().includes(needle) : true,
        )
        .slice(0, CANDIDATE_LIMIT);
    },
    [node.id],
  );

  const TypeIcon = NODE_TYPE_ICONS[liveNode.nodeType];

  return (
    <div className={cn("flex min-h-full flex-col", className)}>
      {/* The header owns its own layout — the 708px text column **and** the
          full-bleed cover outside it (`node-content-header.tsx`, G3 追加交付 二),
          so the host must not wrap it in one. */}
      <NodeContentHeader
        node={liveNode}
        patchNode={writer.patchNode}
        renderIconSelector={({ node: target, onPick }) => (
          <IconSelectorPopover
            nodeId={target.id}
            value={target.icon ?? undefined}
            onChange={(next) => {
              if (next === undefined) {
                onPick(null);
                return;
              }
              // Live-value base, exactly like `NodeIconButton`: a colour-only
              // pick must not drop `kind` / `value` (sel §7).
              const live =
                useDataStore.getState().getNode(target.id)?.icon ?? undefined;
              onPick(live ? { ...live, ...next } : next);
            }}
            onRemove={() => onPick(null)}
          >
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={cn("p-0", NODE_ICON_PLATE)}
              aria-label={target.icon ? t("更换节点图标") : t("设置节点图标")}
            >
              <IconView
                icon={target.icon ?? undefined}
                fallback={<TypeIcon className={NODE_ICON_FALLBACK} />}
                className={NODE_ICON_PLATE}
                glyphClassName={NODE_ICON_GLYPH}
              />
            </Button>
          </IconSelectorPopover>
        )}
        renderCoverSelector={({ node: target, onPick }) =>
          target.cover == null ? (
            // Empty cover draws no block (nc §2); the popover's own trigger is
            // the compact 「添加封面」 entry of the title row.
            <CoverSelectorPopover
              nodeId={target.id}
              value={undefined}
              onChange={(next) => onPick(next ?? null)}
              onRemove={() => onPick(null)}
              listNodes={listNodes}
              label={t("添加封面")}
            />
          ) : (
            <CoverSelectorPopover
              nodeId={target.id}
              value={target.cover}
              onChange={(next) => onPick(next ?? null)}
              onRemove={() => onPick(null)}
              listNodes={listNodes}
            >
              {/* Full-bleed: the reference page's cover is the pane's width, not
                  the text column's, and its corners follow the dialog's. */}
              <button
                type="button"
                className="block h-60 w-full overflow-hidden rounded-lg"
                aria-label={t("更换节点封面")}
              >
                <NodePreviewCover
                  node={target}
                  className="size-full"
                  resolveNode={(nodeId) =>
                    useDataStore.getState().getNode(nodeId)
                  }
                />
              </button>
            </CoverSelectorPopover>
          )
        }
      />

      <NotionEditor
        key={`${node.id}:${contentReset}`}
        placeholder={t("开始写作...")}
        onContentChange={handleBodyChange}
        getInitialContent={() =>
          useDataStore.getState().getNode(node.id)?.content ?? {}
        }
      />
    </div>
  );
}
