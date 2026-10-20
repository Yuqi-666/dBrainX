// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { translate } from "@workspace/ui/lib/i18n/runtime";

import { useI18n } from "@workspace/ui/lib/i18n";

import { useEffect, useMemo, useRef, useState } from "react";
import GridLayout, {
  useContainerWidth,
  verticalCompactor,
} from "react-grid-layout";
import type { DashboardPage, NodeData } from "@workspace/interfaces";
import { useDataStore, useUIStore } from "@workspace/store";
import { DashboardService } from "@workspace/services";
import { DashboardLibrary } from "./dashboard-library";
import { DashboardSidebar } from "./dashboard-sidebar";
import { useDashboard } from "@workspace/ui/hooks/use-dashboard";
import { useFloatingPanel } from "@workspace/ui/hooks/use-floating-panel";
import { NodeContentEditor } from "@workspace/ui/components/node-content/node-content-editor";
import { Button } from "@workspace/ui/components/ui/button";
import { Input } from "@workspace/ui/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@workspace/ui/components/ui/dialog";
import { Tabs, TabsContent } from "@workspace/ui/components/ui/tabs";
import { cn } from "@workspace/ui/lib/utils";
import {
  CloudCheck,
  LoaderCircle,
  Maximize2,
  GripVertical,
  LayoutDashboard,
  Library,
  Plus,
  PanelLeftIcon,
  X,
} from "lucide-react";
import "react-grid-layout/css/styles.css";
import "./dashboard.css";

export function Dashboard() {
  const { t } = useI18n();

  const { scope, workspace, ready, syncState, reload } = useDashboard();
  const canEdit = ready && !syncState?.loading;
  const dashboardSidebarMode = useUIStore(
    (state) => state.dashboardSidebarMode,
  );
  const dashboardLibraryMode = useUIStore(
    (state) => state.dashboardLibraryMode,
  );
  const toggleDashboardSidebar = useUIStore(
    (state) => state.toggleDashboardSidebar,
  );
  const convertDashboardTempToFixed = useUIStore(
    (state) => state.convertDashboardTempToFixed,
  );
  const closeDashboardSidebar = useUIStore(
    (state) => state.closeDashboardSidebar,
  );
  const showTempDashboardSidebar = useUIStore(
    (state) => state.showTempDashboardSidebar,
  );
  const toggleDashboardLibrary = useUIStore(
    (state) => state.toggleDashboardLibrary,
  );
  const setDashboardLibraryMode = useUIStore(
    (state) => state.setDashboardLibraryMode,
  );
  const closeDashboardLibrary = useUIStore(
    (state) => state.closeDashboardLibrary,
  );
  const showTempDashboardLibrary = useUIStore(
    (state) => state.showTempDashboardLibrary,
  );
  // Both panels share the graph sidebar's rule: stay up while the pointer is
  // on them (or on a menu they opened), close the moment it is not.
  const sidebarRef = useRef<HTMLDivElement | null>(null);
  const libraryRef = useRef<HTMLDivElement | null>(null);
  useFloatingPanel(dashboardSidebarMode, sidebarRef, closeDashboardSidebar);
  useFloatingPanel(dashboardLibraryMode, libraryRef, closeDashboardLibrary);
  const [search, setSearch] = useState("");
  const [dragNodeId, setDragNodeId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"create" | "rename" | "delete" | null>(
    null,
  );
  const [dialogPageId, setDialogPageId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const nodes = useDataStore((state) => state.nodes);
  const pages = workspace?.pages ?? [];
  const page =
    pages.find((item) => item.id === workspace?.activePageId) ?? pages[0];
  const dialogPage = pages.find((item) => item.id === dialogPageId);
  const candidates = (workspace?.candidates ?? [])
    .map((id) => nodes.get(id))
    .filter(
      (node): node is NodeData =>
        node !== undefined &&
        node.title.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
    );
  const store = DashboardService;
  useEffect(() => {
    closeDashboardLibrary();
    setDragNodeId(null);
    setSearch("");
    setDialog(null);
  }, [scope, closeDashboardLibrary]);
  /** 空状态里的「组件库」按钮：点开即固定显示，不是悬浮预览。 */
  const openLibrary = () => setDashboardLibraryMode("fixed");
  const handleSidebarToggle = () => {
    if (dashboardSidebarMode === "temp") convertDashboardTempToFixed();
    else if (dashboardSidebarMode === "fixed") closeDashboardSidebar();
    else toggleDashboardSidebar();
  };
  const addNode = (nodeId: string, position?: { x: number; y: number }) => {
    if (!scope || !page || !nodes.has(nodeId)) return;
    store.addWidget(scope, page.id, nodeId, position);
  };
  // One node, two homes: the docked column and the floating overlay differ
  // only in their wrapper.
  const libraryPanel = (
    <DashboardLibrary
      candidates={candidates}
      page={page}
      enabled={canEdit}
      search={search}
      onSearch={setSearch}
      onClose={closeDashboardLibrary}
      onAdd={addNode}
      onDragNode={setDragNodeId}
    />
  );
  const openDialog = (kind: "create" | "rename" | "delete", target = page) => {
    setDialogPageId(kind === "create" ? null : (target?.id ?? null));
    setName(kind === "create" ? "" : (target?.name ?? ""));
    setDialog(kind);
  };
  const submit = () => {
    if (!scope || !canEdit) return;
    if (dialog === "create") store.createPage(scope, name);
    if (dialog === "rename" && dialogPage)
      store.renamePage(scope, dialogPage.id, name);
    if (dialog === "delete" && dialogPage)
      store.deletePage(scope, dialogPage.id);
    setDialog(null);
  };

  return (
    <Tabs
      value={page?.id ?? "empty"}
      onValueChange={(id) => scope && canEdit && store.selectPage(scope, id)}
      className="relative flex h-dvh min-w-0 gap-0 bg-background"
    >
      {dashboardSidebarMode === "temp" && (
        <div
          ref={sidebarRef}
          className="fixed top-0 left-0 z-40 h-full w-64 shadow-lg"
        >
          <DashboardSidebar
            pages={pages}
            enabled={canEdit}
            onCreate={() => openDialog("create")}
            onRename={(target) => openDialog("rename", target)}
            onDelete={(target) => openDialog("delete", target)}
            onToggle={handleSidebarToggle}
            pinned={false}
          />
        </div>
      )}

      {/*
        The tab root is a *column*: the `Tabs` primitive adds
        `data-horizontal:flex-col`, and a data variant outranks a plain
        `flex-row`. So the sidebar and the content cannot both be its children —
        an `h-full` sidebar takes the whole viewport height and pushes the
        content out of the overflow-hidden shell, which is the blank page the
        reader saw after opening the sidebar. One row child holds both.
      */}
      <div className="flex min-h-0 min-w-0 flex-1">
        {dashboardSidebarMode === "fixed" && (
          <div className="relative z-30 h-full w-64 shrink-0">
            <DashboardSidebar
              pages={pages}
              enabled={canEdit}
              onCreate={() => openDialog("create")}
              onRename={(target) => openDialog("rename", target)}
              onDelete={(target) => openDialog("delete", target)}
              onToggle={handleSidebarToggle}
              pinned
            />
          </div>
        )}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <header className="flex min-h-16 shrink-0 items-center gap-2 border-b border-border/60 px-4 py-2 sm:px-6">
            {/*
              Hidden while the sidebar is pinned — the graph header does the
              same, and the pin is released from the sidebar's own button.
            */}
            {dashboardSidebarMode !== "fixed" && (
              <Button
                variant="outline"
                size="icon"
                onClick={handleSidebarToggle}
                aria-label={
                  dashboardSidebarMode === "temp"
                    ? t("固定侧边栏")
                    : t("打开 Dashboard 侧边栏")
                }
                title={
                  dashboardSidebarMode === "temp"
                    ? t("固定侧边栏")
                    : t("打开 Dashboard 侧边栏")
                }
                aria-expanded={dashboardSidebarMode !== "closed"}
              >
                <PanelLeftIcon className="size-4" />
              </Button>
            )}
            <div className="min-w-0 flex-1">
              {page ? (
                <DashboardTitle
                  key={`${scope}:${page.id}`}
                  name={page.name}
                  enabled={canEdit}
                  onRename={(next) =>
                    scope && store.renamePage(scope, page.id, next)
                  }
                />
              ) : (
                <span className="text-lg font-semibold tracking-tight">
                  {t("Dashboard")}
                </span>
              )}
            </div>
            <span
              className={cn(
                "flex min-w-20 shrink-0 items-center justify-end gap-2 text-xs text-muted-foreground",
                syncState?.error && "text-destructive",
              )}
              role="status"
              aria-live="polite"
            >
              {syncState?.loading || syncState?.pending ? (
                <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" />
              ) : ready && !syncState?.error ? (
                <CloudCheck className="size-3.5" />
              ) : null}
              {syncState?.error
                ? t("未同步")
                : syncState?.loading
                  ? t("正在同步…")
                  : syncState?.pending
                    ? t("保存中…")
                    : ready
                      ? t("已保存")
                      : ""}
            </span>
            <Button
              variant="outline"
              onClick={toggleDashboardLibrary}
              aria-label={
                dashboardLibraryMode === "fixed"
                  ? t("关闭组件库")
                  : t("打开组件库")
              }
              title={
                dashboardLibraryMode === "fixed"
                  ? t("关闭组件库")
                  : t("打开组件库")
              }
              aria-expanded={dashboardLibraryMode !== "closed"}
              aria-controls="dashboard-library"
              className="gap-2"
            >
              <Library className="size-4" />
              <span className="hidden sm:inline">{t("组件库")}</span>
            </Button>
          </header>
          {syncState?.error && (
            <div
              className="flex items-center gap-3 border-b px-4 py-2 text-sm text-destructive"
              role="alert"
            >
              <span>{syncState.error}</span>
              <Button variant="outline" size="sm" onClick={reload}>
                {t("重新加载")}{" "}
              </Button>
            </div>
          )}
          <TabsContent
            value={page?.id ?? "empty"}
            className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden"
          >
            <div
              className="min-h-0 min-w-0 flex-1 overflow-y-auto bg-muted/30 pb-[calc(var(--dynamic-island-height,48px)+32px)]"
              role="region"
              aria-label={page?.name ?? t("Dashboard 内容")}
            >
              <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-8 sm:py-8">
                {!ready ? (
                  <div className="flex min-h-80 items-center justify-center gap-3 text-sm text-muted-foreground">
                    {scope && (
                      <LoaderCircle className="size-5 animate-spin motion-reduce:animate-none" />
                    )}
                    {syncState?.error
                      ? t("暂时无法加载 Dashboard，请重新加载。")
                      : scope
                        ? t("加载 Dashboard…")
                        : t("请选择工作空间")}
                  </div>
                ) : !page ? (
                  <div className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center text-center">
                    <div className="mb-6 flex size-16 items-center justify-center rounded-2xl border bg-background">
                      <LayoutDashboard className="size-7 text-muted-foreground" />
                    </div>
                    <h1 className="text-2xl font-semibold tracking-tight">
                      {t("为你的工作创建一个页面")}{" "}
                    </h1>
                    <p className="mt-3 max-w-sm text-sm leading-relaxed text-muted-foreground">
                      {t(
                        "将笔记、任务和数据视图放在一起。每个页面，都可以有自己的用途。",
                      )}{" "}
                    </p>
                    <Button
                      className="mt-6"
                      disabled={!canEdit}
                      onClick={() => openDialog("create")}
                    >
                      <Plus className="size-4" />
                      {t("新建页面")}{" "}
                    </Button>
                  </div>
                ) : (
                  <DashboardGrid
                    key={`${scope}:${page.id}`}
                    scope={scope!}
                    page={page}
                    enabled={canEdit}
                    dragNodeId={dragNodeId}
                    onOpenLibrary={openLibrary}
                    onDropNode={(nodeId, position) => {
                      addNode(nodeId, position);
                      setDragNodeId(null);
                    }}
                  />
                )}
              </div>
            </div>
          </TabsContent>
        </div>
        {dashboardLibraryMode === "fixed" && (
          <div className="relative z-30 h-full w-80 shrink-0 border-l bg-background">
            {libraryPanel}
          </div>
        )}
      </div>

      {/*
        A hover-opened library floats over the content instead of taking a
        column: crossing the edge strip must not reflow the dashboard, and
        keeping it out of the flex row also keeps the grid's measured width
        stable. Only the pinned (`fixed`) library is docked — see the row
        above.
      */}
      {dashboardLibraryMode === "temp" && (
        <div
          ref={libraryRef}
          className="fixed top-0 right-0 z-40 h-dvh w-80 border-l bg-background shadow-lg"
        >
          {libraryPanel}
        </div>
      )}

      {dashboardSidebarMode === "closed" && (
        <div
          className="absolute top-0 left-0 z-30 h-full w-3"
          onMouseEnter={showTempDashboardSidebar}
        />
      )}

      {dashboardLibraryMode === "closed" && (
        <div
          className="absolute top-0 right-0 z-30 h-full w-3"
          onMouseEnter={showTempDashboardLibrary}
        />
      )}

      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <DialogHeader>
              <DialogTitle>
                {dialog === "create"
                  ? t("新建页面")
                  : dialog === "rename"
                    ? t("重命名页面")
                    : t("删除页面")}
              </DialogTitle>
              <DialogDescription>
                {dialog === "delete"
                  ? translate(
                      "删除“{value1}”及其布局？节点内容和组件库会保留。",
                      { value1: dialogPage?.name ?? "" },
                    )
                  : t("为这个工作页面取一个名称。")}
              </DialogDescription>
            </DialogHeader>
            {dialog !== "delete" && (
              <Input
                autoFocus
                aria-label={t("页面名称")}
                maxLength={80}
                className="mt-4"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t("例如：项目进度")}
              />
            )}
            <DialogFooter className="mt-6">
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialog(null)}
              >
                {t("取消")}{" "}
              </Button>
              <Button
                type="submit"
                variant={dialog === "delete" ? "destructive" : "default"}
                disabled={
                  !canEdit ||
                  (dialog !== "create" && !dialogPage) ||
                  (dialog !== "delete" && !name.trim())
                }
              >
                {dialog === "delete" ? t("删除") : t("保存")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Tabs>
  );
}

function DashboardTitle({
  name,
  enabled,
  onRename,
}: {
  name: string;
  enabled: boolean;
  onRename: (name: string) => void;
}) {
  const { t } = useI18n();

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const finished = useRef(false);
  const start = () => {
    if (!enabled) return;
    finished.current = false;
    setDraft(name);
    setEditing(true);
  };
  const save = () => {
    if (finished.current) return;
    finished.current = true;
    const next = draft.trim();
    if (enabled && next && next !== name) onRename(next);
    setEditing(false);
  };
  return editing ? (
    <Input
      autoFocus
      aria-label={t("Dashboard 标题")}
      maxLength={80}
      value={draft}
      className="h-9 w-full max-w-xl text-2xl font-semibold tracking-tight md:text-2xl"
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={save}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === "Enter") {
          event.preventDefault();
          save();
        } else if (event.key === "Escape") {
          event.preventDefault();
          finished.current = true;
          setEditing(false);
        }
      }}
    />
  ) : (
    <h1 className="max-w-xl truncate text-2xl leading-9 font-semibold tracking-tight">
      <button
        type="button"
        disabled={!enabled}
        title={t("双击重命名")}
        aria-label={translate("Dashboard 标题：{value1}，双击或按回车重命名", {
          value1: name,
        })}
        className="max-w-full truncate rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onDoubleClick={start}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === "F2") {
            event.preventDefault();
            start();
          }
        }}
      >
        {name}
      </button>
    </h1>
  );
}

function DashboardGrid({
  scope,
  page,
  enabled,
  dragNodeId,
  onDropNode,
  onOpenLibrary,
}: {
  scope: string;
  page: DashboardPage;
  enabled: boolean;
  dragNodeId: string | null;
  onOpenLibrary: () => void;
  onDropNode: (nodeId: string, position: { x: number; y: number }) => void;
}) {
  const { t } = useI18n();

  const { width, containerRef, mounted } = useContainerWidth();
  const nodes = useDataStore((state) => state.nodes);
  const narrow = width < 640;
  const layout = useMemo(
    () =>
      page.widgets.map((widget, index) => ({
        i: widget.id,
        x: narrow ? 0 : widget.x,
        y: narrow
          ? page.widgets
              .slice(0, index)
              .reduce((total, item) => total + item.h, 0)
          : widget.y,
        w: narrow ? 12 : widget.w,
        h: widget.h,
        minW: 2,
        minH: 4,
      })),
    [page.widgets, narrow],
  );
  return (
    <div
      ref={containerRef}
      className={cn(
        "dashboard-grid relative min-h-80",
        enabled && !narrow && "dashboard-grid-editing",
      )}
    >
      {page.widgets.length === 0 && (
        <div className="absolute inset-x-0 flex min-h-96 flex-col items-center justify-center rounded-2xl border border-dashed bg-background/60 px-6 text-center">
          <Library className="mb-4 size-8 text-muted-foreground" />
          <h2 className="text-lg font-medium">{t("从一个节点开始")}</h2>
          <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
            {t("把常用节点添加到这个页面，再按你的工作方式安排它们。")}{" "}
          </p>
          <Button className="mt-6" disabled={!enabled} onClick={onOpenLibrary}>
            <Plus className="size-4" />
            {t("添加组件")}{" "}
          </Button>
        </div>
      )}
      {mounted && (
        <GridLayout
          width={width}
          layout={layout}
          gridConfig={{
            cols: 12,
            rowHeight: 40,
            margin: [16, 16],
            containerPadding: [0, 0],
          }}
          dragConfig={{
            enabled: enabled && !narrow,
            handle: ".dashboard-drag-handle",
            cancel: "button",
          }}
          resizeConfig={{ enabled: enabled && !narrow, handles: ["se"] }}
          dropConfig={{ enabled: enabled && !narrow }}
          droppingItem={{ i: "__dashboard_drop__", x: 0, y: 0, w: 6, h: 8 }}
          compactor={verticalCompactor}
          style={{
            minHeight: page.widgets.length ? 320 : 384,
            pointerEvents:
              page.widgets.length || dragNodeId ? undefined : "none",
          }}
          onLayoutChange={(next) => {
            if (enabled && !narrow)
              DashboardService.updateLayout(scope, page.id, next);
          }}
          onDropDragOver={() => (dragNodeId ? { w: 6, h: 8 } : false)}
          onDrop={(_layout, item) => {
            if (item && dragNodeId)
              onDropNode(dragNodeId, { x: item.x, y: item.y });
          }}
        >
          {page.widgets.map((widget) => {
            const node = nodes.get(widget.nodeId);
            return (
              <div
                key={widget.id}
                className={cn(
                  "@container flex min-h-0 flex-col overflow-hidden rounded-xl border bg-background",
                  enabled && "ring-1 ring-border",
                )}
              >
                <div
                  className={cn(
                    "dashboard-drag-handle flex h-12 shrink-0 items-center gap-1 border-b border-border/60 px-2 @min-[200px]:gap-2 @min-[200px]:px-4",
                    enabled && !narrow && "cursor-grab active:cursor-grabbing",
                  )}
                >
                  {enabled && (
                    <GripVertical className="hidden size-4 shrink-0 text-muted-foreground @min-[200px]:block" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {node?.title || t("节点已删除或不可用")}
                  </span>
                  {node && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      aria-label={translate("打开节点 {value1}", {
                        value1: node.title,
                      })}
                      title={t("打开节点")}
                      onClick={() =>
                        useUIStore.getState().handleNodeEdit(node.id)
                      }
                    >
                      <Maximize2 className="size-3.5" />
                    </Button>
                  )}
                  {enabled && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      aria-label={translate("移除组件 {value1}", {
                        value1: node?.title ?? "",
                      })}
                      onClick={() =>
                        DashboardService.removeWidget(scope, page.id, widget.id)
                      }
                    >
                      <X className="size-4" />
                    </Button>
                  )}
                </div>
                <div className="min-h-0 flex-1 overflow-auto">
                  {node ? (
                    <NodeContentEditor node={node} className="h-full min-h-0" />
                  ) : (
                    <p className="p-4 text-sm text-muted-foreground">
                      {t("原节点不可用，可以从页面移除此组件。")}{" "}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </GridLayout>
      )}
    </div>
  );
}
