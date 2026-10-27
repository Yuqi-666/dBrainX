// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n } from "@workspace/ui/lib/i18n";

import {
  DropdownMenuSub,
  DropdownMenuSubTrigger,
} from "@workspace/ui/components/ui/dropdown-menu";
import { Plus } from "lucide-react";
import { NodeSelector } from "@workspace/ui/components/selector/node-selector";

export interface GraphContextMenuAddEdgeProps {
  sourceIds: string[];
  targetId: string | null;
  x: number;
  y: number;
  onCreateEdge: (
    from: string[],
    to: string | null,
    x: number,
    y: number,
    setContextMenu: (menu: any) => void,
  ) => Promise<string | null>;
  onClose: () => void;
  setContextMenu: (menu: any) => void;
}

export function GraphContextMenuAddEdge({
  sourceIds,
  targetId,
  x,
  y,
  onCreateEdge,
  onClose,
  setContextMenu,
}: GraphContextMenuAddEdgeProps) {
  const { t } = useI18n();

  if (targetId !== null) {
    return null;
  }

  const handleNodeSelect = async (selectedTargetId: string) => {
    if (sourceIds.length === 0 || sourceIds.includes(selectedTargetId)) {
      return;
    }
    await onCreateEdge(sourceIds, selectedTargetId, x, y, setContextMenu);
  };

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className="flex items-center gap-2 px-2 py-1.5 cursor-pointer hover:bg-accent hover:text-accent-foreground rounded-md">
        <Plus className="size-4" />
        <span>{t("Add Edge")}</span>
      </DropdownMenuSubTrigger>
      <NodeSelector onSelect={handleNodeSelect} onClose={onClose} />
    </DropdownMenuSub>
  );
}
