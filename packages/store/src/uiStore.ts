// SPDX-License-Identifier: AGPL-3.0-only

import { create } from "zustand";
import { devtools } from "zustand/middleware";
import type {
  ViewId,
  NodeId,
  NodeDataType,
  EdgeId,
  NodeSemantic,
  EdgeSemantic,
  View,
  IslandPanel,
} from "@workspace/interfaces";

// ==================== Shared Types ====================

export type ContextMenuType = "node" | "edge" | "canvas" | "groupSelect" | "add-edge";

export type ContextMenuContext =
  | { nodeId: string }
  | { edgeId: string }
  | Record<string, never>
  | { nodeIds: string[]; edgeIds: string[] }
  | { sourceIds: string[]; targetId: string | null };

/**
 * The workspace surfaces the shell keeps alive, plus the fullscreen editor,
 * which is an overlay on the surface it was opened from rather than a
 * destination of its own.
 */
export type MainViewType = "graph" | "editor" | "dashboard" | "resources";

/** A surface a fullscreen editor can return to (`MainViewType` minus itself). */
export type SurfaceViewType = Exclude<MainViewType, "editor">;

/**
 * 灵动岛当前面板（`idle` 即收起）。定义在 `@workspace/interfaces`（唯一真源），
 * 这里只是把 store 的公开面重新导出一次。
 */
export type { IslandPanel };

/**
 * Sidebar 显示模式
 * - "closed": 关闭状态
 * - "fixed": 固定显示（推开右侧内容）
 * - "temp": 临时显示（浮动面板，不推开内容）
 */
export type SidebarMode = "closed" | "fixed" | "temp";

/**
 * 「新建节点语义」对话框创建成功后的后续动作（发起入口写入，对话框消费）。
 *
 * - `assign`：把新语义选给一个已存在的节点 —
 *   节点右键菜单 → 选择类型 → Add new type。
 * - `create`：用新语义创建一个新节点 —
 *   画布右键菜单 → Add Node → 选数据类型 → Add new type。
 */
export type NodeSemanticAfterCreate =
  | { kind: "assign"; nodeId: NodeId }
  | {
      kind: "create";
      nodeType: NodeDataType;
      simX?: number;
      simY?: number;
      viewId?: string;
    };

/**
 * 「删除节点 / 清空节点」对话框的两种动作。
 *
 * 两者都要处理节点引用的已上传资源：节点本身是否保留、上传的文件是否一并删除，
 * 由对话框里的第二个选择决定，与这个动作无关。
 */
export type NodeDispositionMode = "delete" | "clear";

// ==================== Store Interface ====================

export interface UIStore {
  // ==================== Graph UI Section ====================
  // Selection state
  selectedNodeIds: Set<string>;
  selectedEdgeIds: Set<string>;
  setSelectedNodeIds: (ids: Set<string>) => void;
  setSelectedEdgeIds: (ids: Set<string>) => void;

  // Context menu
  contextMenu: {
    x: number;
    y: number;
    visible: boolean;
    type: ContextMenuType | null;
    context: ContextMenuContext | null;
  };
  setContextMenu: (menu: UIStore["contextMenu"]) => void;
  closeContextMenu: () => void;

  // Preview block
  previewBlock: {
    nodeId: string | null;
    visible: boolean;
    isFocus: boolean;
  };
  setPreviewBlock: (block: UIStore["previewBlock"]) => void;
  closePreviewBlock: () => void;

  // Node focus
  isNodeFocus: boolean;
  setIsNodeFocus: (value: boolean) => void;

  // Semantic dialogs - Node
  nodeSemanticDialog: {
    open: boolean;
    editingSemantic: NodeSemantic | null;
    /**
     * 创建成功后的后续动作；`null` 表示只在语义库中新建，不改变图中的节点。
     */
    afterCreate: NodeSemanticAfterCreate | null;
  };
  openNodeSemanticDialog: (
    semantic?: NodeSemantic | null,
    afterCreate?: NodeSemanticAfterCreate | null,
  ) => void;
  closeNodeSemanticDialog: () => void;

  // Node disposition dialog - Delete / Clear with an uploaded-resource choice
  /**
   * 删除或清空节点前，若节点引用了已上传资源，由这个对话框让用户决定资源是否
   * 一并删除。`nodeId` 为对话目标（对话框自己从 store 里取最新节点）。
   */
  nodeDispositionDialog: {
    open: boolean;
    mode: NodeDispositionMode;
    nodeId: NodeId | null;
  };
  openNodeDispositionDialog: (
    nodeId: NodeId,
    mode: NodeDispositionMode,
  ) => void;
  closeNodeDispositionDialog: () => void;

  // Semantic dialogs - Edge
  edgeSemanticDialog: {
    open: boolean;
    editingSemantic: EdgeSemantic | null;
    /**
     * 新建语义后要自动绑定该语义的边（从边的右键菜单进入时写入）。
     * `null` 表示只在语义库中新建，不改变任何边。
     */
    assignToEdgeId: EdgeId | null;
  };
  openEdgeSemanticDialog: (
    semantic?: EdgeSemantic | null,
    assignToEdgeId?: EdgeId | null,
  ) => void;
  closeEdgeSemanticDialog: () => void;

  // Workspace dialogs - Create
  workspaceCreateDialog: {
    open: boolean;
  };
  openWorkspaceCreateDialog: () => void;
  closeWorkspaceCreateDialog: () => void;

  // View dialogs - Create / Edit
  viewDialog: {
    open: boolean;
    /** 编辑目标；为 null 表示新建视图。 */
    editingView: View | null;
  };
  openViewCreateDialog: () => void;
  openViewEditDialog: (view: View) => void;
  closeViewDialog: () => void;

  // Graph UI actions
  handleNodeEdit: (nodeId: string) => void;
  handleCreateEdge: (from: string[], to: string | null, x?: number, y?: number) => Promise<void>;

  // ==================== Node Editor Section ====================
  /** 当前正在编辑的节点ID */
  currentEditingNodeId: NodeId | null;
  /** 设置当前正在编辑的节点 */
  setCurrentEditingNodeId: (nodeId: NodeId | null) => void;
  /**
   * 非受控 Tiptap 编辑器（text / rich-text）的重挂载记号：`nodeId -> 版本号`。
   *
   * 两个编辑器都是「挂载时读一次 `initialContent`，之后自己持有文档」，所以
   * store 里的内容被整体替换（清空节点、删除资源后剥掉引用块）时，它们不会
   * 重绘。把版本号并进编辑器的 `key`，替换一次就重挂载一次；普通输入只写 store，
   * 不动这个 map，因此不会打断正在编辑的文档。
   */
  nodeContentReset: Record<string, number>;
  /** 标记某个节点的内容已被外部整体替换，让其非受控编辑器重挂载。 */
  resetNodeContent: (nodeId: NodeId) => void;
  /** 最近打开的节点ID队列（长度上限 10，队首为最新） */
  recentlyOpenedNodeIds: NodeId[];
  /** 将节点ID推入最近打开队列（去重置顶，超出 10 淘汰队尾） */
  pushRecentlyOpenedNode: (nodeId: NodeId) => void;

  // ==================== Attributes Sidebar Section ====================
  /** 属性侧边栏是否展开 */
  attributesSidebarOpen: boolean;
  /** 切换属性侧边栏展开状态 */
  toggleAttributesSidebar: () => void;
  /** 设置属性侧边栏展开状态 */
  setAttributesSidebarOpen: (open: boolean) => void;

  // ==================== Sidebar Section ====================
  /** Sidebar 显示模式 */
  sidebarMode: SidebarMode;
  /** 切换 sidebar 显示（固定模式） */
  toggleSidebar: () => void;
  /** 设置 sidebar 模式 */
  setSidebarMode: (mode: SidebarMode) => void;
  /** 切换到固定显示模式 */
  convertTempToFixed: () => void;
  /** 关闭 sidebar */
  closeSidebar: () => void;
  /** 临时显示 sidebar（浮动面板） */
  showTempSidebar: () => void;
  /** Sidebar 当前激活的 tab（认知侧边栏） */
  sidebarActiveTab: string;
  /** 设置 sidebar 激活的 tab */
  setSidebarActiveTab: (tab: string) => void;

  // ==================== Dashboard Sidebar Section ====================
  /**
   * Dashboard 左侧栏（标题、工作空间、页面 tab）显示模式。与图的
   * `sidebarMode` 分开，因为两个界面各自维护自己的侧栏，互不干扰。
   */
  dashboardSidebarMode: SidebarMode;
  /** 切换 dashboard 左侧栏（closed <-> fixed） */
  toggleDashboardSidebar: () => void;
  /** 设置 dashboard 左侧栏模式 */
  setDashboardSidebarMode: (mode: SidebarMode) => void;
  /** 切换到固定显示模式 */
  convertDashboardTempToFixed: () => void;
  /** 关闭 dashboard 左侧栏 */
  closeDashboardSidebar: () => void;
  /** 临时显示 dashboard 左侧栏（浮动面板） */
  showTempDashboardSidebar: () => void;
  /**
   * Dashboard 右侧组件库的显示模式。与左侧栏一样是三态：`closed`；
   * `temp`（指针滑到右边缘时浮出，离开即收回，不推挤内容）；`fixed`
   * （点标题栏的「组件库」按钮后固定下来，不随指针离开消失）。
   */
  dashboardLibraryMode: SidebarMode;
  /** 切换 dashboard 右侧组件库（closed/temp <-> fixed） */
  toggleDashboardLibrary: () => void;
  /** 设置 dashboard 右侧组件库模式 */
  setDashboardLibraryMode: (mode: SidebarMode) => void;
  /** 关闭 dashboard 右侧组件库 */
  closeDashboardLibrary: () => void;
  /** 临时显示 dashboard 右侧组件库（浮动面板） */
  showTempDashboardLibrary: () => void;

  // ==================== Main View Section ====================
  /** 当前主视图类型：节点图 或 节点编辑页面 */
  mainViewType: MainViewType;
  editorReturnViewType: SurfaceViewType;
  /** 设置主视图类型 */
  setMainViewType: (type: MainViewType) => void;

  // ==================== View Section ====================
  /** 当前选中的视图ID */
  currentViewId: ViewId | null;
  /** 设置当前选中的视图 */
  setCurrentViewId: (viewId: ViewId | null) => void;

  // ==================== Dynamic Island Section ====================
  /**
   * 灵动岛当前面板（受控状态；`idle` 即收起）。受控壳
   * `<DynamicIsland panel onPanelChange />` 的 `panel` 直接取这个值 —— 岛本身
   * 既不读 store 也不做业务判断（设计 §5.2 的三条边界）。
   */
  islandPanel: IslandPanel;
  islandPreviewNodeId: NodeId | null;
  openIslandPreview: (nodeId: NodeId) => void;
  /**
   * 「最近一次打开的功能面板」，收起（`idle`）时保留，供再次展开时复用。
   */
  lastIslandPanel: Exclude<IslandPanel, "idle">;
  /** 打开某个面板（等价于「展开岛」）；传 `idle` 即收起 */
  setIslandPanel: (panel: IslandPanel) => void;
  /** 收起岛（保留 `lastIslandPanel`，供 ⌘K 复用） */
  collapseIsland: () => void;
  /** ctrl/⌘+K：未展开则以 `lastIslandPanel` 打开，已展开则收起 */
  toggleIslandFromKeyboard: () => void;

  // ==================== Panel Visibility Section ====================
  /** 视图配置面板是否显示 */
  viewConfigPanelOpen: boolean;
  /** 设置视图配置面板显示状态 */
  setViewConfigPanelOpen: (open: boolean) => void;

  /** 选项菜单是否显示 */
  optionsMenuOpen: boolean;
  /** 设置选项菜单显示状态 */
  setOptionsMenuOpen: (open: boolean) => void;
}

// ==================== Store Implementation ====================

export const useUIStore = create<UIStore>()(
  devtools(
    (set, _get) => ({
      // ==================== Graph UI - Selection ====================
      selectedNodeIds: new Set<string>(),
      selectedEdgeIds: new Set<string>(),
      setSelectedNodeIds: (ids) => set({ selectedNodeIds: ids }),
      setSelectedEdgeIds: (ids) => set({ selectedEdgeIds: ids }),

      // ==================== Graph UI - Context Menu ====================
      contextMenu: {
        x: 0,
        y: 0,
        visible: false,
        type: null,
        context: null,
      },
      setContextMenu: (menu) => set({ contextMenu: menu }),
      closeContextMenu: () =>
        set((state) => ({
          contextMenu: { ...state.contextMenu, visible: false },
        })),

      // ==================== Graph UI - Preview Block ====================
      previewBlock: {
        nodeId: null,
        visible: false,
        isFocus: false,
      },
      setPreviewBlock: (block) =>
        set({
          previewBlock: block,
          isNodeFocus: block.isFocus,
        }),
      closePreviewBlock: () =>
        set({
          previewBlock: {
            nodeId: null,
            visible: false,
            isFocus: false,
          },
          isNodeFocus: false,
        }),

      // ==================== Graph UI - Node Focus ====================
      isNodeFocus: false,
      setIsNodeFocus: (value) => set({ isNodeFocus: value }),

      // ==================== Graph UI - Semantic Dialogs ====================
      nodeSemanticDialog: {
        open: false,
        editingSemantic: null,
        afterCreate: null,
      },
      openNodeSemanticDialog: (semantic = null, afterCreate = null) =>
        set({
          nodeSemanticDialog: {
            open: true,
            editingSemantic: semantic,
            afterCreate,
          },
        }),
      closeNodeSemanticDialog: () =>
        set({
          nodeSemanticDialog: {
            open: false,
            editingSemantic: null,
            afterCreate: null,
          },
        }),

      edgeSemanticDialog: {
        open: false,
        editingSemantic: null,
        assignToEdgeId: null,
      },
      openEdgeSemanticDialog: (semantic = null, assignToEdgeId = null) =>
        set({
          edgeSemanticDialog: {
            open: true,
            editingSemantic: semantic,
            assignToEdgeId,
          },
        }),
      closeEdgeSemanticDialog: () =>
        set({
          edgeSemanticDialog: {
            open: false,
            editingSemantic: null,
            assignToEdgeId: null,
          },
        }),

      // ==================== Graph UI - Workspace Dialogs ====================
      workspaceCreateDialog: {
        open: false,
      },
      openWorkspaceCreateDialog: () =>
        set({
          workspaceCreateDialog: { open: true },
        }),
      closeWorkspaceCreateDialog: () =>
        set({
          workspaceCreateDialog: { open: false },
        }),

      // ==================== Graph UI - View Dialogs ====================
      viewDialog: {
        open: false,
        editingView: null,
      },
      openViewCreateDialog: () =>
        set({
          viewDialog: { open: true, editingView: null },
        }),
      openViewEditDialog: (view) =>
        set({
          viewDialog: { open: true, editingView: view },
        }),
      closeViewDialog: () =>
        set({
          viewDialog: { open: false, editingView: null },
        }),

      // ==================== Graph UI - Actions ====================
      handleNodeEdit: (nodeId) => {
        // Access internal state setter directly to avoid circular dependency issues
        set({ currentEditingNodeId: nodeId });
      },

      handleCreateEdge: async (_from, _to, _x, _y) => {
        // Placeholder - implementation depends on edge creation logic
      },

      // ==================== Graph UI - Node Disposition Dialog ====================
      nodeDispositionDialog: {
        open: false,
        mode: "delete",
        nodeId: null,
      },
      openNodeDispositionDialog: (nodeId, mode) =>
        set({
          nodeDispositionDialog: {
            open: true,
            mode,
            nodeId,
          },
        }),
      closeNodeDispositionDialog: () =>
        set({
          nodeDispositionDialog: {
            open: false,
            mode: "delete",
            nodeId: null,
          },
        }),

      // ==================== Node Editor ====================
      currentEditingNodeId: null,
      setCurrentEditingNodeId: (nodeId) => set({ currentEditingNodeId: nodeId }),
      nodeContentReset: {},
      resetNodeContent: (nodeId) =>
        set((state) => ({
          nodeContentReset: {
            ...state.nodeContentReset,
            [nodeId]: (state.nodeContentReset[nodeId] ?? 0) + 1,
          },
        })),
      recentlyOpenedNodeIds: [],
      pushRecentlyOpenedNode: (nodeId) =>
        set((state) => ({
          recentlyOpenedNodeIds: [
            nodeId,
            ...state.recentlyOpenedNodeIds.filter((id) => id !== nodeId),
          ].slice(0, 10),
        })),

      // ==================== Attributes Sidebar ====================
      attributesSidebarOpen: false,
      toggleAttributesSidebar: () =>
        set((state) => ({ attributesSidebarOpen: !state.attributesSidebarOpen })),
      setAttributesSidebarOpen: (open) => set({ attributesSidebarOpen: open }),

      // ==================== Sidebar ====================
      sidebarMode: "closed",
      toggleSidebar: () =>
        set((state) => ({
          sidebarMode: state.sidebarMode === "fixed" ? "closed" : "fixed",
        })),
      setSidebarMode: (mode) => set({ sidebarMode: mode }),
      convertTempToFixed: () => set({ sidebarMode: "fixed" }),
      closeSidebar: () => set({ sidebarMode: "closed" }),
      showTempSidebar: () => set({ sidebarMode: "temp" }),
      sidebarActiveTab: "nodes",
      setSidebarActiveTab: (tab) => set({ sidebarActiveTab: tab }),

      // ==================== Dashboard Sidebar ====================
      dashboardSidebarMode: "closed",
      toggleDashboardSidebar: () =>
        set((state) => ({
          dashboardSidebarMode:
            state.dashboardSidebarMode === "fixed" ? "closed" : "fixed",
        })),
      setDashboardSidebarMode: (mode) => set({ dashboardSidebarMode: mode }),
      convertDashboardTempToFixed: () =>
        set({ dashboardSidebarMode: "fixed" }),
      closeDashboardSidebar: () => set({ dashboardSidebarMode: "closed" }),
      showTempDashboardSidebar: () => set({ dashboardSidebarMode: "temp" }),
      dashboardLibraryMode: "closed",
      toggleDashboardLibrary: () =>
        set((state) => ({
          dashboardLibraryMode:
            state.dashboardLibraryMode === "fixed" ? "closed" : "fixed",
        })),
      setDashboardLibraryMode: (mode) => set({ dashboardLibraryMode: mode }),
      closeDashboardLibrary: () => set({ dashboardLibraryMode: "closed" }),
      showTempDashboardLibrary: () => set({ dashboardLibraryMode: "temp" }),

      // ==================== Main View ====================
      mainViewType: "graph",
      editorReturnViewType: "graph",
      setMainViewType: (type) => set((state) => ({
        mainViewType: type,
        editorReturnViewType: type === "editor" && state.mainViewType !== "editor"
          ? state.mainViewType
          : state.editorReturnViewType,
      })),

      // ==================== View ====================
      currentViewId: null,
      setCurrentViewId: (viewId) => set({ currentViewId: viewId }),

      // ==================== Dynamic Island ====================
      islandPanel: "idle",
      islandPreviewNodeId: null,
      openIslandPreview: (nodeId) => set({
        islandPreviewNodeId: nodeId,
        islandPanel: "preview",
        lastIslandPanel: "preview",
        previewBlock: { nodeId: null, visible: false, isFocus: false },
      }),
      lastIslandPanel: "search",
      // 打开时记下「最近一次功能面板」，收起时不覆盖它（与 design §6.1 的
      // `...(panel === "idle" ? {} : { lastIslandPanel: panel })` 等价，
      // 写成显式三元只是为了对象字面量的类型更直接）。
      setIslandPanel: (panel) =>
        set(
          panel === "idle"
            ? { islandPanel: panel }
            : { islandPanel: panel, lastIslandPanel: panel },
        ),
      collapseIsland: () => set({ islandPanel: "idle" }),
      toggleIslandFromKeyboard: () =>
        set((state) =>
          state.islandPanel === "idle"
            ? { islandPanel: state.lastIslandPanel }
            : { islandPanel: "idle" },
        ),

      // ==================== Panel Visibility ====================
      viewConfigPanelOpen: false,
      setViewConfigPanelOpen: (open) => set({ viewConfigPanelOpen: open }),
      optionsMenuOpen: false,
      setOptionsMenuOpen: (open) => set({ optionsMenuOpen: open }),
    }),
    { name: "ui-store" },
  ),
);
