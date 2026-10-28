// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { translate } from "@workspace/ui/lib/i18n/runtime";

import { useI18n } from "@workspace/ui/lib/i18n";

import type { DashboardPage, NodeData } from "@workspace/interfaces";
import { Button } from "@workspace/ui/components/ui/button";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
} from "@workspace/ui/components/ui/empty";
import { Input } from "@workspace/ui/components/ui/input";
import { NODE_TYPE_ICONS } from "@workspace/ui/components/icon/node-type-icons";
import { NODE_TYPE_LABELS } from "@workspace/ui/components/selector/node-data-type-selector";
import { cn } from "@workspace/ui/lib/utils";
import { Check, Plus, Search, X } from "lucide-react";

interface DashboardLibraryProps {
  candidates: NodeData[];
  page?: DashboardPage;
  enabled: boolean;
  search: string;
  onSearch: (value: string) => void;
  onClose: () => void;
  onAdd: (nodeId: string) => void;
  onDragNode: (nodeId: string | null) => void;
}

export function DashboardLibrary({
  candidates,
  page,
  enabled,
  search,
  onSearch,
  onClose,
  onAdd,
  onDragNode,
}: DashboardLibraryProps) {
  const { t } = useI18n();

  return (
    <aside
      id="dashboard-library"
      className="flex h-full w-full flex-col bg-background"
      aria-label={t("节点组件库")}
    >
      <div className="flex items-center justify-between px-4 pt-4">
        <h2 className="text-sm font-medium">{t("组件库")}</h2>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label={t("关闭组件库")}
          onClick={onClose}
        >
          <X className="size-4" />
        </Button>
      </div>
      <p className="px-4 pt-2 text-xs leading-relaxed text-muted-foreground">
        {t("拖入页面或点击添加。组件与原节点保持同步。")}{" "}
      </p>
      <div className="relative m-4">
        <Search className="absolute top-2.5 left-3 size-4 text-muted-foreground" />
        <Input
          aria-label={t("搜索组件")}
          placeholder={t("搜索节点…")}
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          className="pl-9"
        />
      </div>
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 pb-4 lg:pb-[calc(var(--dynamic-island-height,48px)+24px)]">
        {candidates.map((node) => {
          const Icon = NODE_TYPE_ICONS[node.nodeType];
          const added = page?.widgets.some(
            (widget) => widget.nodeId === node.id,
          );
          const canAdd = enabled && !!page && !added;
          return (
            <div
              key={node.id}
              draggable={canAdd}
              onDragStart={(event) => {
                event.dataTransfer.setData("text/plain", node.id);
                event.dataTransfer.effectAllowed = "copy";
                onDragNode(node.id);
              }}
              onDragEnd={() => onDragNode(null)}
              className={cn(
                "flex items-center gap-3 rounded-lg p-3 transition-colors hover:bg-muted/50",
                added && "opacity-60",
                canAdd && "cursor-grab active:cursor-grabbing",
              )}
            >
              <Icon className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {node.title || t("未命名节点")}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {added ? t("已添加") : NODE_TYPE_LABELS[node.nodeType]}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                disabled={!canAdd}
                aria-label={translate("添加 {value1}", { value1: node.title })}
                onClick={() => onAdd(node.id)}
              >
                {added ? (
                  <Check className="size-4" />
                ) : (
                  <Plus className="size-4" />
                )}
              </Button>
            </div>
          );
        })}
        {candidates.length === 0 && (
          <Empty className="py-8">
            <EmptyHeader>
              <EmptyTitle>
                {search ? t("没有匹配的组件") : t("组件库为空")}
              </EmptyTitle>
            </EmptyHeader>
          </Empty>
        )}
      </div>
    </aside>
  );
}
