// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n } from "@workspace/ui/lib/i18n";

import { PinIcon, PinOffIcon } from "lucide-react";
import { Button } from "@workspace/ui/components/ui/button";
import { useDataStore, useUIStore } from "@workspace/store";
import { NodeService } from "@workspace/services";

interface PinButtonProps {
  className?: string;
}

/**
 * 图钉按钮 - 切换节点置顶状态
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
    await NodeService.upsert(currentEditingNodeId, { isPinned: !isPinned });
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
