// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n } from "@workspace/ui/lib/i18n";

import * as React from "react";
import { DropdownMenuItem } from "@workspace/ui/components/ui/dropdown-menu";
import { Trash2 } from "lucide-react";

export interface GraphContextMenuGroupSelectProps {
  nodeIds: string[];
  edgeIds: string[];
  onDeleteSelected?: (nodeIds: string[], edgeIds: string[]) => void;
  onClose: () => void;
}

export function GraphContextMenuGroupSelect({
  nodeIds,
  edgeIds,
  onDeleteSelected,
  onClose,
}: GraphContextMenuGroupSelectProps) {
  const { t } = useI18n();

  const totalCount = nodeIds.length + edgeIds.length;

  return (
    <>
      <DropdownMenuItem
        onClick={() => {
          onDeleteSelected?.(nodeIds, edgeIds);
          onClose();
        }}
        className="flex items-center gap-2 px-2 py-1.5 cursor-pointer text-destructive hover:bg-destructive/10 hover:text-destructive rounded-md"
      >
        <Trash2 className="size-4" />
        <span>
          {t("Delete")} {totalCount} {t("item")}
          {totalCount !== 1 ? "s" : ""}
        </span>
      </DropdownMenuItem>
    </>
  );
}
