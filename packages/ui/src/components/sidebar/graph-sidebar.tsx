// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n } from "@workspace/ui/lib/i18n";
import { LanguageSwitcher } from "./language-switcher";

import { useAuthStore, useDataStore, useUIStore } from "@workspace/store";
import {
  clearAuthSession,
  reconnectTRPCClient,
  trpc,
} from "@workspace/api-client";
import {
  NodeService,
  NodeSemanticService,
  EdgeSemanticService,
  ViewService,
} from "@workspace/services";
import type {
  EdgeSemantic,
  NodeData,
  NodeSemantic,
  View,
} from "@workspace/interfaces";
import { Button } from "@workspace/ui/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/ui/dropdown-menu";
import { AddNodeDialog } from "@workspace/ui/components/dialog/add-node-dialog";
import { WorkSpaceSelector } from "@workspace/ui/components/selector/workspace-selector";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/ui/tabs";
import { cn } from "@workspace/ui/lib/utils";
import { viewDisplayName } from "@workspace/ui/lib/default-instance-name";
import {
  ChevronRight,
  CircleDot,
  LayoutGrid,
  Link2,
  LogOut,
  Moon,
  MoreHorizontal,
  PanelLeftIcon,
  Pencil,
  Pin,
  Plus,
  Shapes,
  Sun,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTheme } from "next-themes";
import { LogoIcon } from "@workspace/ui/components/brand/brand-icons";
import { IconView } from "@workspace/ui/components/icon/icon-view";

export function GraphSidebar() {
  const { t } = useI18n();

  const { sidebarMode, closeSidebar, toggleSidebar, convertTempToFixed } =
    useUIStore();
  const { views, nodes } = useDataStore();
  const openNodeSemanticDialog = useUIStore(
    (state) => state.openNodeSemanticDialog,
  );
  const openEdgeSemanticDialog = useUIStore(
    (state) => state.openEdgeSemanticDialog,
  );
  const openViewCreateDialog = useUIStore(
    (state) => state.openViewCreateDialog,
  );
  const sidebarActiveTab = useUIStore((state) => state.sidebarActiveTab);
  const setSidebarActiveTab = useUIStore((state) => state.setSidebarActiveTab);
  const currentEditingNodeId = useUIStore(
    (state) => state.currentEditingNodeId,
  );
  const pushRecentlyOpenedNode = useUIStore(
    (state) => state.pushRecentlyOpenedNode,
  );

  // 由 sidebar 自动维护"最近打开"队列：任何入口打开节点（设置
  // currentEditingNodeId）都会被捕获，入口无需感知队列的存在。
  useEffect(() => {
    if (currentEditingNodeId !== null) {
      pushRecentlyOpenedNode(currentEditingNodeId);
    }
  }, [currentEditingNodeId, pushRecentlyOpenedNode]);

  const pinnedViews = Array.from(views.values()).filter(
    (view) => view.isPinned,
  );
  const recentViews = Array.from(views.values()).slice(0, 5);
  const pinnedNodes = Array.from(nodes.values()).filter(
    (node) => node.isPinned,
  );
  const recentlyOpenedNodeIds = useUIStore(
    (state) => state.recentlyOpenedNodeIds,
  );
  const recentNodes = recentlyOpenedNodeIds
    .map((id) => nodes.get(id))
    .filter((node): node is NodeData => node !== undefined && !node.isPinned);

  const handleToggleSidebar = () => {
    if (sidebarMode === "temp") {
      convertTempToFixed();
    } else if (sidebarMode === "fixed") {
      closeSidebar();
    } else {
      toggleSidebar();
    }
  };

  const [addNodeDialogOpen, setAddNodeDialogOpen] = useState(false);

  return (
    <aside
      className={cn(
        "flex h-dvh w-64 flex-col bg-sidebar text-sidebar-foreground overflow-hidden select-none",
        "border-r border-sidebar-border",
        sidebarMode === "temp" && "rounded-lg",
      )}
    >
      <SidebarHeader onToggle={handleToggleSidebar} />

      <div className="h-px bg-sidebar-border" />

      <div className="flex flex-col gap-1 px-3 py-4">
        <WorkSpaceSelector />
      </div>

      <div className="h-px bg-sidebar-border" />

      <Tabs
        orientation="vertical"
        value={sidebarActiveTab}
        onValueChange={setSidebarActiveTab}
        className="min-h-0 flex-1 flex-col gap-0"
      >
        <TabsList className="h-fit w-full shrink-0 flex-col items-stretch gap-1 border-b border-sidebar-border bg-transparent px-3 py-3">
          <TabsTrigger asChild value="nodes">
            <div className="group/tab flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-[13px] font-medium text-sidebar-foreground/60 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground data-active:bg-sidebar-accent data-active:text-sidebar-foreground data-active:shadow-none">
              <CircleDot className="size-3.5 text-sidebar-foreground/40" />
              <span>{t("节点")}</span>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("Add Node")}
                className="ml-auto size-7 shrink-0 text-sidebar-foreground/30 hover:text-sidebar-foreground hover:bg-sidebar-accent rounded-md opacity-0 pointer-events-none group-hover/tab:opacity-100 group-hover/tab:pointer-events-auto transition-all duration-150"
                onClick={(e) => {
                  e.stopPropagation();
                  setAddNodeDialogOpen(true);
                }}
              >
                <Plus className="size-3.5" />
              </Button>
            </div>
          </TabsTrigger>
          <TabsTrigger asChild value="views">
            <div className="group/tab flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-[13px] font-medium text-sidebar-foreground/60 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground data-active:bg-sidebar-accent data-active:text-sidebar-foreground data-active:shadow-none">
              <LayoutGrid className="size-3.5 text-sidebar-foreground/40" />
              <span>{t("视图")}</span>
              <Button
                variant="ghost"
                size="icon"
                className="ml-auto size-7 shrink-0 text-sidebar-foreground/30 hover:text-sidebar-foreground hover:bg-sidebar-accent rounded-md opacity-0 pointer-events-none group-hover/tab:opacity-100 group-hover/tab:pointer-events-auto transition-all duration-150"
                onClick={(e) => {
                  e.stopPropagation();
                  openViewCreateDialog();
                }}
              >
                <Plus className="size-3.5" />
              </Button>
            </div>
          </TabsTrigger>
          <TabsTrigger asChild value="node-types">
            <div className="group/tab flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-[13px] font-medium text-sidebar-foreground/60 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground data-active:bg-sidebar-accent data-active:text-sidebar-foreground data-active:shadow-none">
              <Shapes className="size-3.5 text-sidebar-foreground/40" />
              <span>{t("节点类型")}</span>
              <Button
                variant="ghost"
                size="icon"
                className="ml-auto size-7 shrink-0 text-sidebar-foreground/30 hover:text-sidebar-foreground hover:bg-sidebar-accent rounded-md opacity-0 pointer-events-none group-hover/tab:opacity-100 group-hover/tab:pointer-events-auto transition-all duration-150"
                onClick={(e) => {
                  e.stopPropagation();
                  openNodeSemanticDialog();
                }}
              >
                <Plus className="size-3.5" />
              </Button>
            </div>
          </TabsTrigger>
          <TabsTrigger asChild value="edge-types">
            <div className="group/tab flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-[13px] font-medium text-sidebar-foreground/60 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground data-active:bg-sidebar-accent data-active:text-sidebar-foreground data-active:shadow-none">
              <Link2 className="size-3.5 text-sidebar-foreground/40" />
              <span>{t("边类型")}</span>
              <Button
                variant="ghost"
                size="icon"
                className="ml-auto size-7 shrink-0 text-sidebar-foreground/30 hover:text-sidebar-foreground hover:bg-sidebar-accent rounded-md opacity-0 pointer-events-none group-hover/tab:opacity-100 group-hover/tab:pointer-events-auto transition-all duration-150"
                onClick={(e) => {
                  e.stopPropagation();
                  openEdgeSemanticDialog();
                }}
              >
                <Plus className="size-3.5" />
              </Button>
            </div>
          </TabsTrigger>
        </TabsList>

        <TabsContent
          value="nodes"
          className="mt-0 min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain py-4 pl-1 pr-3 scrollbar-hide"
        >
          <NodesList pinnedNodes={pinnedNodes} recentNodes={recentNodes} />
        </TabsContent>
        <TabsContent
          value="views"
          className="mt-0 min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain py-4 pl-1 pr-3 scrollbar-hide"
        >
          <ViewsList pinnedViews={pinnedViews} recentViews={recentViews} />
        </TabsContent>
        <TabsContent
          value="node-types"
          className="mt-0 min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain py-4 pl-1 pr-3 scrollbar-hide"
        >
          <NodeSemanticList />
        </TabsContent>
        <TabsContent
          value="edge-types"
          className="mt-0 min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain py-4 pl-1 pr-3 scrollbar-hide"
        >
          <EdgeSemanticList />
        </TabsContent>
      </Tabs>

      <div className="h-px bg-sidebar-border" />
      <LanguageSwitcher />
      <SidebarUserMenu />
      <AddNodeDialog
        open={addNodeDialogOpen}
        onOpenChange={setAddNodeDialogOpen}
      />
    </aside>
  );
}

function SidebarHeader({ onToggle }: { onToggle: () => void }) {
  const { t } = useI18n();

  const { resolvedTheme, setTheme } = useTheme();

  return (
    <header className="flex items-center justify-between px-4 py-3.5">
      <div className="flex items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-lg bg-sidebar-primary/10">
          <LogoIcon className="size-10" aria-hidden />
        </div>
        <span className="text-[18px] font-heading tracking-tight text-sidebar-foreground">
          dBrain
        </span>
      </div>

      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
          className="size-8 text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors duration-200 rounded-lg"
          aria-label={
            resolvedTheme === "dark" ? t("切换到浅色模式") : t("切换到深色模式")
          }
        >
          {resolvedTheme === "dark" ? (
            <Sun className="size-4" />
          ) : (
            <Moon className="size-4" />
          )}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggle}
          className="size-8 text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors duration-200 rounded-lg"
        >
          <PanelLeftIcon className="size-4" />
        </Button>
      </div>
    </header>
  );
}

function ViewItem({
  view,
  isSelected,
  onSelect,
  onTogglePin,
  onEdit,
  onDelete,
}: {
  view: View;
  isSelected?: boolean;
  onSelect: (id: string) => void;
  onTogglePin: (id: string, isPinned: boolean) => void;
  onEdit: (view: View) => void;
  onDelete: (id: string) => void;
}) {
  const { t } = useI18n();

  return (
    <div
      className={cn(
        "group flex items-center justify-between rounded-lg px-2.5 py-2 transition-colors duration-150 cursor-pointer",
        isSelected ? "bg-sidebar-accent/70" : "hover:bg-sidebar-accent",
      )}
      onClick={() => onSelect(view.id)}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <LayoutGrid className="size-3.5 text-sidebar-foreground/30 shrink-0" />
        <span className="text-[13px] text-sidebar-foreground truncate">
          {viewDisplayName(view, t)}
        </span>
      </div>
      <div className="flex items-center gap-0.5">
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "size-7 text-sidebar-foreground/30 hover:text-sidebar-primary hover:bg-sidebar-primary/10 transition-colors rounded-md",
            view.isPinned
              ? "opacity-100"
              : "opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto transition-opacity duration-150",
          )}
          onClick={(e) => {
            e.stopPropagation();
            onTogglePin(view.id, !view.isPinned);
          }}
        >
          <Pin
            className={cn(
              "size-3",
              view.isPinned && "fill-sidebar-primary text-sidebar-primary",
            )}
          />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-sidebar-foreground/30 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors rounded-md opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto transition-opacity duration-150"
              onClick={(e) => e.stopPropagation()}
            >
              <MoreHorizontal className="size-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            side="right"
            sideOffset={12}
            className="w-52 rounded-xl border-sidebar-border bg-sidebar p-1.5 shadow-lg"
          >
            <DropdownMenuItem
              onClick={() => onEdit(view)}
              className="rounded-lg px-2.5 py-2 text-[13px] text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors cursor-pointer"
            >
              <Pencil className="mr-2 size-4" />
              {t("Edit")}{" "}
            </DropdownMenuItem>
            {/* The default global view is the workspace's guaranteed way to
                show everything; deleting it would leave the graph without a
                renderable view. It can still be renamed and pinned. */}
            {!view.isDefault && (
              <DropdownMenuItem
                onClick={() => onDelete(view.id)}
                className="rounded-lg px-2.5 py-2 text-[13px] text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors cursor-pointer"
              >
                <Trash2 className="mr-2 size-4" />
                {t("Delete")}{" "}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

function ViewsList({
  pinnedViews,
  recentViews,
}: {
  pinnedViews: View[];
  recentViews: View[];
}) {
  const { t } = useI18n();

  const handleTogglePin = async (id: string, isPinned: boolean) => {
    await ViewService.upsert(id, { isPinned });
  };

  const setCurrentViewId = useUIStore((state) => state.setCurrentViewId);
  const openViewEditDialog = useUIStore((state) => state.openViewEditDialog);
  const currentViewId = useUIStore((state) => state.currentViewId);

  const handleSelectView = (id: string) => {
    setCurrentViewId(id);
  };

  // 编辑按钮打开与"创建视图"同一个 dialog，只是预填该视图的名称与筛选配置。
  const handleEditView = (view: View) => {
    openViewEditDialog(view);
  };

  const handleDeleteView = async (id: string) => {
    try {
      await ViewService.delete(id);
    } catch (err) {
      console.error("[CognitiveSidebar] delete view failed:", err);
    }
  };

  const nonPinnedRecentViews = recentViews.filter(
    (rv) => !pinnedViews.some((pv) => pv.id === rv.id),
  );
  const sortedViews = [...pinnedViews, ...nonPinnedRecentViews];

  return (
    <div className="flex flex-col gap-0.5">
      {sortedViews.length > 0 ? (
        sortedViews.map((view) => (
          <ViewItem
            key={view.id}
            view={view}
            isSelected={currentViewId === view.id}
            onSelect={handleSelectView}
            onTogglePin={handleTogglePin}
            onEdit={handleEditView}
            onDelete={handleDeleteView}
          />
        ))
      ) : (
        <p className="px-2.5 py-2.5 text-[12px] text-sidebar-foreground/40 italic">
          {t("No views yet")}{" "}
        </p>
      )}
    </div>
  );
}

function NodeItem({
  node,
  onTogglePin,
  isSelected,
  onSelect,
  onDelete,
}: {
  node: { id: string; title: string; semanticId?: string; isPinned?: boolean };
  onTogglePin: (id: string, isPinned: boolean) => void;
  isSelected?: boolean;
  onSelect?: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const { t } = useI18n();

  return (
    <div
      className={cn(
        "group flex items-center justify-between rounded-lg px-2.5 py-2 transition-colors duration-150 cursor-pointer",
        isSelected ? "bg-sidebar-accent/70" : "hover:bg-sidebar-accent",
      )}
      onClick={() => onSelect?.(node.id)}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <CircleDot className="size-3.5 text-sidebar-foreground/30 shrink-0" />
        <span className="text-[13px] text-sidebar-foreground truncate">
          {node.title}
        </span>
      </div>
      <div className="flex items-center gap-0.5">
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "size-7 text-sidebar-foreground/30 hover:text-sidebar-primary hover:bg-sidebar-primary/10 transition-colors rounded-md",
            node.isPinned
              ? "opacity-100"
              : "opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto transition-opacity duration-150",
          )}
          onClick={(e) => {
            e.stopPropagation();
            onTogglePin(node.id, !node.isPinned);
          }}
        >
          <Pin
            className={cn(
              "size-3",
              node.isPinned && "fill-sidebar-primary text-sidebar-primary",
            )}
          />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-sidebar-foreground/30 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors rounded-md opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto transition-opacity duration-150"
              onClick={(e) => e.stopPropagation()}
            >
              <MoreHorizontal className="size-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            side="right"
            sideOffset={12}
            className="w-52 rounded-xl border-sidebar-border bg-sidebar p-1.5 shadow-lg"
          >
            <DropdownMenuItem
              onClick={() => onSelect?.(node.id)}
              className="rounded-lg px-2.5 py-2 text-[13px] text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors cursor-pointer"
            >
              <Pencil className="mr-2 size-4" />
              {t("Edit")}{" "}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => onDelete(node.id)}
              className="rounded-lg px-2.5 py-2 text-[13px] text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors cursor-pointer"
            >
              <Trash2 className="mr-2 size-4" />
              {t("Delete")}{" "}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

function NodesList({
  pinnedNodes,
  recentNodes,
}: {
  pinnedNodes: NodeData[];
  recentNodes: NodeData[];
}) {
  const { t } = useI18n();

  const currentEditingNodeId = useUIStore(
    (state) => state.currentEditingNodeId,
  );
  const setCurrentEditingNodeId = useUIStore(
    (state) => state.setCurrentEditingNodeId,
  );

  const handleTogglePin = async (id: string, isPinned: boolean) => {
    await NodeService.upsert(id, { isPinned });
  };

  const handleSelectNode = (id: string) => {
    setCurrentEditingNodeId(id);
  };

  const handleDeleteNode = async (id: string) => {
    try {
      await NodeService.delete(id);
    } catch (err) {
      console.error("[CognitiveSidebar] delete node failed:", err);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {pinnedNodes.length > 0 && (
        <div className="flex flex-col gap-0.5">
          <p className="px-2.5 pb-1 text-[11px] font-semibold text-sidebar-foreground/50 tracking-wide">
            {t("置顶")}{" "}
          </p>
          {pinnedNodes.map((node) => (
            <NodeItem
              key={node.id}
              node={node}
              onTogglePin={handleTogglePin}
              isSelected={currentEditingNodeId === node.id}
              onSelect={handleSelectNode}
              onDelete={handleDeleteNode}
            />
          ))}
        </div>
      )}
      <div className="flex flex-col gap-0.5">
        <p className="px-2.5 pb-1 text-[11px] font-semibold text-sidebar-foreground/50 tracking-wide">
          {t("最近打开")}{" "}
        </p>
        {recentNodes.length > 0 ? (
          recentNodes.map((node) => (
            <NodeItem
              key={node.id}
              node={node}
              onTogglePin={handleTogglePin}
              isSelected={currentEditingNodeId === node.id}
              onSelect={handleSelectNode}
              onDelete={handleDeleteNode}
            />
          ))
        ) : (
          <p className="px-2.5 py-2.5 text-[12px] text-sidebar-foreground/40 italic">
            {t("No recent nodes")}{" "}
          </p>
        )}
      </div>
    </div>
  );
}

function NodeSemanticItem({
  semantic,
  onEdit,
  onDelete,
}: {
  semantic: NodeSemantic;
  onEdit: (semantic: NodeSemantic) => void;
  onDelete: (id: string) => void;
}) {
  const { t } = useI18n();

  return (
    <div className="group flex items-center justify-between rounded-lg px-2.5 py-2 hover:bg-sidebar-accent transition-colors duration-150">
      <div className="flex items-center gap-2.5 min-w-0">
        <IconView
          icon={
            semantic.icon
              ? {
                  kind: "icon",
                  value: semantic.icon,
                  color: semantic.color || "var(--sidebar-primary)",
                }
              : undefined
          }
          className="size-3.5 shrink-0"
          glyphClassName="size-3.5"
          fallback={
            <CircleDot
              className="size-3.5 shrink-0"
              style={{ color: semantic.color || "var(--sidebar-primary)" }}
            />
          }
        />
        <span className="text-[13px] text-sidebar-foreground truncate">
          {semantic.name}
        </span>
      </div>
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto transition-opacity duration-150">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-sidebar-foreground/30 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors rounded-md"
            >
              <MoreHorizontal className="size-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            side="right"
            sideOffset={12}
            className="w-52 rounded-xl border-sidebar-border bg-sidebar p-1.5 shadow-lg"
          >
            <DropdownMenuItem
              onClick={() => onEdit(semantic)}
              className="rounded-lg px-2.5 py-2 text-[13px] text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors cursor-pointer"
            >
              <Pencil className="mr-2 size-4" />
              {t("Edit")}{" "}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => onDelete(semantic.id)}
              className="rounded-lg px-2.5 py-2 text-[13px] text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors cursor-pointer"
            >
              <Trash2 className="mr-2 size-4" />
              {t("Delete")}{" "}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

function NodeSemanticList() {
  const { t } = useI18n();

  const nodeSemanticsMap = useDataStore((state) => state.nodeSemantics);
  const nodeSemantics = useMemo(
    () => Array.from(nodeSemanticsMap.values()),
    [nodeSemanticsMap],
  );
  const openDialog = useUIStore((state) => state.openNodeSemanticDialog);

  const handleDeleteSemantic = async (id: string) => {
    try {
      await NodeSemanticService.delete(id);
    } catch (err) {
      console.error("[CognitiveSidebar] delete node semantic failed:", err);
    }
  };

  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-0.5">
        {nodeSemantics.length > 0 ? (
          nodeSemantics.map((semantic) => (
            <NodeSemanticItem
              key={semantic.id}
              semantic={semantic}
              onEdit={openDialog}
              onDelete={handleDeleteSemantic}
            />
          ))
        ) : (
          <p className="px-2.5 py-2.5 text-[12px] text-sidebar-foreground/40 italic">
            {t("No node types")}{" "}
          </p>
        )}
      </div>
    </div>
  );
}

function EdgeSemanticCategory({
  category,
  semantics,
  onEdit,
  onDelete,
}: {
  category: string;
  semantics: EdgeSemantic[];
  onEdit: (semantic: EdgeSemantic) => void;
  onDelete: (id: string) => void;
}) {
  const { t } = useI18n();

  const [isOpen, setIsOpen] = useState(true);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="w-full pl-2">
      <div className="flex items-center justify-between">
        <CollapsibleTrigger asChild>
          <button className="flex items-center gap-1.5 py-1 hover:opacity-70 transition-opacity duration-200 cursor-pointer">
            <span
              className={cn(
                "transition-transform duration-200",
                isOpen ? "rotate-90" : "rotate-0",
              )}
            >
              <ChevronRight className="size-3 text-sidebar-foreground/40" />
            </span>
            <span className="text-[11px] font-semibold text-sidebar-foreground/60 tracking-wide uppercase">
              {category}
            </span>
          </button>
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent className="pt-0.5 pl-3">
        <div className="flex flex-col gap-0.5">
          {semantics.map((semantic) => (
            <div
              key={semantic.id}
              className="group flex items-center justify-between rounded-lg px-2 py-1.5 hover:bg-sidebar-accent transition-colors duration-150"
            >
              <div className="flex items-center gap-2 min-w-0">
                <IconView
                  icon={
                    semantic.icon
                      ? {
                          kind: "icon",
                          value: semantic.icon,
                          color: semantic.color || "var(--sidebar-foreground)",
                        }
                      : undefined
                  }
                  className="size-3 shrink-0"
                  glyphClassName="size-3"
                  fallback={
                    <Link2
                      className="size-3 text-sidebar-foreground/30 shrink-0"
                      style={{ color: semantic.color || undefined }}
                    />
                  }
                />
                <span className="text-[12px] text-sidebar-foreground truncate">
                  {semantic.name}
                </span>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6 text-sidebar-foreground/30 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors rounded-md opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto transition-opacity duration-150"
                  >
                    <MoreHorizontal className="size-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  side="right"
                  sideOffset={12}
                  className="w-52 rounded-xl border-sidebar-border bg-sidebar p-1.5 shadow-lg"
                >
                  <DropdownMenuItem
                    onClick={() => onEdit(semantic)}
                    className="rounded-lg px-2.5 py-2 text-[13px] text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors cursor-pointer"
                  >
                    <Pencil className="mr-2 size-4" />
                    {t("Edit")}{" "}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => onDelete(semantic.id)}
                    className="rounded-lg px-2.5 py-2 text-[13px] text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors cursor-pointer"
                  >
                    <Trash2 className="mr-2 size-4" />
                    {t("Delete")}{" "}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function EdgeSemanticList() {
  const { t } = useI18n();

  const edgeSemanticsMap = useDataStore((state) => state.edgeSemantics);
  const edgeSemantics = useMemo(
    () => Array.from(edgeSemanticsMap.values()),
    [edgeSemanticsMap],
  );
  const openDialog = useUIStore((state) => state.openEdgeSemanticDialog);

  const handleDeleteSemantic = async (id: string) => {
    try {
      await EdgeSemanticService.delete(id);
    } catch (err) {
      console.error("[CognitiveSidebar] delete edge semantic failed:", err);
    }
  };

  const categories = useMemo(
    () =>
      [
        { key: "hierarchy", label: t("层次关系") },
        { key: "flow", label: t("流向关系") },
        { key: "association", label: t("关联关系") },
        { key: "interaction", label: t("交互关系") },
      ] as const,
    [t],
  );

  const groupedSemantics = useMemo(
    () =>
      categories.reduce(
        (acc, cat) => {
          acc[cat.key] = edgeSemantics.filter((s) => s.category === cat.key);
          return acc;
        },
        {
          hierarchy: [] as typeof edgeSemantics,
          flow: [] as typeof edgeSemantics,
          association: [] as typeof edgeSemantics,
          interaction: [] as typeof edgeSemantics,
        },
      ),
    [edgeSemantics, categories],
  );

  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-2">
        {categories.map((cat) => (
          <EdgeSemanticCategory
            key={cat.key}
            category={cat.label}
            semantics={groupedSemantics[cat.key] || []}
            onEdit={openDialog}
            onDelete={handleDeleteSemantic}
          />
        ))}
      </div>
    </div>
  );
}

function SidebarUserMenu() {
  const { t } = useI18n();

  const { user, clearAuth } = useAuthStore();
  const logoutMutation = trpc.auth.logout.useMutation();

  const handleLogout = () => {
    // Server-side logout is best-effort; clear client state regardless.
    logoutMutation.mutateAsync().catch(() => {
      // ignore
    });
    clearAuthSession();
    reconnectTRPCClient();
    clearAuth();
    // Shared package has no `next` dependency — use a hard redirect.
    window.location.href = "/login";
  };

  if (!user) {
    return null;
  }

  return (
    <div className="px-3 py-3 border-t border-sidebar-border">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sidebar-foreground hover:bg-sidebar-accent transition-colors duration-150"
          >
            <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-sidebar-primary/10 text-[13px] font-semibold text-sidebar-primary">
              {user.nickname.charAt(0).toUpperCase()}
            </div>
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-sidebar-foreground">
              {user.nickname}
            </span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          side="top"
          sideOffset={8}
          className="w-52 rounded-xl border-sidebar-border bg-sidebar p-1.5 shadow-lg"
        >
          <DropdownMenuLabel className="rounded-lg px-2.5 py-2 text-[13px] text-sidebar-foreground">
            {user.nickname}
          </DropdownMenuLabel>
          {process.env.NEXT_PUBLIC_DBRAIN_PLATFORM !== "desktop" && (
            <>
              <DropdownMenuSeparator className="my-1.5 bg-sidebar-border" />
              <DropdownMenuItem
                onSelect={handleLogout}
                className="rounded-lg px-2.5 py-2 text-[13px] text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors cursor-pointer"
              >
                <LogOut className="mr-2 size-4" />
                {t("Sign out")}{" "}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
