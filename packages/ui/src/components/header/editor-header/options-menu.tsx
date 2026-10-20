// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n } from "@workspace/ui/lib/i18n";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/ui/dropdown-menu";
import { Button } from "@workspace/ui/components/ui/button";
import { useDataStore, useUIStore } from "@workspace/store";
import {
  requestNodeClear,
  requestNodeDelete,
} from "@workspace/ui/lib/node-disposition";
import { clearedNodeUpdates } from "@workspace/utils/node-content";
import {
  CopyIcon,
  EraserIcon,
  TrashIcon,
  DownloadIcon,
  ShareIcon,
  ExternalLinkIcon,
  MoreHorizontalIcon,
} from "lucide-react";

interface OptionsMenuProps {
  nodeId?: string | null;
  className?: string;
}

/**
 * 选项菜单 - 节点操作菜单（删除、清空、复制、导出等）
 *
 * 「删除」与「清空」都交给 `node-disposition` 的两个 `request*`：节点引用已上传
 * 资源时先弹出处置对话框（文件是否一起删），没有引用时保持原来的即时行为。
 */
export function OptionsMenu({ nodeId, className }: OptionsMenuProps) {
  const { t } = useI18n();

  const currentEditingNodeId = useUIStore(
    (state) => state.currentEditingNodeId,
  );
  const nodes = useDataStore((state) => state.nodes);

  const targetNodeId = nodeId || currentEditingNodeId;
  const currentNode = targetNodeId ? nodes.get(targetNodeId) : null;
  // A type without one payload (`collection`, `database`) cannot be cleared,
  // so the item is not offered at all — the dialog must never open on a no-op.
  const canClear = currentNode
    ? clearedNodeUpdates(currentNode) !== null
    : false;

  const handleDelete = () => {
    if (targetNodeId) void requestNodeDelete(targetNodeId);
  };

  const handleClear = () => {
    if (targetNodeId) void requestNodeClear(targetNodeId);
  };

  const handleCopy = () => {
    if (currentNode) {
      navigator.clipboard.writeText(JSON.stringify(currentNode, null, 2));
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={className}
          aria-label={t("更多选项")}
        >
          <MoreHorizontalIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>{t("操作")}</DropdownMenuLabel>
        <DropdownMenuSeparator />

        <DropdownMenuItem onClick={handleCopy}>
          <CopyIcon className="size-4 mr-2" />
          <span>{t("复制节点")}</span>
        </DropdownMenuItem>

        <DropdownMenuItem>
          <DownloadIcon className="size-4 mr-2" />
          <span>{t("导出节点")}</span>
        </DropdownMenuItem>

        <DropdownMenuItem>
          <ShareIcon className="size-4 mr-2" />
          <span>{t("分享节点")}</span>
        </DropdownMenuItem>

        <DropdownMenuItem>
          <ExternalLinkIcon className="size-4 mr-2" />
          <span>{t("在新窗口打开")}</span>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        {canClear && targetNodeId && (
          <DropdownMenuItem onClick={handleClear} variant="destructive">
            <EraserIcon className="size-4 mr-2" />
            <span>{t("清空节点")}</span>
          </DropdownMenuItem>
        )}

        <DropdownMenuItem onClick={handleDelete} variant="destructive">
          <TrashIcon className="size-4 mr-2" />
          <span>{t("删除节点")}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
