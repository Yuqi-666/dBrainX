// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n } from "@workspace/ui/lib/i18n";

import { useCallback, useEffect, useRef } from "react";
import { FileEdit } from "lucide-react";
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
import { getNodeContentDescriptor } from "@workspace/ui/components/node-content/registry";
import { NodePreviewCover } from "@workspace/ui/components/preview-block/node-preview-cover";
import { cn } from "@workspace/ui/lib/utils";
import {
  NODE_ICON_FALLBACK,
  NODE_ICON_GLYPH,
  NODE_ICON_PLATE,
  NodeContentHeader,
} from "@workspace/ui/components/node-content/node-content-header";
import { useNodeContentWriter } from "@workspace/ui/components/node-content/use-node-content-writer";

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
  // in, `patchNode` out) and the queue's local projection updates the store
  // synchronously, so this subscription is what makes typing echo back.
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
    operationId: string;
    docs: RichTextContent["docs"];
  } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // `apply` changes identity whenever the store does (its live-content reader
  // depends on this render's node), so hold it in a ref instead of rebuilding
  // the flush callback — the unmount cleanup has to stay stable.
  const applyRef = useRef(writer.apply);
  useEffect(() => {
    applyRef.current = writer.apply;
  }, [writer.apply]);

  const flush = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const queued = pending.current;
    if (queued === null) return;
    pending.current = null;
    void applyRef.current(queued.operationId, { docs: queued.docs });
  }, []);

  const handleBodyChange = useCallback(
    (docs: unknown) => {
      pending.current = {
        operationId: "rich-text.setDocument",
        docs: docs as RichTextContent["docs"],
      };
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(flush, RICH_TEXT_WRITE_DEBOUNCE_MS);
    },
    [flush],
  );

  /**
   * The header's one-way field writes, one operation per field.
   *
   * The header reports a `Partial<NodeData>`; a field is written by the
   * operation that owns it, so a title edit can never carry an icon, a tag or a
   * content payload along with it.
   */
  const patchNode = useCallback((patch: Partial<NodeData>) => {
    const write = (operationId: string, input: Record<string, unknown>) => {
      void applyRef.current(operationId, input);
    };
    if (patch.title !== undefined) write("node.setTitle", { title: patch.title });
    if (patch.abstract !== undefined) {
      write("node.setAbstract", { abstract: patch.abstract });
    }
    if (patch.semanticId !== undefined) {
      write("node.setSemanticId", { semanticId: patch.semanticId });
    }
    if ("icon" in patch) {
      if (patch.icon == null) write("node.clearIcon", {});
      else write("node.setIcon", { icon: patch.icon });
    }
    if ("cover" in patch) {
      if (patch.cover == null) write("node.clearCover", {});
      else write("node.setCover", { cover: patch.cover });
    }
  }, []);

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

  const TypeIcon =
    getNodeContentDescriptor(liveNode.nodeType)?.icon ?? FileEdit;

  return (
    <div className={cn("flex min-h-full flex-col", className)}>
      {/* The header owns its own layout — the 708px text column **and** the
          full-bleed cover outside it (`node-content-header.tsx`, G3 追加交付 二),
          so the host must not wrap it in one. */}
      <NodeContentHeader
        node={liveNode}
        patchNode={patchNode}
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
