// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n } from "@workspace/ui/lib/i18n";

import type { DashboardPage } from "@workspace/interfaces";
import { Button } from "@workspace/ui/components/ui/button";
import { WorkSpaceSelector } from "@workspace/ui/components/selector/workspace-selector";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@workspace/ui/components/ui/context-menu";
import { TabsList, TabsTrigger } from "@workspace/ui/components/ui/tabs";
import {
  LayoutDashboard,
  PanelLeftIcon,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";

interface DashboardSidebarProps {
  pages: DashboardPage[];
  enabled: boolean;
  onCreate: () => void;
  onRename: (page: DashboardPage) => void;
  onDelete: (page: DashboardPage) => void;
  /**
   * 侧栏内的开关按钮：浮动（`temp`）时把侧栏钉住，固定时关闭侧栏。
   * 与图侧栏的 `SidebarHeader` 同一套行为。
   */
  onToggle: () => void;
  /** 当前是否固定显示（决定按钮的提示文字）。 */
  pinned: boolean;
}

/**
 * Dashboard 左侧栏：标题、工作空间、页面 tab。
 *
 * 与 `GraphSidebar` 一样是 Tabs 根的后代，因此页面 tab 仍然受
 * `Dashboard` 里的 `<Tabs value onValueChange>` 控制；差别只在
 * 侧栏本身的开合由 `uiStore.dashboardSidebarMode` 驱动。
 */
export function DashboardSidebar({
  pages,
  enabled,
  onCreate,
  onRename,
  onDelete,
  onToggle,
  pinned,
}: DashboardSidebarProps) {
  const { t } = useI18n();

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col overflow-hidden select-none border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <header className="flex items-center justify-between px-4 py-3.5">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg bg-sidebar-primary/10">
            <LayoutDashboard className="size-5 text-sidebar-primary" />
          </div>
          <span className="font-heading text-[18px] tracking-tight text-sidebar-foreground">
            {t("Dashboard")}
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggle}
          aria-label={pinned ? t("关闭侧边栏") : t("固定侧边栏")}
          title={pinned ? t("关闭侧边栏") : t("固定侧边栏")}
          className="size-8 rounded-lg text-sidebar-foreground/60 transition-colors duration-200 hover:bg-sidebar-accent hover:text-sidebar-foreground"
        >
          <PanelLeftIcon className="size-4" />
        </Button>
      </header>

      <div className="h-px bg-sidebar-border" />

      <div className="flex flex-col gap-1 px-3 py-4">
        <WorkSpaceSelector />
      </div>

      <div className="h-px bg-sidebar-border" />

      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <span className="text-[11px] font-semibold tracking-wide text-sidebar-foreground/50 uppercase">
          {t("Dashboard 页面")}
        </span>
        <Button
          variant="ghost"
          size="icon"
          disabled={!enabled}
          onClick={onCreate}
          aria-label={t("新建页面")}
          title={t("新建页面")}
          className="size-7 text-sidebar-foreground/50 hover:bg-sidebar-accent hover:text-sidebar-foreground"
        >
          <Plus className="size-3.5" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-4 scrollbar-hide">
        <TabsList className="h-fit w-full flex-col items-stretch gap-1 bg-transparent p-0">
          {pages.map((item) => (
            <ContextMenu key={item.id}>
              <ContextMenuTrigger asChild>
                <TabsTrigger
                  value={item.id}
                  disabled={!enabled}
                  title={item.name}
                  className="h-9 w-full flex-none justify-start rounded-lg px-2.5 text-[13px] font-medium shadow-none hover:bg-sidebar-accent/60 aria-selected:bg-sidebar-accent aria-selected:font-semibold aria-selected:text-sidebar-foreground aria-selected:shadow-none"
                >
                  <span className="truncate">{item.name}</span>
                </TabsTrigger>
              </ContextMenuTrigger>
              <ContextMenuContent className="w-44">
                <ContextMenuItem
                  disabled={!enabled}
                  onSelect={() => onRename(item)}
                >
                  <Pencil />
                  {t("重命名")}{" "}
                </ContextMenuItem>
                <ContextMenuItem
                  variant="destructive"
                  disabled={!enabled}
                  onSelect={() => onDelete(item)}
                >
                  <Trash2 />
                  {t("删除 Dashboard")}{" "}
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          ))}
        </TabsList>
        {pages.length === 0 && (
          <p className="px-2.5 py-2.5 text-[12px] text-sidebar-foreground/40 italic">
            {t("还没有页面")}{" "}
          </p>
        )}
      </div>
    </aside>
  );
}
