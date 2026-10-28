// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n } from "@workspace/ui/lib/i18n";

import { useMemo, useState } from "react";
import { Button } from "@workspace/ui/components/ui/button";
import { Input } from "@workspace/ui/components/ui/input";
import { Label } from "@workspace/ui/components/ui/label";
import { ScrollArea } from "@workspace/ui/components/ui/scroll-area";
import { cn } from "@workspace/ui/lib/utils";
import type {
  NodeData,
  NodeId,
  NodeSemantic,
  NodeSemanticId,
} from "@workspace/interfaces";
import { Check, Search } from "lucide-react";

export interface NodeSelectionListProps {
  /** The workspace's nodes — the whole list, not a pre-filtered slice. */
  nodes: ReadonlyMap<NodeId, NodeData>;
  /** Only to label each row with its semantic type. */
  nodeSemantics: ReadonlyMap<NodeSemanticId, NodeSemantic>;
  selectedNodeIds: ReadonlySet<NodeId>;
  disabled?: boolean;
  /** Row/label ids are namespaced so two pickers can coexist in one document. */
  idPrefix?: string;
  /** Receives a **fresh** set every time, so a `useState` setter fits directly. */
  onChange: (next: Set<NodeId>) => void;
}

/**
 * 节点选择 — the node multi-select both filter editors use.
 *
 * It owns the one piece of state that is *only* about picking (the search term)
 * and reports the whole next selection: a filter config stores
 * `selectedNodes` as an array, and every writer has to treat the set as one
 * value anyway (`view-dialog.tsx` for a workspace `View`,
 * `collection-filter-dialog.tsx` for a collection's `filterConfig`).
 *
 * 全选当前 deliberately selects what the search *shows*, not the whole
 * workspace: the list is the only affordance, so "all" has to mean "all of
 * these".
 */
export function NodeSelectionList({
  nodes,
  nodeSemantics,
  selectedNodeIds,
  disabled,
  idPrefix = "node-selection",
  onChange,
}: NodeSelectionListProps) {
  const { t } = useI18n();

  const [search, setSearch] = useState("");

  const visibleNodes = useMemo(() => {
    const list = Array.from(nodes.values());
    const term = search.trim().toLowerCase();
    if (!term) return list;
    return list.filter(
      (node) =>
        node.title.toLowerCase().includes(term) ||
        nodeSemantics.get(node.semanticId)?.name.toLowerCase().includes(term),
    );
  }, [nodes, nodeSemantics, search]);

  const searchId = `${idPrefix}-search`;

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between">
        <Label htmlFor={searchId}>
          {t("节点选择")}{" "}
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            {t("已选")} {selectedNodeIds.size} / {nodes.size}
          </span>
        </Label>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled || visibleNodes.length === 0}
            onClick={() =>
              onChange(new Set(visibleNodes.map((node) => node.id)))
            }
          >
            {t("全选当前")}{" "}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled || selectedNodeIds.size === 0}
            onClick={() => onChange(new Set())}
          >
            {t("清空")}{" "}
          </Button>
        </div>
      </div>

      <div className="relative flex items-center">
        <Search className="absolute left-2.5 size-3.5 text-muted-foreground" />
        <Input
          id={searchId}
          value={search}
          placeholder={t("搜索节点标题或语义类型…")}
          className="h-8 pl-8 text-xs"
          disabled={disabled}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      <ScrollArea className="h-44 rounded-lg border">
        <div className="flex flex-col gap-0.5 p-1.5">
          {visibleNodes.length > 0 ? (
            visibleNodes.map((node) => {
              const isSelected = selectedNodeIds.has(node.id);
              const semantic = nodeSemantics.get(node.semanticId);
              return (
                <button
                  key={node.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    const next = new Set(selectedNodeIds);
                    if (next.has(node.id)) {
                      next.delete(node.id);
                    } else {
                      next.add(node.id);
                    }
                    onChange(next);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
                    isSelected ? "bg-accent" : "hover:bg-accent/60",
                  )}
                >
                  <span
                    className={cn(
                      "flex size-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors",
                      isSelected
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-input",
                    )}
                  >
                    {isSelected && <Check className="size-3" />}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13px]">
                    {node.title}
                  </span>
                  {semantic && (
                    <span
                      className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium"
                      style={{
                        backgroundColor: semantic.color
                          ? `${semantic.color}1a`
                          : undefined,
                        color: semantic.color ?? undefined,
                      }}
                    >
                      {semantic.name}
                    </span>
                  )}
                </button>
              );
            })
          ) : (
            <p className="px-2 py-6 text-center text-[12px] text-muted-foreground">
              {nodes.size === 0
                ? t("当前工作区还没有节点")
                : t("没有匹配的节点")}
            </p>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
