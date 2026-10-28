// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n } from "@workspace/ui/lib/i18n";

import { LayoutDashboard } from "lucide-react";
import { Button } from "@workspace/ui/components/ui/button";
import { useUIStore } from "@workspace/store";
import { DashboardService } from "@workspace/services";
import { useDashboard } from "@workspace/ui/hooks/use-dashboard";
import { cn } from "@workspace/ui/lib/utils";

interface DashboardCandidateButtonProps {
  nodeId?: string | null;
  className?: string;
}

/**
 * 把当前节点加入 / 移出 Dashboard 组件库的备选列表。
 *
 * 该动作原来藏在 EditorHeader 的「更多选项」菜单里；现在直接放在编辑器
 * 头部的右侧按钮栏，节点处于备选状态时按钮高亮。
 */
export function DashboardCandidateButton({
  nodeId,
  className,
}: DashboardCandidateButtonProps) {
  const { t } = useI18n();

  const currentEditingNodeId = useUIStore(
    (state) => state.currentEditingNodeId,
  );
  const { scope, workspace, ready, syncState } = useDashboard();

  const targetNodeId = nodeId || currentEditingNodeId;
  const isCandidate =
    !!targetNodeId && !!workspace?.candidates.includes(targetNodeId);
  const disabled = !ready || !!syncState?.loading || !targetNodeId;
  const label = isCandidate
    ? t("从 Dashboard 备选移除")
    : t("添加到 Dashboard 备选");

  return (
    <Button
      variant="ghost"
      size="icon"
      disabled={disabled}
      aria-label={label}
      aria-pressed={isCandidate}
      title={label}
      className={cn(isCandidate && "text-primary", className)}
      onClick={() => {
        if (scope && targetNodeId)
          DashboardService.toggleCandidate(scope, targetNodeId);
      }}
    >
      <LayoutDashboard className="size-4" />
    </Button>
  );
}
