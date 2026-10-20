// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n } from "@workspace/ui/lib/i18n";

import * as React from "react";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@workspace/ui/components/ui/dropdown-menu";
import { Input } from "@workspace/ui/components/ui/input";
import { Search, Plus, Trash2 } from "lucide-react";
import { useDataStore, useUIStore } from "@workspace/store";
import { NodeSemanticService } from "@workspace/services";
import type { NodeSemantic, NodeSemanticId } from "@workspace/interfaces";
import { cn } from "@workspace/ui/lib/utils";

export interface NodeSemanticSelectorProps {
  className?: string;
  onSelect: (semanticId: string) => void;
  /**
   * 覆盖 “Add new type” 的默认行为（默认只打开全局语义对话框）。
   * 调用方可在打开对话框时额外记录“新建后要绑定到哪个元素”。
   */
  onCreateRequest?: () => void;
}

/** Node semantic picker body; mount inside DropdownMenuContent or DropdownMenuSubContent. */
export function NodeSemanticSelector({
  className,
  onSelect,
  onCreateRequest,
}: NodeSemanticSelectorProps) {
  const { t } = useI18n();

  const [search, setSearch] = React.useState("");
  const nodeSemanticsMap = useDataStore((state) => state.nodeSemantics);
  const openDialog = useUIStore((state) => state.openNodeSemanticDialog);

  const nodeSemantics = React.useMemo(
    () => Array.from(nodeSemanticsMap.values()),
    [nodeSemanticsMap],
  );

  const filteredSemantics = React.useMemo(() => {
    if (!search.trim()) return nodeSemantics;
    const lower = search.toLowerCase();
    return nodeSemantics.filter(
      (s: NodeSemantic) =>
        s.name.toLowerCase().includes(lower) ||
        s.description?.toLowerCase().includes(lower),
    );
  }, [nodeSemantics, search]);

  const handleSelect = (semanticId: string) => {
    onSelect(semanticId);
    setSearch("");
  };

  const handleDelete = async (e: React.MouseEvent, id: NodeSemanticId) => {
    e.stopPropagation();
    try {
      await NodeSemanticService.delete(id);
    } catch (error) {
      console.error("Failed to delete node semantic:", error);
    }
  };

  return (
    <div className={cn("w-64 min-w-0 p-2", className)}>
      <div className="relative mb-2">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input
          placeholder={t("Search semantic...")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-8 h-8"
          autoFocus
        />
      </div>
      <div className="max-h-48 overflow-y-auto">
        {filteredSemantics.length === 0 ? (
          <div className="px-2 py-1.5 text-sm text-muted-foreground">
            {t("No semantics found")}{" "}
          </div>
        ) : (
          filteredSemantics.map((semantic: NodeSemantic) => (
            <DropdownMenuItem
              key={semantic.id}
              onSelect={() => handleSelect(semantic.id)}
              className="flex items-center gap-2 px-2 py-1.5 cursor-pointer hover:bg-accent hover:text-accent-foreground rounded-md group"
            >
              {semantic.color ? (
                <span
                  className="size-4 rounded-full flex-shrink-0"
                  style={{ backgroundColor: semantic.color }}
                />
              ) : semantic.icon ? (
                <span className="size-4 flex items-center justify-center">
                  {semantic.icon}
                </span>
              ) : null}
              <span className="min-w-0 flex-1 truncate">{semantic.name}</span>
              {semantic.description && (
                <span className="text-xs text-muted-foreground truncate max-w-[80px]">
                  {semantic.description}
                </span>
              )}
              <button
                onClick={(e) => handleDelete(e, semantic.id)}
                className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-destructive/10 hover:text-destructive rounded-sm transition-opacity"
              >
                <Trash2 className="size-3" />
              </button>
            </DropdownMenuItem>
          ))
        )}
      </div>
      <DropdownMenuSeparator className="my-1.5" />
      <DropdownMenuItem
        onSelect={() => {
          setSearch("");
          if (onCreateRequest) {
            onCreateRequest();
            return;
          }
          openDialog();
        }}
        className="flex items-center gap-2 px-2 py-1.5 cursor-pointer hover:bg-accent hover:text-accent-foreground rounded-md text-primary"
      >
        <Plus className="size-4" />
        <span>{t("Add new type")}</span>
      </DropdownMenuItem>
    </div>
  );
}
