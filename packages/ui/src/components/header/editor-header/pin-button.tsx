// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n } from "@workspace/ui/lib/i18n";

import { PinIcon, PinOffIcon } from "lucide-react";
import { Button } from "@workspace/ui/components/ui/button";
import { toast } from "@workspace/ui/components/ui/toast";
import { useDataStore, useUIStore } from "@workspace/store";
import { NodeService } from "@workspace/services";
import { operationFailureCode } from "@workspace/ui/lib/attribute-operations";

interface PinButtonProps {
  className?: string;
}

/**
 * 图钉按钮 - 切换节点置顶状态
 *
 * 每次点击只发一条 `node.pin` / `node.unpin`；按钮状态来自 store，所以被拒绝
 * 时不会有本地翻转，失败只额外提示服务端返回的操作码。
 */
export function PinButton({ className }: PinButtonProps) {
  const { t } = useI18n();

  const currentEditingNodeId = useUIStore((s) => s.currentEditingNodeId);
  const node = useDataStore((s) =>
    currentEditingNodeId ? s.getNode(currentEditingNodeId) : undefined,
  );

  const isPinned = node?.isPinned ?? false;

  const handleTogglePin = async () => {
    if (!currentEditingNodeId) return;
    try {
      await (isPinned
        ? NodeService.unpin(currentEditingNodeId)
        : NodeService.pin(currentEditingNodeId));
    } catch (error) {
      toast({
        title: t("保存失败，请稍后重试"),
        description: operationFailureCode(error),
        variant: "destructive",
      });
    }
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={handleTogglePin}
      className={className}
      aria-label={isPinned ? t("取消置顶") : t("置顶节点")}
    >
      {isPinned ? <PinIcon className="fill-current" /> : <PinOffIcon />}
    </Button>
  );
}
