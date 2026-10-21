import { resourceLibraryMessages } from "./messages-resources.ts";
import { resourceSelectorMessages } from "./messages-resource-selector.ts";
import { nodeDispositionMessages } from "./messages-node-disposition.ts";
import { workspaceMessages } from "./messages-workspace.ts";

// Interface copy only. Never pass user-authored content through this catalog.
//
// The catalog is one map, so `translate` stays a single lookup. Copy that a
// feature owns lives in its own module and is spread in here: that keeps the
// feature file reviewable on its own and this file free of a merge conflict
// between two features written at the same time. Every module uses the same
// `key → { zh-CN, en }` shape, and `runtime.test.ts` validates them together.
export const messages: Record<string, { "zh-CN": string; en: string }> = {
  ...resourceLibraryMessages,
  ...resourceSelectorMessages,
  ...nodeDispositionMessages,
  ...workspaceMessages,
  "Sign In": {
    "zh-CN": "登录",
    en: "Sign In",
  },
  "Enter your credentials to access your knowledge graph": {
    "zh-CN": "输入账号信息，访问你的知识图谱",
    en: "Enter your credentials to access your knowledge graph",
  },
  Email: {
    "zh-CN": "邮箱",
    en: "Email",
  },
  Password: {
    "zh-CN": "密码",
    en: "Password",
  },
  "Don't have an account?": {
    "zh-CN": "还没有账号？",
    en: "Don't have an account?",
  },
  Register: {
    "zh-CN": "注册",
    en: "Register",
  },
  "Create Account": {
    "zh-CN": "创建账号",
    en: "Create Account",
  },
  "Join dBrain to build your knowledge graph": {
    "zh-CN": "加入 dBrain，构建你的知识图谱",
    en: "Join dBrain to build your knowledge graph",
  },
  Nickname: {
    "zh-CN": "昵称",
    en: "Nickname",
  },
  "Your display name": {
    "zh-CN": "你的显示名称",
    en: "Your display name",
  },
  "Min 8 characters": {
    "zh-CN": "至少 8 个字符",
    en: "Min 8 characters",
  },
  "Already have an account?": {
    "zh-CN": "已有账号？",
    en: "Already have an account?",
  },
  "Loading…": {
    "zh-CN": "加载中…",
    en: "Loading…",
  },
  "Sign out": {
    "zh-CN": "退出登录",
    en: "Sign out",
  },
  Agent: {
    "zh-CN": "智能助手",
    en: "Agent",
  },
  搜索: {
    "zh-CN": "搜索",
    en: "Search",
  },
  图谱: {
    "zh-CN": "图谱",
    en: "Graph",
  },
  仪表盘: {
    "zh-CN": "仪表盘",
    en: "Dashboard",
  },
  重试: {
    "zh-CN": "重试",
    en: "Retry",
  },
  "加载工作空间…": {
    "zh-CN": "加载工作空间…",
    en: "Loading workspace…",
  },
  批注画布: {
    "zh-CN": "批注画布",
    en: "Annotation canvas",
  },
  批注工具栏: {
    "zh-CN": "批注工具栏",
    en: "Annotation toolbar",
  },
  "拖动工具栏 · 方向键停靠 · Home 复位": {
    "zh-CN": "拖动工具栏 · 方向键停靠 · Home 复位",
    en: "Drag toolbar · Arrow keys to dock · Home to reset",
  },
  "指针（V）· 双击设置": {
    "zh-CN": "指针（V）· 双击设置",
    en: "Pointer (V) · Double-click for settings",
  },
  指针: {
    "zh-CN": "指针",
    en: "Pointer",
  },
  恢复视图: {
    "zh-CN": "恢复视图",
    en: "Reset view",
  },
  显示批注: {
    "zh-CN": "显示批注",
    en: "Show annotations",
  },
  隐藏批注: {
    "zh-CN": "隐藏批注",
    en: "Hide annotations",
  },
  画笔: {
    "zh-CN": "画笔",
    en: "Brush",
  },
  "橡皮（E）· 双击设置": {
    "zh-CN": "橡皮（E）· 双击设置",
    en: "Eraser (E) · Double-click for settings",
  },
  擦除方式: {
    "zh-CN": "擦除方式",
    en: "Eraser mode",
  },
  笔画擦除: {
    "zh-CN": "笔画擦除",
    en: "Erase strokes",
  },
  路径擦除: {
    "zh-CN": "路径擦除",
    en: "Erase along path",
  },
  颜色: {
    "zh-CN": "颜色",
    en: "Color",
  },
  笔刷大小: {
    "zh-CN": "笔刷大小",
    en: "Brush size",
  },
  "撤销（⌘ / Ctrl Z）": {
    "zh-CN": "撤销（⌘ / Ctrl Z）",
    en: "Undo (⌘ / Ctrl Z)",
  },
  "重做（⌘ / Ctrl ⇧ Z）": {
    "zh-CN": "重做（⌘ / Ctrl ⇧ Z）",
    en: "Redo (⌘ / Ctrl ⇧ Z)",
  },
  "显示批注（\\）": {
    "zh-CN": "显示批注（\\）",
    en: "Show annotations (\\)",
  },
  "隐藏批注（\\）": {
    "zh-CN": "隐藏批注（\\）",
    en: "Hide annotations (\\)",
  },
  更多批注操作: {
    "zh-CN": "更多批注操作",
    en: "More annotation actions",
  },
  手指书写: {
    "zh-CN": "手指书写",
    en: "Draw with touch",
  },
  "再次点击，清除全部": {
    "zh-CN": "再次点击，清除全部",
    en: "Click again to clear all",
  },
  清除全部批注: {
    "zh-CN": "清除全部批注",
    en: "Clear all annotations",
  },
  圆珠笔: {
    "zh-CN": "圆珠笔",
    en: "Ballpoint pen",
  },
  铅笔: {
    "zh-CN": "铅笔",
    en: "Pencil",
  },
  钢笔: {
    "zh-CN": "钢笔",
    en: "Fountain pen",
  },
  马克笔: {
    "zh-CN": "马克笔",
    en: "Marker",
  },
  荧光笔: {
    "zh-CN": "荧光笔",
    en: "Highlighter",
  },
  纯文本: {
    "zh-CN": "纯文本",
    en: "Plain text",
  },
  "Add Node": {
    "zh-CN": "添加节点",
    en: "Add Node",
  },
  节点组件库: {
    "zh-CN": "节点组件库",
    en: "Node widget library",
  },
  组件库: {
    "zh-CN": "组件库",
    en: "Widget library",
  },
  关闭组件库: {
    "zh-CN": "关闭组件库",
    en: "Close widget library",
  },
  "拖入页面或点击添加。组件与原节点保持同步。": {
    "zh-CN": "拖入页面或点击添加。组件与原节点保持同步。",
    en: "Drag onto the page or click to add. Widgets stay in sync with their nodes.",
  },
  搜索组件: {
    "zh-CN": "搜索组件",
    en: "Search widgets",
  },
  "搜索节点…": {
    "zh-CN": "搜索节点…",
    en: "Search nodes…",
  },
  未命名节点: {
    "zh-CN": "未命名节点",
    en: "Untitled node",
  },
  已添加: {
    "zh-CN": "已添加",
    en: "Added",
  },
  没有匹配的组件: {
    "zh-CN": "没有匹配的组件",
    en: "No matching widgets",
  },
  组件库为空: {
    "zh-CN": "组件库为空",
    en: "Widget library is empty",
  },
  Dashboard: {
    "zh-CN": "仪表盘",
    en: "Dashboard",
  },
  未同步: {
    "zh-CN": "未同步",
    en: "Not synced",
  },
  "正在同步…": {
    "zh-CN": "正在同步…",
    en: "Syncing…",
  },
  "保存中…": {
    "zh-CN": "保存中…",
    en: "Saving…",
  },
  已保存: {
    "zh-CN": "已保存",
    en: "Saved",
  },
  "Dashboard 标签栏": {
    "zh-CN": "Dashboard 标签栏",
    en: "Dashboard tabs",
  },
  "Dashboard 页面": {
    "zh-CN": "Dashboard 页面",
    en: "Dashboard pages",
  },
  重命名: {
    "zh-CN": "重命名",
    en: "Rename",
  },
  "删除 Dashboard": {
    "zh-CN": "删除 Dashboard",
    en: "Delete dashboard",
  },
  "新建 Dashboard": {
    "zh-CN": "新建 Dashboard",
    en: "New dashboard",
  },
  重新加载: {
    "zh-CN": "重新加载",
    en: "Reload",
  },
  "Dashboard 内容": {
    "zh-CN": "Dashboard 内容",
    en: "Dashboard content",
  },
  自动布局: {
    "zh-CN": "自动布局",
    en: "Auto layout",
  },
  添加组件: {
    "zh-CN": "添加组件",
    en: "Add widget",
  },
  "暂时无法加载 Dashboard，请重新加载。": {
    "zh-CN": "暂时无法加载 Dashboard，请重新加载。",
    en: "Unable to load the dashboard. Please reload.",
  },
  "加载 Dashboard…": {
    "zh-CN": "加载 Dashboard…",
    en: "Loading dashboard…",
  },
  请选择工作空间: {
    "zh-CN": "请选择工作空间",
    en: "Please select a workspace",
  },
  为你的工作创建一个页面: {
    "zh-CN": "为你的工作创建一个页面",
    en: "Create a page for your work",
  },
  "将笔记、任务和数据视图放在一起。每个页面，都可以有自己的用途。": {
    "zh-CN": "将笔记、任务和数据视图放在一起。每个页面，都可以有自己的用途。",
    en: "Bring notes, tasks, and data views together. Give each page its own purpose.",
  },
  新建页面: {
    "zh-CN": "新建页面",
    en: "New page",
  },
  重命名页面: {
    "zh-CN": "重命名页面",
    en: "Rename page",
  },
  删除页面: {
    "zh-CN": "删除页面",
    en: "Delete page",
  },
  "为这个工作页面取一个名称。": {
    "zh-CN": "为这个工作页面取一个名称。",
    en: "Give this workspace page a name.",
  },
  页面名称: {
    "zh-CN": "页面名称",
    en: "Page name",
  },
  "例如：项目进度": {
    "zh-CN": "例如：项目进度",
    en: "e.g., Project progress",
  },
  取消: {
    "zh-CN": "取消",
    en: "Cancel",
  },
  删除: {
    "zh-CN": "删除",
    en: "Delete",
  },
  保存: {
    "zh-CN": "保存",
    en: "Save",
  },
  "Dashboard 标题": {
    "zh-CN": "Dashboard 标题",
    en: "Dashboard title",
  },
  双击重命名: {
    "zh-CN": "双击重命名",
    en: "Double-click to rename",
  },
  从一个节点开始: {
    "zh-CN": "从一个节点开始",
    en: "Start with a node",
  },
  "把常用节点添加到这个页面，再按你的工作方式安排它们。": {
    "zh-CN": "把常用节点添加到这个页面，再按你的工作方式安排它们。",
    en: "Add your frequently used nodes, then arrange them to suit your workflow.",
  },
  节点已删除或不可用: {
    "zh-CN": "节点已删除或不可用",
    en: "Node deleted or unavailable",
  },
  打开节点: {
    "zh-CN": "打开节点",
    en: "Open node",
  },
  "原节点不可用，可以从页面移除此组件。": {
    "zh-CN": "原节点不可用，可以从页面移除此组件。",
    en: "The original node is unavailable. You can remove this widget from the page.",
  },
  "Create a new node and pick its type and semantic.": {
    "zh-CN": "创建节点，并选择数据类型和语义类型。",
    en: "Create a new node and pick its type and semantic.",
  },
  "Node Type": {
    "zh-CN": "节点类型",
    en: "Node Type",
  },
  Semantic: {
    "zh-CN": "语义类型",
    en: "Semantic",
  },
  Cancel: {
    "zh-CN": "取消",
    en: "Cancel",
  },
  Create: {
    "zh-CN": "创建",
    en: "Create",
  },
  "保存失败，请稍后重试": {
    "zh-CN": "保存失败，请稍后重试",
    en: "Save failed. Please try again later.",
  },
  编辑过滤: {
    "zh-CN": "编辑过滤",
    en: "Edit filter",
  },
  "这个 collection 显示「已勾选节点」与「命中筛选条件的节点」的并集； 两者都为空时显示全部节点。":
    {
      "zh-CN":
        "这个 collection 显示「已勾选节点」与「命中筛选条件的节点」的并集； 两者都为空时显示全部节点。",
      en: "This collection shows selected nodes and nodes matching the filter. When both are empty, it shows all nodes.",
    },
  筛选条件: {
    "zh-CN": "筛选条件",
    en: "Filter conditions",
  },
  节点选择: {
    "zh-CN": "节点选择",
    en: "Node selection",
  },
  已选: {
    "zh-CN": "已选",
    en: "Selected",
  },
  全选当前: {
    "zh-CN": "全选当前",
    en: "Select all shown",
  },
  清空: {
    "zh-CN": "清空",
    en: "Clear",
  },
  "搜索节点标题或语义类型…": {
    "zh-CN": "搜索节点标题或语义类型…",
    en: "Search node titles or semantic types…",
  },
  当前工作区还没有节点: {
    "zh-CN": "当前工作区还没有节点",
    en: "This workspace has no nodes yet",
  },
  没有匹配的节点: {
    "zh-CN": "没有匹配的节点",
    en: "No matching nodes",
  },
  "Agent mode coming soon": {
    "zh-CN": "智能助手即将推出",
    en: "Agent mode coming soon",
  },
  Search: {
    "zh-CN": "搜索",
    en: "Search",
  },
  全部: {
    "zh-CN": "全部",
    en: "All",
  },
  文本: {
    "zh-CN": "文本",
    en: "Text",
  },
  媒体: {
    "zh-CN": "媒体",
    en: "Media",
  },
  网站: {
    "zh-CN": "网站",
    en: "Website",
  },
  集合: {
    "zh-CN": "集合",
    en: "Collection",
  },
  数据: {
    "zh-CN": "数据",
    en: "Data",
  },
  命令: {
    "zh-CN": "命令",
    en: "Commands",
  },
  节点类型: {
    "zh-CN": "节点类型",
    en: "Node types",
  },
  边类型: {
    "zh-CN": "边类型",
    en: "Edge types",
  },
  节点: {
    "zh-CN": "节点",
    en: "Nodes",
  },
  "Search nodes, types...": {
    "zh-CN": "搜索节点、类型…",
    en: "Search nodes, types...",
  },
  筛选: {
    "zh-CN": "筛选",
    en: "Filter",
  },
  类型: {
    "zh-CN": "类型",
    en: "Type",
  },
  "No results": {
    "zh-CN": "没有结果",
    en: "No results",
  },
  Name: {
    "zh-CN": "名称",
    en: "Name",
  },
  "e.g., Concept, Person, Event": {
    "zh-CN": "例如：概念、人物、事件",
    en: "e.g., Concept, Person, Event",
  },
  Description: {
    "zh-CN": "描述",
    en: "Description",
  },
  "Optional description": {
    "zh-CN": "可选描述",
    en: "Optional description",
  },
  Color: {
    "zh-CN": "颜色",
    en: "Color",
  },
  "Icon (Lucide icon name)": {
    "zh-CN": "图标（Lucide 图标名称）",
    en: "Icon (Lucide icon name)",
  },
  "e.g., Lightbulb, User, Calendar": {
    "zh-CN": "例如：Lightbulb、User、Calendar",
    en: "e.g., Lightbulb, User, Calendar",
  },
  Delete: {
    "zh-CN": "删除",
    en: "Delete",
  },
  Hierarchy: {
    "zh-CN": "层次关系",
    en: "Hierarchy",
  },
  Flow: {
    "zh-CN": "流向关系",
    en: "Flow",
  },
  Association: {
    "zh-CN": "关联关系",
    en: "Association",
  },
  Interaction: {
    "zh-CN": "交互关系",
    en: "Interaction",
  },
  "e.g., Causes, Part Of, References": {
    "zh-CN": "例如：导致、属于、引用",
    en: "e.g., Causes, Part Of, References",
  },
  Category: {
    "zh-CN": "类别",
    en: "Category",
  },
  "Node Semantics": {
    "zh-CN": "节点语义类型",
    en: "Node Semantics",
  },
  Add: {
    "zh-CN": "添加",
    en: "Add",
  },
  "No node semantics yet.": {
    "zh-CN": "暂无节点语义类型",
    en: "No node semantics yet.",
  },
  Edit: {
    "zh-CN": "编辑",
    en: "Edit",
  },
  "Edge Semantics": {
    "zh-CN": "边语义类型",
    en: "Edge Semantics",
  },
  "No edge semantics yet.": {
    "zh-CN": "暂无边语义类型",
    en: "No edge semantics yet.",
  },
  请输入视图名称: {
    "zh-CN": "请输入视图名称",
    en: "Please enter a view name",
  },
  "创建失败，请稍后重试": {
    "zh-CN": "创建失败，请稍后重试",
    en: "Creation failed. Please try again later.",
  },
  编辑视图: {
    "zh-CN": "编辑视图",
    en: "Edit view",
  },
  创建新视图: {
    "zh-CN": "创建新视图",
    en: "Create view",
  },
  "修改视图名称与筛选配置，保存后立即生效。": {
    "zh-CN": "修改视图名称与筛选配置，保存后立即生效。",
    en: "Changes to the view name and filters take effect when saved.",
  },
  "视图按筛选配置决定显示哪些节点，可随时在侧边栏切换。": {
    "zh-CN": "视图按筛选配置决定显示哪些节点，可随时在侧边栏切换。",
    en: "Filters determine which nodes appear. Switch views in the sidebar at any time.",
  },
  名称: {
    "zh-CN": "名称",
    en: "Name",
  },
  "例如：待办事项": {
    "zh-CN": "例如：待办事项",
    en: "e.g., Tasks",
  },
  "视图显示「已勾选节点」与「命中筛选条件的节点」的并集；两者都为空时显示全部节点。":
    {
      "zh-CN":
        "视图显示「已勾选节点」与「命中筛选条件的节点」的并集；两者都为空时显示全部节点。",
      en: "The view shows selected nodes and nodes matching the filter. When both are empty, it shows all nodes.",
    },
  "创建中…": {
    "zh-CN": "创建中…",
    en: "Creating…",
  },
  创建: {
    "zh-CN": "创建",
    en: "Create",
  },
  请输入工作区名称: {
    "zh-CN": "请输入工作区名称",
    en: "Please enter a workspace name",
  },
  创建新工作区: {
    "zh-CN": "创建新工作区",
    en: "Create workspace",
  },
  "工作区用于隔离你的节点、视图与语义配置。": {
    "zh-CN": "工作区用于隔离你的节点、视图与语义配置。",
    en: "Workspaces keep your nodes, views, and semantic settings separate.",
  },
  "例如：我的知识库": {
    "zh-CN": "例如：我的知识库",
    en: "e.g., My knowledge base",
  },
  选择节点以预览: {
    "zh-CN": "选择节点以预览",
    en: "Select a node to preview",
  },
  主导航: {
    "zh-CN": "主导航",
    en: "Main navigation",
  },
  "Enter value...": {
    "zh-CN": "输入值…",
    en: "Enter value...",
  },
  "Add Rule": {
    "zh-CN": "添加条件",
    en: "Add Rule",
  },
  "Add Group": {
    "zh-CN": "添加条件组",
    en: "Add Group",
  },
  "Remove Group": {
    "zh-CN": "移除条件组",
    en: "Remove Group",
  },
  元数据: {
    "zh-CN": "元数据",
    en: "Metadata",
  },
  关联: {
    "zh-CN": "关联",
    en: "Relations",
  },
  未命名: {
    "zh-CN": "未命名",
    en: "Untitled",
  },
  选择语义标签: {
    "zh-CN": "选择语义标签",
    en: "Select semantic type",
  },
  标签: {
    "zh-CN": "标签",
    en: "Tags",
  },
  暂无标签: {
    "zh-CN": "暂无标签",
    en: "No tags yet",
  },
  添加标签: {
    "zh-CN": "添加标签",
    en: "Add tag",
  },
  摘要: {
    "zh-CN": "摘要",
    en: "Summary",
  },
  "输入摘要...": {
    "zh-CN": "输入摘要...",
    en: "Enter summary…",
  },
  内容链接: {
    "zh-CN": "内容链接",
    en: "Content URL",
  },
  "输入网站地址...": {
    "zh-CN": "输入网站地址...",
    en: "Enter website URL…",
  },
  "输入内容URL...": {
    "zh-CN": "输入内容URL...",
    en: "Enter content URL…",
  },
  网站图标: {
    "zh-CN": "网站图标",
    en: "Website icon",
  },
  "输入网站图标URL...": {
    "zh-CN": "输入网站图标URL...",
    en: "Enter website icon URL…",
  },
  集合类型: {
    "zh-CN": "集合类型",
    en: "Collection type",
  },
  选择集合类型: {
    "zh-CN": "选择集合类型",
    en: "Select collection type",
  },
  有序: {
    "zh-CN": "有序",
    en: "Ordered",
  },
  无序: {
    "zh-CN": "无序",
    en: "Unordered",
  },
  卡片: {
    "zh-CN": "卡片",
    en: "Card",
  },
  属性: {
    "zh-CN": "属性",
    en: "Properties",
  },
  数据类型: {
    "zh-CN": "数据类型",
    en: "Data type",
  },
  创建时间: {
    "zh-CN": "创建时间",
    en: "Created at",
  },
  未知: {
    "zh-CN": "未知",
    en: "Unknown",
  },
  更新时间: {
    "zh-CN": "更新时间",
    en: "Updated at",
  },
  暂无关联关系: {
    "zh-CN": "暂无关联关系",
    en: "No relations yet",
  },
  当前节点还没有连接到其他节点: {
    "zh-CN": "当前节点还没有连接到其他节点",
    en: "This node is not connected to other nodes yet",
  },
  退出全屏: {
    "zh-CN": "退出全屏",
    en: "Exit fullscreen",
  },
  进入全屏: {
    "zh-CN": "进入全屏",
    en: "Enter fullscreen",
  },
  更多选项: {
    "zh-CN": "更多选项",
    en: "More options",
  },
  操作: {
    "zh-CN": "操作",
    en: "Actions",
  },
  "从 Dashboard 备选移除": {
    "zh-CN": "从 Dashboard 备选移除",
    en: "Remove from dashboard library",
  },
  "添加到 Dashboard 备选": {
    "zh-CN": "添加到 Dashboard 备选",
    en: "Add to dashboard library",
  },
  复制节点: {
    "zh-CN": "复制节点",
    en: "Duplicate node",
  },
  导出节点: {
    "zh-CN": "导出节点",
    en: "Export node",
  },
  分享节点: {
    "zh-CN": "分享节点",
    en: "Share node",
  },
  在新窗口打开: {
    "zh-CN": "在新窗口打开",
    en: "Open in new window",
  },
  删除节点: {
    "zh-CN": "删除节点",
    en: "Delete node",
  },
  取消置顶: {
    "zh-CN": "取消置顶",
    en: "Unpin",
  },
  置顶节点: {
    "zh-CN": "置顶节点",
    en: "Pin node",
  },
  宽松: {
    "zh-CN": "宽松",
    en: "Spacious",
  },
  紧凑: {
    "zh-CN": "紧凑",
    en: "Compact",
  },
  标准: {
    "zh-CN": "标准",
    en: "Standard",
  },
  默认白: {
    "zh-CN": "默认白",
    en: "Default white",
  },
  浅灰: {
    "zh-CN": "浅灰",
    en: "Light gray",
  },
  深灰: {
    "zh-CN": "深灰",
    en: "Dark gray",
  },
  深蓝: {
    "zh-CN": "深蓝",
    en: "Dark blue",
  },
  黑色: {
    "zh-CN": "黑色",
    en: "Black",
  },
  网格: {
    "zh-CN": "网格",
    en: "Grid",
  },
  点阵: {
    "zh-CN": "点阵",
    en: "Dots",
  },
  力导向视图: {
    "zh-CN": "力导向视图",
    en: "Force view",
  },
  工作流视图: {
    "zh-CN": "工作流视图",
    en: "Flow view",
  },
  视图配置: {
    "zh-CN": "视图配置",
    en: "View settings",
  },
  背景颜色: {
    "zh-CN": "背景颜色",
    en: "Background color",
  },
  背景样式: {
    "zh-CN": "背景样式",
    en: "Background style",
  },
  与主题同步: {
    "zh-CN": "与主题同步",
    en: "Sync with theme",
  },
  网格颜色: {
    "zh-CN": "网格颜色",
    en: "Grid color",
  },
  网格样式: {
    "zh-CN": "网格样式",
    en: "Grid style",
  },
  节点密度: {
    "zh-CN": "节点密度",
    en: "Node density",
  },
  "仅「力导向」布局生效": {
    "zh-CN": "仅「力导向」布局生效",
    en: "Applies to force-directed layout only",
  },
  视图类型: {
    "zh-CN": "视图类型",
    en: "View type",
  },
  选择视图: {
    "zh-CN": "选择视图",
    en: "Select view",
  },
  视图列表: {
    "zh-CN": "视图列表",
    en: "Views",
  },
  暂无视图: {
    "zh-CN": "暂无视图",
    en: "No views yet",
  },
  打开搜索面板: {
    "zh-CN": "打开搜索面板",
    en: "Open search panel",
  },
  表情: {
    "zh-CN": "表情",
    en: "Emoji",
  },
  人物: {
    "zh-CN": "人物",
    en: "People",
  },
  动物: {
    "zh-CN": "动物",
    en: "Animals",
  },
  食物: {
    "zh-CN": "食物",
    en: "Food",
  },
  旅行: {
    "zh-CN": "旅行",
    en: "Travel",
  },
  活动: {
    "zh-CN": "活动",
    en: "Activities",
  },
  物品: {
    "zh-CN": "物品",
    en: "Objects",
  },
  符号: {
    "zh-CN": "符号",
    en: "Symbols",
  },
  图片加载失败: {
    "zh-CN": "图片加载失败",
    en: "Failed to load image",
  },
  图片: {
    "zh-CN": "图片",
    en: "Image",
  },
  缩小图片: {
    "zh-CN": "缩小图片",
    en: "Zoom out image",
  },
  放大图片: {
    "zh-CN": "放大图片",
    en: "Zoom in image",
  },
  适配: {
    "zh-CN": "适配",
    en: "Fit",
  },
  在当前播放位置加一条笔记: {
    "zh-CN": "在当前播放位置加一条笔记",
    en: "Add a note at the current playback position",
  },
  "在当前播放位置加一条笔记（⌘/Ctrl + Enter）": {
    "zh-CN": "在当前播放位置加一条笔记（⌘/Ctrl + Enter）",
    en: "Add a note at the current position (⌘/Ctrl + Enter)",
  },
  未命名笔记: {
    "zh-CN": "未命名笔记",
    en: "Untitled note",
  },
  您的浏览器不支持视频播放: {
    "zh-CN": "您的浏览器不支持视频播放",
    en: "Your browser does not support video playback",
  },
  字幕: {
    "zh-CN": "字幕",
    en: "Subtitles",
  },
  显示字幕: {
    "zh-CN": "显示字幕",
    en: "Show subtitles",
  },
  隐藏字幕: {
    "zh-CN": "隐藏字幕",
    en: "Hide subtitles",
  },
  展开侧栏: {
    "zh-CN": "展开侧栏",
    en: "Expand sidebar",
  },
  笔记: {
    "zh-CN": "笔记",
    en: "Notes",
  },
  "AI 总结": {
    "zh-CN": "AI 总结",
    en: "AI summary",
  },
  "写点什么…": {
    "zh-CN": "写点什么…",
    en: "Write something…",
  },
  定位到: {
    "zh-CN": "定位到",
    en: "Jump to",
  },
  在当前时间加一条笔记: {
    "zh-CN": "在当前时间加一条笔记",
    en: "Add a note at the current time",
  },
  "在当前时间加一条笔记（⌘/Ctrl + Enter）": {
    "zh-CN": "在当前时间加一条笔记（⌘/Ctrl + Enter）",
    en: "Add a note at the current time (⌘/Ctrl + Enter)",
  },
  加笔记: {
    "zh-CN": "加笔记",
    en: "Add note",
  },
  已删除: {
    "zh-CN": "已删除",
    en: "Deleted",
  },
  的笔记: {
    "zh-CN": "的笔记",
    en: " note",
  },
  撤销: {
    "zh-CN": "撤销",
    en: "Undo",
  },
  无笔记: {
    "zh-CN": "无笔记",
    en: "No notes",
  },
  节点已删除: {
    "zh-CN": "节点已删除",
    en: "Node deleted",
  },
  取消引用: {
    "zh-CN": "取消引用",
    en: "Unlink",
  },
  标题: {
    "zh-CN": "标题",
    en: "Title",
  },
  笔记标题: {
    "zh-CN": "笔记标题",
    en: "Note title",
  },
  更多操作: {
    "zh-CN": "更多操作",
    en: "More actions",
  },
  转化为节点: {
    "zh-CN": "转化为节点",
    en: "Convert to node",
  },
  空白字幕: {
    "zh-CN": "空白字幕",
    en: "Empty subtitle",
  },
  "（空白字幕）": {
    "zh-CN": "（空白字幕）",
    en: "(Empty subtitle)",
  },
  "转写能力尚未接入，暂时无法生成字幕。": {
    "zh-CN": "转写能力尚未接入，暂时无法生成字幕。",
    en: "Transcription is not available yet. Subtitles cannot be generated.",
  },
  无字幕: {
    "zh-CN": "无字幕",
    en: "No subtitles",
  },
  生成字幕: {
    "zh-CN": "生成字幕",
    en: "Generate subtitles",
  },
  滚动到当前播放位置并恢复跟随: {
    "zh-CN": "滚动到当前播放位置并恢复跟随",
    en: "Scroll to the current position and resume following playback",
  },
  当前位置: {
    "zh-CN": "当前位置",
    en: "Current position",
  },
  "Add Edge": {
    "zh-CN": "添加连边",
    en: "Add Edge",
  },
  请选择类型: {
    "zh-CN": "请选择类型",
    en: "Please select a type",
  },
  "Toggle to ← from arrow": {
    "zh-CN": "切换目标到来源的箭头",
    en: "Toggle to ← from arrow",
  },
  "Toggle from → to arrow": {
    "zh-CN": "切换来源到目标的箭头",
    en: "Toggle from → to arrow",
  },
  item: {
    "zh-CN": "项",
    en: "item",
  },
  "Connect To": {
    "zh-CN": "连接到",
    en: "Connect To",
  },
  "当前浏览器不支持读取剪贴板，请改用「本地上传」": {
    "zh-CN": "当前浏览器不支持读取剪贴板，请改用「本地上传」",
    en: "Your browser cannot read the clipboard. Use local upload instead.",
  },
  剪贴板中没有图片: {
    "zh-CN": "剪贴板中没有图片",
    en: "No image in the clipboard",
  },
  "粘贴图片失败（剪贴板权限被拒绝？）": {
    "zh-CN": "粘贴图片失败（剪贴板权限被拒绝？）",
    en: "Failed to paste image. Check clipboard permissions.",
  },
  本地上传: {
    "zh-CN": "本地上传",
    en: "Local upload",
  },
  从当前设备选择文件: {
    "zh-CN": "从当前设备选择文件",
    en: "Choose a file from this device",
  },
  编辑器: {
    "zh-CN": "编辑器",
    en: "Editor",
  },
  "直接在编辑器中编写 HTML 或代码": {
    "zh-CN": "直接在编辑器中编写 HTML 或代码",
    en: "Write HTML or code directly in the editor",
  },
  文件上传: {
    "zh-CN": "文件上传",
    en: "Upload file",
  },
  导入文件失败: {
    "zh-CN": "导入文件失败",
    en: "Failed to import file",
  },
  "导入本地 HTML 或代码文件": {
    "zh-CN": "导入本地 HTML 或代码文件",
    en: "Import a local HTML or code file",
  },
  网页: {
    "zh-CN": "网页",
    en: "Web page",
  },
  还没有源码: {
    "zh-CN": "还没有源码",
    en: "No source code yet",
  },
  重新初始化: {
    "zh-CN": "重新初始化",
    en: "Re-initialize",
  },
  载入资源库中的网页源码: {
    "zh-CN": "载入资源库中的网页源码",
    en: "Load webpage source from the library",
  },
  无法读取资源内容: {
    "zh-CN": "无法读取资源内容",
    en: "Could not read the resource content",
  },
  引用已上传的资源: {
    "zh-CN": "引用已上传的资源",
    en: "Reference a file already in the library",
  },
  使用剪贴板中的图片: {
    "zh-CN": "使用剪贴板中的图片",
    en: "Use an image from the clipboard",
  },
  松开即可上传: {
    "zh-CN": "松开即可上传",
    en: "Release to upload",
  },
  粘贴图片: {
    "zh-CN": "粘贴图片",
    en: "Paste image",
  },
  未保存: {
    "zh-CN": "未保存",
    en: "Unsaved",
  },
  返回: {
    "zh-CN": "返回",
    en: "Back",
  },
  写入节点失败: {
    "zh-CN": "写入节点失败",
    en: "Could not write the node",
  },
  "正在加载网页…": {
    "zh-CN": "正在加载网页…",
    en: "Loading the web page…",
  },
  加载网页失败: {
    "zh-CN": "加载网页失败",
    en: "Could not load the web page",
  },
  无法保存网页: {
    "zh-CN": "无法保存网页",
    en: "Could not save the web page",
  },
  "网页文件超过 {value1}MB，无法导入": {
    "zh-CN": "网页文件超过 {value1}MB，无法导入",
    en: "The web page file is larger than {value1}MB and cannot be imported",
  },
  "导入本地 HTML 文件": {
    "zh-CN": "导入本地 HTML 文件",
    en: "Import a local HTML file",
  },
  引用资源库中的网页: {
    "zh-CN": "引用资源库中的网页",
    en: "Reference a web page from the library",
  },
  确认: {
    "zh-CN": "确认",
    en: "Confirm",
  },
  "音频加载失败，可能是网络或文件本身的问题。": {
    "zh-CN": "音频加载失败，可能是网络或文件本身的问题。",
    en: "Failed to load audio. Check your connection or the file.",
  },
  下载原文件: {
    "zh-CN": "下载原文件",
    en: "Download original file",
  },
  音频: {
    "zh-CN": "音频",
    en: "Audio",
  },
  视频: {
    "zh-CN": "视频",
    en: "Video",
  },
  "HTML / 代码文件": {
    "zh-CN": "HTML / 代码文件",
    en: "HTML / code file",
  },
  图标: {
    "zh-CN": "图标",
    en: "Icon",
  },
  封面: {
    "zh-CN": "封面",
    en: "Cover",
  },
  点击添加: {
    "zh-CN": "点击添加",
    en: "Click to add",
  },
  未知原因: {
    "zh-CN": "未知原因",
    en: "Unknown reason",
  },
  "正在转码为 HLS…": {
    "zh-CN": "正在转码为 HLS…",
    en: "Transcoding to HLS…",
  },
  // Video-site import (issue #73): the drop-zone card, its URL dialog, and the
  // failures the download / transcode round trip can report.
  从视频网站添加: {
    "zh-CN": "从视频网站添加",
    en: "Add from video site",
  },
  "粘贴 YouTube、Bilibili 等视频链接": {
    "zh-CN": "粘贴 YouTube、Bilibili 等视频链接",
    en: "Paste a YouTube, Bilibili, or other video page link",
  },
  "粘贴视频页面链接，服务器会下载并转码后保存到资源库。": {
    "zh-CN": "粘贴视频页面链接，服务器会下载并转码后保存到资源库。",
    en: "Paste the video page link; the server downloads and transcodes it into the resource library.",
  },
  视频页面链接: {
    "zh-CN": "视频页面链接",
    en: "Video page link",
  },
  粘贴视频页面地址: {
    "zh-CN": "粘贴视频页面地址",
    en: "Paste the video page address",
  },
  请输入视频链接: {
    "zh-CN": "请输入视频链接",
    en: "Enter a video link",
  },
  "请输入以 http:// 或 https:// 开头的视频链接": {
    "zh-CN": "请输入以 http:// 或 https:// 开头的视频链接",
    en: "Enter a video link that starts with http:// or https://",
  },
  // Video-site import progress (shown in the drop zone while the server works).
  // The dialog closes on submit, so these are the only "in progress" labels.
  "正在准备导入…": {
    "zh-CN": "正在准备导入…",
    en: "Preparing the import…",
  },
  "正在下载视频…": {
    "zh-CN": "正在下载视频…",
    en: "Downloading the video…",
  },
  "正在保存到资源库…": {
    "zh-CN": "正在保存到资源库…",
    en: "Saving to the resource library…",
  },
  导入: {
    "zh-CN": "导入",
    en: "Import",
  },
  导入完成: {
    "zh-CN": "导入完成",
    en: "Import finished",
  },
  视频导入失败: {
    "zh-CN": "视频导入失败",
    en: "Video import failed",
  },
  "无法读取工作区信息，请重试": {
    "zh-CN": "无法读取工作区信息，请重试",
    en: "Could not read the workspace. Try again.",
  },
  // Shared media import (video + audio): progress, site capsules, the login
  // sheet, the parse card, and the URL dialog. Both kinds use this copy; only
  // the phase wording and the quality label differ.
  "正在下载音频…": {
    "zh-CN": "正在下载音频…",
    en: "Downloading the audio…",
  },
  导入已中断: {
    "zh-CN": "导入已中断",
    en: "Import interrupted",
  },
  "可以继续上次的下载，已完成的部分不会丢失。": {
    "zh-CN": "可以继续上次的下载，已完成的部分不会丢失。",
    en: "You can continue the download. The part already saved is not lost.",
  },
  取消导入: {
    "zh-CN": "取消导入",
    en: "Cancel import",
  },
  继续: {
    "zh-CN": "继续",
    en: "Continue",
  },
  "下载速度 {value1}": {
    "zh-CN": "下载速度 {value1}",
    en: "Download speed {value1}",
  },
  "剩余时间 {value1}": {
    "zh-CN": "剩余时间 {value1}",
    en: "{value1} remaining",
  },
  已登录: {
    "zh-CN": "已登录",
    en: "Signed in",
  },
  登录已失效: {
    "zh-CN": "登录已失效",
    en: "Sign-in expired",
  },
  未登录: {
    "zh-CN": "未登录",
    en: "Not signed in",
  },
  重新验证: {
    "zh-CN": "重新验证",
    en: "Check sign-in",
  },
  更换登录: {
    "zh-CN": "更换登录",
    en: "Replace sign-in",
  },
  退出登录: {
    "zh-CN": "退出登录",
    en: "Sign out",
  },
  "Cookie 文件不能超过 1 MiB": {
    "zh-CN": "Cookie 文件不能超过 1 MiB",
    en: "The cookie file must not be larger than 1 MiB",
  },
  站点登录: {
    "zh-CN": "站点登录",
    en: "Site sign-in",
  },
  // Site names and login hints arrive from the server catalog with Chinese
  // copy; `t` maps the exact string, so an English interface shows English.
  "B 站": {
    "zh-CN": "B 站",
    en: "Bilibili",
  },
  抖音: {
    "zh-CN": "抖音",
    en: "Douyin",
  },
  小红书: {
    "zh-CN": "小红书",
    en: "Xiaohongshu",
  },
  YouTube: {
    "zh-CN": "YouTube",
    en: "YouTube",
  },
  TikTok: {
    "zh-CN": "TikTok",
    en: "TikTok",
  },
  网易云音乐: {
    "zh-CN": "网易云音乐",
    en: "NetEase Cloud Music",
  },
  "QQ 音乐": {
    "zh-CN": "QQ 音乐",
    en: "QQ Music",
  },
  喜马拉雅: {
    "zh-CN": "喜马拉雅",
    en: "Ximalaya",
  },
  "登录后才能下载高清视频、大会员视频和获取字幕。": {
    "zh-CN": "登录后才能下载高清视频、大会员视频和获取字幕。",
    en: "A sign-in is needed for HD and premium videos and for subtitles.",
  },
  "多数视频需要登录后才能下载。": {
    "zh-CN": "多数视频需要登录后才能下载。",
    en: "Most videos need a sign-in before they can be downloaded.",
  },
  "多数笔记视频需要登录后才能下载。": {
    "zh-CN": "多数笔记视频需要登录后才能下载。",
    en: "Most note videos need a sign-in before they can be downloaded.",
  },
  "高清、会员和年龄限制视频需要登录。": {
    "zh-CN": "高清、会员和年龄限制视频需要登录。",
    en: "HD, premium, and age-restricted videos need a sign-in.",
  },
  "登录后可解锁较高、极高和无损音质。": {
    "zh-CN": "登录后可解锁较高、极高和无损音质。",
    en: "A sign-in unlocks the higher, very high, and lossless audio tiers.",
  },
  "QQ 音乐需要登录后才能解析和下载。": {
    "zh-CN": "QQ 音乐需要登录后才能解析和下载。",
    en: "QQ Music needs a sign-in to read and download a track.",
  },
  "部分节目需要登录后才能下载。": {
    "zh-CN": "部分节目需要登录后才能下载。",
    en: "Some episodes need a sign-in before they can be downloaded.",
  },
  // Quality tier labels also arrive from the server; the numeric video labels
  // (1080p, …) fall through unchanged.
  最佳: {
    "zh-CN": "最佳",
    en: "Best",
  },
  无损: {
    "zh-CN": "无损",
    en: "Lossless",
  },
  极高: {
    "zh-CN": "极高",
    en: "Very high",
  },
  较高: {
    "zh-CN": "较高",
    en: "High",
  },
  "登录后可以导入需要账号的内容。登录信息只保存在你的服务器上，不会返回浏览器。":
    {
      "zh-CN":
        "登录后可以导入需要账号的内容。登录信息只保存在你的服务器上，不会返回浏览器。",
      en: "Sign in to import content that needs an account. The sign-in stays on your server and is never sent back to the browser.",
    },
  使用本机浏览器: {
    "zh-CN": "使用本机浏览器",
    en: "Use a browser on this machine",
  },
  "读取你已登录的浏览器，不会上传账号密码。": {
    "zh-CN": "读取你已登录的浏览器，不会上传账号密码。",
    en: "Reads the browser you are already signed in to. Your account and password are not uploaded.",
  },
  "正在验证登录…": {
    "zh-CN": "正在验证登录…",
    en: "Checking sign-in…",
  },
  "使用 Cookie 文件": {
    "zh-CN": "使用 Cookie 文件",
    en: "Use a cookie file",
  },
  "在浏览器登录站点后，用扩展导出 Netscape 格式的 cookies.txt，再拖到这里。只保留支持站点的 Cookie。":
    {
      "zh-CN":
        "在浏览器登录站点后，用扩展导出 Netscape 格式的 cookies.txt，再拖到这里。只保留支持站点的 Cookie。",
      en: "Sign in to the site in a browser, export a Netscape cookies.txt with an extension, then drop it here. Only cookies of supported sites are kept.",
    },
  "安装导出 cookies.txt 的 Chrome 扩展": {
    "zh-CN": "安装导出 cookies.txt 的 Chrome 扩展",
    en: "Install the Chrome extension that exports cookies.txt",
  },
  "正在读取…": {
    "zh-CN": "正在读取…",
    en: "Reading…",
  },
  "把 cookies.txt 拖到这里，或点击选择文件。": {
    "zh-CN": "把 cookies.txt 拖到这里，或点击选择文件。",
    en: "Drop cookies.txt here, or click to choose a file.",
  },
  "选择 cookies.txt": {
    "zh-CN": "选择 cookies.txt",
    en: "Choose cookies.txt",
  },
  "最大 1 MiB。": {
    "zh-CN": "最大 1 MiB。",
    en: "Up to 1 MiB.",
  },
  "已连接 {value1} 个站点": {
    "zh-CN": "已连接 {value1} 个站点",
    en: "Connected {value1} sites",
  },
  "以下站点验证失败：{value1}": {
    "zh-CN": "以下站点验证失败：{value1}",
    en: "Could not verify these sites: {value1}",
  },
  "已忽略 {value1} 个不在支持列表中的域名": {
    "zh-CN": "已忽略 {value1} 个不在支持列表中的域名",
    en: "Ignored {value1} domains that are not supported",
  },
  将同时导入歌词: {
    "zh-CN": "将同时导入歌词",
    en: "Lyrics are imported too",
  },
  将同时导入字幕: {
    "zh-CN": "将同时导入字幕",
    en: "Subtitles are imported too",
  },
  "未检测到字幕；部分站点需登录后才能获取字幕。": {
    "zh-CN": "未检测到字幕；部分站点需登录后才能获取字幕。",
    en: "No subtitles found; some sites show them only after a sign-in.",
  },
  "未检测到歌词；部分站点需登录后才能获取歌词。": {
    "zh-CN": "未检测到歌词；部分站点需登录后才能获取歌词。",
    en: "No lyrics found; some sites show them only after a sign-in.",
  },
  登录后可解锁: {
    "zh-CN": "登录后可解锁",
    en: "Sign in to unlock",
  },
  超出存储上限: {
    "zh-CN": "超出存储上限",
    en: "Over the storage limit",
  },
  不可用: {
    "zh-CN": "不可用",
    en: "Unavailable",
  },
  未命名媒体: {
    "zh-CN": "未命名媒体",
    en: "Untitled media",
  },
  音质: {
    "zh-CN": "音质",
    en: "Audio quality",
  },
  清晰度: {
    "zh-CN": "清晰度",
    en: "Video quality",
  },
  "预计大小 {value1}": {
    "zh-CN": "预计大小 {value1}",
    en: "About {value1}",
  },
  "登录后可解锁更高音质。": {
    "zh-CN": "登录后可解锁更高音质。",
    en: "Sign in to unlock higher audio quality.",
  },
  "登录后可解锁更多清晰度。": {
    "zh-CN": "登录后可解锁更多清晰度。",
    en: "Sign in to unlock more video qualities.",
  },
  登录: {
    "zh-CN": "登录",
    en: "Sign in",
  },
  "专辑或播放列表链接只导入第一首。": {
    "zh-CN": "专辑或播放列表链接只导入第一首。",
    en: "A link to an album or playlist imports only the first track.",
  },
  请输入链接: {
    "zh-CN": "请输入链接",
    en: "Enter a link",
  },
  "请输入以 http:// 或 https:// 开头的链接": {
    "zh-CN": "请输入以 http:// 或 https:// 开头的链接",
    en: "Enter a link that starts with http:// or https://",
  },
  从音乐网站添加: {
    "zh-CN": "从音乐网站添加",
    en: "Add from music site",
  },
  "粘贴音乐页面链接，服务器会下载并保存到资源库。": {
    "zh-CN": "粘贴音乐页面链接，服务器会下载并保存到资源库。",
    en: "Paste the music page link; the server downloads it into the resource library.",
  },
  音乐页面链接: {
    "zh-CN": "音乐页面链接",
    en: "Music page link",
  },
  粘贴音乐页面地址: {
    "zh-CN": "粘贴音乐页面地址",
    en: "Paste the music page address",
  },
  "正在解析…": {
    "zh-CN": "正在解析…",
    en: "Reading the link…",
  },
  解析: {
    "zh-CN": "解析",
    en: "Read link",
  },
  "{value1} 需要登录后才能解析。": {
    "zh-CN": "{value1} 需要登录后才能解析。",
    en: "{value1} needs a sign-in before it can be read.",
  },
  登录后解析: {
    "zh-CN": "登录后解析",
    en: "Sign in, then read the link",
  },
  "粘贴网易云音乐、QQ 音乐等链接": {
    "zh-CN": "粘贴网易云音乐、QQ 音乐等链接",
    en: "Paste a NetEase Cloud Music, QQ Music, or other music link",
  },
  "识别到 {value1}": {
    "zh-CN": "识别到 {value1}",
    en: "Detected {value1}",
  },
  "站点列表加载失败，请重试。": {
    "zh-CN": "站点列表加载失败，请重试。",
    en: "The site list could not be loaded. Try again.",
  },
  文件内容为空: {
    "zh-CN": "文件内容为空",
    en: "The file is empty",
  },
  读取文件失败: {
    "zh-CN": "读取文件失败",
    en: "Failed to read file",
  },
  正在读取: {
    "zh-CN": "正在读取",
    en: "Reading",
  },
  点击导入: {
    "zh-CN": "点击导入",
    en: "Click to import",
  },
  "上传或选择 .html 与代码文件，内容会载入源码编辑器": {
    "zh-CN": "上传或选择 .html 与代码文件，内容会载入源码编辑器",
    en: "Upload or choose an HTML or code file; its content loads into the source editor",
  },
  "Unsupported node type:": {
    "zh-CN": "不支持的节点类型：",
    en: "Unsupported node type:",
  },
  未命名页面: {
    "zh-CN": "未命名页面",
    en: "Untitled page",
  },
  节点标题: {
    "zh-CN": "节点标题",
    en: "Node title",
  },
  "添加摘要…": {
    "zh-CN": "添加摘要…",
    en: "Add summary…",
  },
  节点摘要: {
    "zh-CN": "节点摘要",
    en: "Node summary",
  },
  切换语义: {
    "zh-CN": "切换语义",
    en: "Change semantic type",
  },
  选择语义: {
    "zh-CN": "选择语义",
    en: "Select semantic type",
  },
  PDF文档: {
    "zh-CN": "PDF文档",
    en: "PDF document",
  },
  更换节点图标: {
    "zh-CN": "更换节点图标",
    en: "Change node icon",
  },
  设置节点图标: {
    "zh-CN": "设置节点图标",
    en: "Set node icon",
  },
  添加封面: {
    "zh-CN": "添加封面",
    en: "Add cover",
  },
  更换节点封面: {
    "zh-CN": "更换节点封面",
    en: "Change node cover",
  },
  "开始写作...": {
    "zh-CN": "开始写作...",
    en: "Start writing…",
  },
  "写下这句话…": {
    "zh-CN": "写下这句话…",
    en: "Write a sentence…",
  },
  "当前浏览器无法解码该视频的编码，只有音轨可以播放。": {
    "zh-CN": "当前浏览器无法解码该视频的编码，只有音轨可以播放。",
    en: "Your browser cannot decode this video. Only the audio track can play.",
  },
  "视频加载失败，可能是网络或文件本身的问题。": {
    "zh-CN": "视频加载失败，可能是网络或文件本身的问题。",
    en: "Failed to load video. Check your connection or the file.",
  },
  预览: {
    "zh-CN": "预览",
    en: "Preview",
  },
  编辑: {
    "zh-CN": "编辑",
    en: "Edit",
  },
  语言: {
    "zh-CN": "语言",
    en: "Language",
  },
  "在此编写 HTML 或代码…": {
    "zh-CN": "在此编写 HTML 或代码…",
    en: "Write HTML or code here…",
  },
  "HTML 预览": {
    "zh-CN": "HTML 预览",
    en: "HTML preview",
  },
  打开: {
    "zh-CN": "打开",
    en: "Open",
  },
  网站预览: {
    "zh-CN": "网站预览",
    en: "Website preview",
  },
  输入网址后在此嵌入预览: {
    "zh-CN": "输入网址后在此嵌入预览",
    en: "Enter a URL to embed a preview here",
  },
  "部分站点禁止被嵌入，预览空白时可点「打开」在新标签页查看。": {
    "zh-CN": "部分站点禁止被嵌入，预览空白时可点「打开」在新标签页查看。",
    en: "Some sites block embedding. If the preview is blank, click Open to view it in a new tab.",
  },
  恢复位置大小: {
    "zh-CN": "恢复位置大小",
    en: "Reset position and size",
  },
  缩略图: {
    "zh-CN": "缩略图",
    en: "Thumbnails",
  },
  大纲: {
    "zh-CN": "大纲",
    en: "Outline",
  },
  收起侧栏: {
    "zh-CN": "收起侧栏",
    en: "Collapse sidebar",
  },
  "这个 PDF 没有大纲": {
    "zh-CN": "这个 PDF 没有大纲",
    en: "This PDF has no outline",
  },
  适配宽度: {
    "zh-CN": "适配宽度",
    en: "Fit width",
  },
  适配页面: {
    "zh-CN": "适配页面",
    en: "Fit page",
  },
  上一页: {
    "zh-CN": "上一页",
    en: "Previous page",
  },
  页码: {
    "zh-CN": "页码",
    en: "Page number",
  },
  下一页: {
    "zh-CN": "下一页",
    en: "Next page",
  },
  缩小: {
    "zh-CN": "缩小",
    en: "Zoom out",
  },
  放大: {
    "zh-CN": "放大",
    en: "Zoom in",
  },
  垂直: {
    "zh-CN": "垂直",
    en: "Vertical",
  },
  水平: {
    "zh-CN": "水平",
    en: "Horizontal",
  },
  连续滚动: {
    "zh-CN": "连续滚动",
    en: "Continuous scroll",
  },
  翻页: {
    "zh-CN": "翻页",
    en: "Paged",
  },
  单页: {
    "zh-CN": "单页",
    en: "Single page",
  },
  双页: {
    "zh-CN": "双页",
    en: "Two pages",
  },
  在文档中查找: {
    "zh-CN": "在文档中查找",
    en: "Find in document",
  },
  上一个匹配: {
    "zh-CN": "上一个匹配",
    en: "Previous match",
  },
  下一个匹配: {
    "zh-CN": "下一个匹配",
    en: "Next match",
  },
  查找选项: {
    "zh-CN": "查找选项",
    en: "Find options",
  },
  区分大小写: {
    "zh-CN": "区分大小写",
    en: "Match case",
  },
  全字匹配: {
    "zh-CN": "全字匹配",
    en: "Whole words",
  },
  关闭查找: {
    "zh-CN": "关闭查找",
    en: "Close find",
  },
  查找: {
    "zh-CN": "查找",
    en: "Find",
  },
  下载: {
    "zh-CN": "下载",
    en: "Download",
  },
  在新标签页打开: {
    "zh-CN": "在新标签页打开",
    en: "Open in new tab",
  },
  更多: {
    "zh-CN": "更多",
    en: "More",
  },
  方向: {
    "zh-CN": "方向",
    en: "Direction",
  },
  滚动: {
    "zh-CN": "滚动",
    en: "Scroll",
  },
  双页显示: {
    "zh-CN": "双页显示",
    en: "Two-page view",
  },
  "正在加载 PDF": {
    "zh-CN": "正在加载 PDF",
    en: "Loading PDF",
  },
  "PDF 加载失败。": {
    "zh-CN": "PDF 加载失败。",
    en: "Failed to load PDF.",
  },
  "已停止自绘渲染，宿主可以回退到浏览器内置预览。": {
    "zh-CN": "已停止自绘渲染，宿主可以回退到浏览器内置预览。",
    en: "Custom rendering stopped. The app can use the browser PDF preview.",
  },
  "PDF 文档": {
    "zh-CN": "PDF 文档",
    en: "PDF document",
  },
  "PDF 解析线程启动失败": {
    "zh-CN": "PDF 解析线程启动失败",
    en: "Failed to start PDF worker",
  },
  "这个 PDF 有打开密码，无法直接预览。": {
    "zh-CN": "这个 PDF 有打开密码，无法直接预览。",
    en: "This PDF requires a password and cannot be previewed directly.",
  },
  "文件不是有效的 PDF，或已经损坏。": {
    "zh-CN": "文件不是有效的 PDF，或已经损坏。",
    en: "This file is not a valid PDF or is damaged.",
  },
  "读取 PDF 失败：地址无效，或跨源请求被拒绝。": {
    "zh-CN": "读取 PDF 失败：地址无效，或跨源请求被拒绝。",
    en: "Failed to read PDF: invalid URL or cross-origin request denied.",
  },
  "PDF 解析线程没能启动，已切换到兼容预览。": {
    "zh-CN": "PDF 解析线程没能启动，已切换到兼容预览。",
    en: "PDF worker failed to start. Switched to compatible preview.",
  },
  "PDF 解析线程没有响应": {
    "zh-CN": "PDF 解析线程没有响应",
    en: "PDF worker is not responding",
  },
  "PDF 解析线程加载失败": {
    "zh-CN": "PDF 解析线程加载失败",
    en: "Failed to load PDF worker",
  },
  节点已不存在: {
    "zh-CN": "节点已不存在",
    en: "Node no longer exists",
  },
  收起: {
    "zh-CN": "收起",
    en: "Collapse",
  },
  关闭预览: {
    "zh-CN": "关闭预览",
    en: "Close preview",
  },
  暂无音频: {
    "zh-CN": "暂无音频",
    en: "No audio",
  },
  时长: {
    "zh-CN": "时长",
    en: "Duration",
  },
  个已选节点: {
    "zh-CN": "个已选节点",
    en: " selected nodes",
  },
  按条件筛选: {
    "zh-CN": "按条件筛选",
    en: "Filtered by conditions",
  },
  "条记录 · 暂无字段": {
    "zh-CN": "条记录 · 暂无字段",
    en: " records · No fields",
  },
  "No records yet": {
    "zh-CN": "暂无记录",
    en: "No records yet",
  },
  "fields ·": {
    "zh-CN": "个字段 ·",
    en: "fields ·",
  },
  records: {
    "zh-CN": "条记录",
    en: "records",
  },
  "PDF Document": {
    "zh-CN": "PDF 文档",
    en: "PDF Document",
  },
  pages: {
    "zh-CN": "页",
    en: "pages",
  },
  暂无内容: {
    "zh-CN": "暂无内容",
    en: "No content",
  },
  "referenced nodes": {
    "zh-CN": "个引用节点",
    en: "referenced nodes",
  },
  暂无网址: {
    "zh-CN": "暂无网址",
    en: "No URL",
  },
  上传: {
    "zh-CN": "上传",
    en: "Upload",
  },
  从节点选: {
    "zh-CN": "从节点选",
    en: "Select from nodes",
  },
  更换封面: {
    "zh-CN": "更换封面",
    en: "Change cover",
  },
  移除封面: {
    "zh-CN": "移除封面",
    en: "Remove cover",
  },
  移除: {
    "zh-CN": "移除",
    en: "Remove",
  },
  "Or add via URL": {
    "zh-CN": "或通过 URL 添加",
    en: "Or add via URL",
  },
  "Click to filter…": {
    "zh-CN": "点击筛选…",
    en: "Click to filter…",
  },
  没有可选节点: {
    "zh-CN": "没有可选节点",
    en: "No nodes available",
  },
  "Search semantic...": {
    "zh-CN": "搜索语义类型…",
    en: "Search semantic...",
  },
  "No semantics found": {
    "zh-CN": "没有匹配的语义类型",
    en: "No semantics found",
  },
  "Add new type": {
    "zh-CN": "添加类型",
    en: "Add new type",
  },
  Emoji: {
    "zh-CN": "表情",
    en: "Emoji",
  },
  更换图标: {
    "zh-CN": "更换图标",
    en: "Change icon",
  },
  设置图标: {
    "zh-CN": "设置图标",
    en: "Set icon",
  },
  底色: {
    "zh-CN": "底色",
    en: "Background color",
  },
  无底色: {
    "zh-CN": "无底色",
    en: "No background",
  },
  移除图标: {
    "zh-CN": "移除图标",
    en: "Remove icon",
  },
  没有匹配的结果: {
    "zh-CN": "没有匹配的结果",
    en: "No matching results",
  },
  Text: {
    "zh-CN": "文本",
    en: "Text",
  },
  "Search nodes...": {
    "zh-CN": "搜索节点…",
    en: "Search nodes...",
  },
  "No nodes found": {
    "zh-CN": "没有匹配的节点",
    en: "No nodes found",
  },
  "搜索或创建标签...": {
    "zh-CN": "搜索或创建标签...",
    en: "Search or create tags…",
  },
  '按 Enter 创建 "': {
    "zh-CN": '按 Enter 创建 "',
    en: 'Press Enter to create "',
  },
  无匹配标签: {
    "zh-CN": "无匹配标签",
    en: "No matching tags",
  },
  可用标签: {
    "zh-CN": "可用标签",
    en: "Available tags",
  },
  '创建 "': {
    "zh-CN": '创建 "',
    en: 'Create "',
  },
  添加: {
    "zh-CN": "添加",
    en: "Add",
  },
  "No workspaces": {
    "zh-CN": "暂无工作区",
    en: "No workspaces",
  },
  "Create new workspace": {
    "zh-CN": "创建工作区",
    en: "Create new workspace",
  },
  视图: {
    "zh-CN": "视图",
    en: "Views",
  },
  切换到浅色模式: {
    "zh-CN": "切换到浅色模式",
    en: "Switch to light mode",
  },
  切换到深色模式: {
    "zh-CN": "切换到深色模式",
    en: "Switch to dark mode",
  },
  "No views yet": {
    "zh-CN": "暂无视图",
    en: "No views yet",
  },
  置顶: {
    "zh-CN": "置顶",
    en: "Pinned",
  },
  最近打开: {
    "zh-CN": "最近打开",
    en: "Recently opened",
  },
  "No recent nodes": {
    "zh-CN": "暂无最近打开的节点",
    en: "No recent nodes",
  },
  "No node types": {
    "zh-CN": "暂无节点类型",
    en: "No node types",
  },
  层次关系: {
    "zh-CN": "层次关系",
    en: "Hierarchy",
  },
  流向关系: {
    "zh-CN": "流向关系",
    en: "Flow",
  },
  关联关系: {
    "zh-CN": "关联关系",
    en: "Association",
  },
  交互关系: {
    "zh-CN": "交互关系",
    en: "Interaction",
  },
  Close: {
    "zh-CN": "关闭",
    en: "Close",
  },
  Sidebar: {
    "zh-CN": "侧边栏",
    en: "Sidebar",
  },
  "Displays the mobile sidebar.": {
    "zh-CN": "显示移动端侧边栏。",
    en: "Displays the mobile sidebar.",
  },
  "Toggle Sidebar": {
    "zh-CN": "切换侧边栏",
    en: "Toggle Sidebar",
  },
  没有可用的数据视图: {
    "zh-CN": "没有可用的数据视图",
    en: "No data views available",
  },
  "该节点的视图列表为空。": {
    "zh-CN": "该节点的视图列表为空。",
    en: "This node has no views.",
  },
  表格: {
    "zh-CN": "表格",
    en: "Table",
  },
  看板: {
    "zh-CN": "看板",
    en: "Kanban",
  },
  日历: {
    "zh-CN": "日历",
    en: "Calendar",
  },
  甘特图: {
    "zh-CN": "甘特图",
    en: "Gantt",
  },
  画廊: {
    "zh-CN": "画廊",
    en: "Gallery",
  },
  图表: {
    "zh-CN": "图表",
    en: "Chart",
  },
  节点图: {
    "zh-CN": "节点图",
    en: "Node graph",
  },
  卡片配置: {
    "zh-CN": "卡片配置",
    en: "Card settings",
  },
  选择字段: {
    "zh-CN": "选择字段",
    en: "Select field",
  },
  "集合的每一行就是一个节点，卡片直接用它自己的预览作封面。": {
    "zh-CN": "集合的每一行就是一个节点，卡片直接用它自己的预览作封面。",
    en: "Each collection row is a node. Cards use the node preview as their cover.",
  },
  "需要一个「链接」字段（指向图片），或用「关联」字段指向图片／视频节点。": {
    "zh-CN":
      "需要一个「链接」字段（指向图片），或用「关联」字段指向图片／视频节点。",
    en: "Use a Link field with an image URL, or a Relation field pointing to an image or video node.",
  },
  无封面: {
    "zh-CN": "无封面",
    en: "No cover",
  },
  使用节点预览: {
    "zh-CN": "使用节点预览",
    en: "Use node preview",
  },
  展示模式: {
    "zh-CN": "展示模式",
    en: "Display mode",
  },
  常规: {
    "zh-CN": "常规",
    en: "Normal",
  },
  卡片字段: {
    "zh-CN": "卡片字段",
    en: "Card fields",
  },
  选项顺序: {
    "zh-CN": "选项顺序",
    en: "Option order",
  },
  选项倒序: {
    "zh-CN": "选项倒序",
    en: "Reverse option order",
  },
  最早优先: {
    "zh-CN": "最早优先",
    en: "Earliest first",
  },
  最晚优先: {
    "zh-CN": "最晚优先",
    en: "Latest first",
  },
  未勾选优先: {
    "zh-CN": "未勾选优先",
    en: "Unchecked first",
  },
  已勾选优先: {
    "zh-CN": "已勾选优先",
    en: "Checked first",
  },
  排序方向: {
    "zh-CN": "排序方向",
    en: "Sort direction",
  },
  清除: {
    "zh-CN": "清除",
    en: "Clear",
  },
  删除条件: {
    "zh-CN": "删除条件",
    en: "Delete condition",
  },
  "先添加字段，才能设置条件。": {
    "zh-CN": "先添加字段，才能设置条件。",
    en: "Add fields before setting conditions.",
  },
  添加条件: {
    "zh-CN": "添加条件",
    en: "Add condition",
  },
  配置项尚未实现: {
    "zh-CN": "配置项尚未实现",
    en: "Settings are not available yet",
  },
  "当前视图只读，配置不可编辑。": {
    "zh-CN": "当前视图只读，配置不可编辑。",
    en: "This view is read-only. Settings cannot be edited.",
  },
  "该视图类型的配置项将在实现渲染器时一并落地。": {
    "zh-CN": "该视图类型的配置项将在实现渲染器时一并落地。",
    en: "Settings for this view will be available when its renderer is implemented.",
  },
  配置数据: {
    "zh-CN": "配置数据",
    en: "Configuration data",
  },
  "行 ·": {
    "zh-CN": "行 ·",
    en: "rows ·",
  },
  字段: {
    "zh-CN": "字段",
    en: "Fields",
  },
  只读: {
    "zh-CN": "只读",
    en: "Read-only",
  },
  占位未实现: {
    "zh-CN": "占位未实现",
    en: "Not implemented yet",
  },
  数据源: {
    "zh-CN": "数据源",
    en: "Data source",
  },
  "当前视图配置（只读预览）": {
    "zh-CN": "当前视图配置（只读预览）",
    en: "Current view settings (read-only preview)",
  },
  选择日期: {
    "zh-CN": "选择日期",
    en: "Select date",
  },
  清除日期: {
    "zh-CN": "清除日期",
    en: "Clear date",
  },
  搜索字段: {
    "zh-CN": "搜索字段",
    en: "Search fields",
  },
  新增字段: {
    "zh-CN": "新增字段",
    en: "Add field",
  },
  编辑字段: {
    "zh-CN": "编辑字段",
    en: "Edit field",
  },
  删除字段: {
    "zh-CN": "删除字段",
    en: "Delete field",
  },
  "删除「": {
    "zh-CN": "删除「",
    en: "Delete “",
  },
  "」？该字段的数据一并清除。": {
    "zh-CN": "」？该字段的数据一并清除。",
    en: "”? Data in this field will also be deleted.",
  },
  "没有匹配的字段。": {
    "zh-CN": "没有匹配的字段。",
    en: "No matching fields.",
  },
  "这张表还没有字段。": {
    "zh-CN": "这张表还没有字段。",
    en: "This table has no fields yet.",
  },
  字段名称: {
    "zh-CN": "字段名称",
    en: "Field name",
  },
  "已有同名字段，仍可继续。": {
    "zh-CN": "已有同名字段，仍可继续。",
    en: "A field with this name already exists. You can still continue.",
  },
  字段类型: {
    "zh-CN": "字段类型",
    en: "Field type",
  },
  "改变类型会清空该列现有数据。": {
    "zh-CN": "改变类型会清空该列现有数据。",
    en: "Changing the type clears existing data in this column.",
  },
  选项内容: {
    "zh-CN": "选项内容",
    en: "Options",
  },
  添加选项: {
    "zh-CN": "添加选项",
    en: "Add option",
  },
  "至少填一个选项名称才能保存。": {
    "zh-CN": "至少填一个选项名称才能保存。",
    en: "Enter at least one option name before saving.",
  },
  选项名称: {
    "zh-CN": "选项名称",
    en: "Option name",
  },
  默认值: {
    "zh-CN": "默认值",
    en: "Default value",
  },
  先添加选项: {
    "zh-CN": "先添加选项",
    en: "Add options first",
  },
  请选择选项: {
    "zh-CN": "请选择选项",
    en: "Please select an option",
  },
  不设置: {
    "zh-CN": "不设置",
    en: "None",
  },
  留空表示不设置: {
    "zh-CN": "留空表示不设置",
    en: "Leave empty for no default",
  },
  确定: {
    "zh-CN": "确定",
    en: "Confirm",
  },
  数字: {
    "zh-CN": "数字",
    en: "Number",
  },
  单选: {
    "zh-CN": "单选",
    en: "Single select",
  },
  多选: {
    "zh-CN": "多选",
    en: "Multi-select",
  },
  日期: {
    "zh-CN": "日期",
    en: "Date",
  },
  勾选: {
    "zh-CN": "勾选",
    en: "Checkbox",
  },
  链接: {
    "zh-CN": "链接",
    en: "Link",
  },
  没有匹配的字段: {
    "zh-CN": "没有匹配的字段",
    en: "No matching fields",
  },
  选择选项: {
    "zh-CN": "选择选项",
    en: "Select option",
  },
  查找或创建选项: {
    "zh-CN": "查找或创建选项",
    en: "Find or create an option",
  },
  没有匹配的选项: {
    "zh-CN": "没有匹配的选项",
    en: "No matching options",
  },
  "创建「": {
    "zh-CN": "创建「",
    en: "Create “",
  },
  未命名记录: {
    "zh-CN": "未命名记录",
    en: "Untitled record",
  },
  记录详情与字段编辑: {
    "zh-CN": "记录详情与字段编辑",
    en: "Record details and field editing",
  },
  数据库记录: {
    "zh-CN": "数据库记录",
    en: "Database record",
  },
  图谱节点: {
    "zh-CN": "图谱节点",
    en: "Graph node",
  },
  复制记录: {
    "zh-CN": "复制记录",
    en: "Duplicate record",
  },
  删除记录: {
    "zh-CN": "删除记录",
    en: "Delete record",
  },
  关闭记录页: {
    "zh-CN": "关闭记录页",
    en: "Close record page",
  },
  个隐藏字段: {
    "zh-CN": "个隐藏字段",
    en: " hidden fields",
  },
  "设置字段的名称、类型、选项与默认值": {
    "zh-CN": "设置字段的名称、类型、选项与默认值",
    en: "Set field name, type, options, and default value",
  },
  打开记录: {
    "zh-CN": "打开记录",
    en: "Open record",
  },
  私有: {
    "zh-CN": "私有",
    en: "Private",
  },
  公开: {
    "zh-CN": "公开",
    en: "Public",
  },
  受限: {
    "zh-CN": "受限",
    en: "Restricted",
  },
  语义类型: {
    "zh-CN": "语义类型",
    en: "Semantic type",
  },
  权限: {
    "zh-CN": "权限",
    en: "Permissions",
  },
  权重: {
    "zh-CN": "权重",
    en: "Weight",
  },
  设为默认视图: {
    "zh-CN": "设为默认视图",
    en: "Set as default view",
  },
  复制视图: {
    "zh-CN": "复制视图",
    en: "Duplicate view",
  },
  删除视图: {
    "zh-CN": "删除视图",
    en: "Delete view",
  },
  视图名称: {
    "zh-CN": "视图名称",
    en: "View name",
  },
  新建视图: {
    "zh-CN": "新建视图",
    en: "New view",
  },
  这张表还没有字段: {
    "zh-CN": "这张表还没有字段",
    en: "This table has no fields yet",
  },
  "先在表格视图中添加字段，再回来按日期把记录铺到日历上。": {
    "zh-CN": "先在表格视图中添加字段，再回来按日期把记录铺到日历上。",
    en: "Add fields in the table view, then return to place records on the calendar by date.",
  },
  还没有选择开始日期: {
    "zh-CN": "还没有选择开始日期",
    en: "No start date selected",
  },
  "日历需要一个「日期」字段": {
    "zh-CN": "日历需要一个「日期」字段",
    en: "The calendar needs a Date field",
  },
  "在上方工具条的「字段」里选择事件的开始日期，记录就会落到对应的日子。": {
    "zh-CN":
      "在上方工具条的「字段」里选择事件的开始日期，记录就会落到对应的日子。",
    en: "Choose the event start date in Fields on the toolbar to place records on their dates.",
  },
  "日历把行按某个日期字段铺开。先用表格视图添加一个「日期」字段（例如「截止日」），再回到日历选择它。":
    {
      "zh-CN":
        "日历把行按某个日期字段铺开。先用表格视图添加一个「日期」字段（例如「截止日」），再回到日历选择它。",
      en: "The calendar places rows by a date field. Add a Date field, such as Due date, in the table view, then select it here.",
    },
  列表: {
    "zh-CN": "列表",
    en: "List",
  },
  多月: {
    "zh-CN": "多月",
    en: "Multiple months",
  },
  周一: {
    "zh-CN": "周一",
    en: "Monday",
  },
  周日: {
    "zh-CN": "周日",
    en: "Sunday",
  },
  周六: {
    "zh-CN": "周六",
    en: "Saturday",
  },
  开始: {
    "zh-CN": "开始",
    en: "Start",
  },
  结束: {
    "zh-CN": "结束",
    en: "End",
  },
  字段配置: {
    "zh-CN": "字段配置",
    en: "Field settings",
  },
  开始日期: {
    "zh-CN": "开始日期",
    en: "Start date",
  },
  "这张表还没有「日期」字段，日历无法定位事件。": {
    "zh-CN": "这张表还没有「日期」字段，日历无法定位事件。",
    en: "This table has no Date field. The calendar cannot place events.",
  },
  结束日期: {
    "zh-CN": "结束日期",
    en: "End date",
  },
  不使用: {
    "zh-CN": "不使用",
    en: "None",
  },
  "需要一个「单选」或「多选」字段，按它的选项颜色着色。": {
    "zh-CN": "需要一个「单选」或「多选」字段，按它的选项颜色着色。",
    en: "Use a Single select or Multi-select field to color items by option.",
  },
  不按字段着色: {
    "zh-CN": "不按字段着色",
    en: "No field coloring",
  },
  打开视图: {
    "zh-CN": "打开视图",
    en: "Open view",
  },
  工具栏按钮: {
    "zh-CN": "工具栏按钮",
    en: "Toolbar buttons",
  },
  一周起始: {
    "zh-CN": "一周起始",
    en: "Week starts on",
  },
  "先在表格视图中添加字段，再回来把它们的分布画成图表。": {
    "zh-CN": "先在表格视图中添加字段，再回来把它们的分布画成图表。",
    en: "Add fields in the table view, then return to chart their distribution.",
  },
  还没有记录: {
    "zh-CN": "还没有记录",
    en: "No records yet",
  },
  "图表按行统计；先添加几条记录，图形就有了数据。": {
    "zh-CN": "图表按行统计；先添加几条记录，图形就有了数据。",
    en: "Charts summarize rows. Add records to see your data.",
  },
  "散点图需要两个「数字」字段": {
    "zh-CN": "散点图需要两个「数字」字段",
    en: "Scatter charts need two Number fields",
  },
  "还没有选择 X / Y 度量": {
    "zh-CN": "还没有选择 X / Y 度量",
    en: "No X / Y measures selected",
  },
  "散点图把两条数字列画成平面上的点。先用表格视图添加第二个「数字」字段。": {
    "zh-CN":
      "散点图把两条数字列画成平面上的点。先用表格视图添加第二个「数字」字段。",
    en: "Scatter charts plot two number columns as points. Add a second Number field in the table view.",
  },
  "在上方工具条的「字段配置」里选择 X 轴与 Y 轴度量。": {
    "zh-CN": "在上方工具条的「字段配置」里选择 X 轴与 Y 轴度量。",
    en: "Select X and Y measures in Field settings on the toolbar.",
  },
  桑基图需要两个字段表示流向: {
    "zh-CN": "桑基图需要两个字段表示流向",
    en: "Sankey charts need two fields for flow",
  },
  "在「字段配置」里选择 来源 与 目标，记录就会连成带权重的流带。": {
    "zh-CN": "在「字段配置」里选择 来源 与 目标，记录就会连成带权重的流带。",
    en: "Select Source and Target in Field settings to connect records as weighted flows.",
  },
  矩形树图需要一个层级字段: {
    "zh-CN": "矩形树图需要一个层级字段",
    en: "Treemaps need a hierarchy field",
  },
  "在「字段配置」的「层级」里选择至少一个字段。": {
    "zh-CN": "在「字段配置」的「层级」里选择至少一个字段。",
    en: "Select at least one field in Hierarchy under Field settings.",
  },
  热力图需要两个维度: {
    "zh-CN": "热力图需要两个维度",
    en: "Heatmaps need two dimensions",
  },
  "在「字段配置」里选择横轴与纵轴维度，颜色会表示度量的大小。": {
    "zh-CN": "在「字段配置」里选择横轴与纵轴维度，颜色会表示度量的大小。",
    en: "Select horizontal and vertical dimensions in Field settings. Color represents the measure.",
  },
  "图表需要一个「维度」字段": {
    "zh-CN": "图表需要一个「维度」字段",
    en: "Charts need a Dimension field",
  },
  "维度决定图表怎么分组（分类轴、扇区或词条）。先用表格视图添加一个文本或单选字段。":
    {
      "zh-CN":
        "维度决定图表怎么分组（分类轴、扇区或词条）。先用表格视图添加一个文本或单选字段。",
      en: "Dimensions group chart data into categories, slices, or terms. Add a Text or Single select field in the table view.",
    },
  区间图需要两个度量: {
    "zh-CN": "区间图需要两个度量",
    en: "Range charts need two measures",
  },
  "区间的上下界各来自一个「数字」字段。在「字段配置」的「度量」里再加一个。": {
    "zh-CN":
      "区间的上下界各来自一个「数字」字段。在「字段配置」的「度量」里再加一个。",
    en: "Range bounds each use a Number field. Add another measure in Field settings.",
  },
  比较: {
    "zh-CN": "比较",
    en: "Comparison",
  },
  趋势: {
    "zh-CN": "趋势",
    en: "Trend",
  },
  占比: {
    "zh-CN": "占比",
    en: "Proportion",
  },
  分布: {
    "zh-CN": "分布",
    en: "Distribution",
  },
  仪表: {
    "zh-CN": "仪表",
    en: "Gauge",
  },
  关系: {
    "zh-CN": "关系",
    en: "Relationship",
  },
  柱状图: {
    "zh-CN": "柱状图",
    en: "Column chart",
  },
  条形图: {
    "zh-CN": "条形图",
    en: "Bar chart",
  },
  区间柱状图: {
    "zh-CN": "区间柱状图",
    en: "Range column chart",
  },
  折线图: {
    "zh-CN": "折线图",
    en: "Line chart",
  },
  面积图: {
    "zh-CN": "面积图",
    en: "Area chart",
  },
  堆叠面积图: {
    "zh-CN": "堆叠面积图",
    en: "Stacked area chart",
  },
  区间面积图: {
    "zh-CN": "区间面积图",
    en: "Range area chart",
  },
  饼图: {
    "zh-CN": "饼图",
    en: "Pie chart",
  },
  环形图: {
    "zh-CN": "环形图",
    en: "Donut chart",
  },
  玫瑰图: {
    "zh-CN": "玫瑰图",
    en: "Rose chart",
  },
  漏斗图: {
    "zh-CN": "漏斗图",
    en: "Funnel chart",
  },
  词云: {
    "zh-CN": "词云",
    en: "Word cloud",
  },
  矩形树图: {
    "zh-CN": "矩形树图",
    en: "Treemap",
  },
  旭日图: {
    "zh-CN": "旭日图",
    en: "Sunburst chart",
  },
  圆填充图: {
    "zh-CN": "圆填充图",
    en: "Circle packing",
  },
  散点图: {
    "zh-CN": "散点图",
    en: "Scatter chart",
  },
  热力图: {
    "zh-CN": "热力图",
    en: "Heatmap",
  },
  雷达图: {
    "zh-CN": "雷达图",
    en: "Radar chart",
  },
  水波图: {
    "zh-CN": "水波图",
    en: "Liquid chart",
  },
  环形进度: {
    "zh-CN": "环形进度",
    en: "Circular progress",
  },
  线性进度: {
    "zh-CN": "线性进度",
    en: "Linear progress",
  },
  桑基图: {
    "zh-CN": "桑基图",
    en: "Sankey chart",
  },
  计数: {
    "zh-CN": "计数",
    en: "Count",
  },
  默认: {
    "zh-CN": "默认",
    en: "Default",
  },
  明亮: {
    "zh-CN": "明亮",
    en: "Bright",
  },
  柔和: {
    "zh-CN": "柔和",
    en: "Soft",
  },
  冷色: {
    "zh-CN": "冷色",
    en: "Cool",
  },
  暖色: {
    "zh-CN": "暖色",
    en: "Warm",
  },
  大地: {
    "zh-CN": "大地",
    en: "Earth",
  },
  求和: {
    "zh-CN": "求和",
    en: "Sum",
  },
  平均: {
    "zh-CN": "平均",
    en: "Average",
  },
  最小: {
    "zh-CN": "最小",
    en: "Minimum",
  },
  最大: {
    "zh-CN": "最大",
    en: "Maximum",
  },
  不响应: {
    "zh-CN": "不响应",
    en: "None",
  },
  下钻筛选: {
    "zh-CN": "下钻筛选",
    en: "Drill-down filter",
  },
  跟随: {
    "zh-CN": "跟随",
    en: "Follow",
  },
  浅色: {
    "zh-CN": "浅色",
    en: "Light",
  },
  深色: {
    "zh-CN": "深色",
    en: "Dark",
  },
  维度: {
    "zh-CN": "维度",
    en: "Dimension",
  },
  系列: {
    "zh-CN": "系列",
    en: "Series",
  },
  指标: {
    "zh-CN": "指标",
    en: "Metric",
  },
  数值: {
    "zh-CN": "数值",
    en: "Value",
  },
  "（空）": {
    "zh-CN": "（空）",
    en: "(Empty)",
  },
  进度: {
    "zh-CN": "进度",
    en: "Progress",
  },
  第二维度: {
    "zh-CN": "第二维度",
    en: "Second dimension",
  },
  来源: {
    "zh-CN": "来源",
    en: "Source",
  },
  目标: {
    "zh-CN": "目标",
    en: "Target",
  },
  不写标题: {
    "zh-CN": "不写标题",
    en: "No title",
  },
  图表标题: {
    "zh-CN": "图表标题",
    en: "Chart title",
  },
  导出图片: {
    "zh-CN": "导出图片",
    en: "Export image",
  },
  清除下钻: {
    "zh-CN": "清除下钻",
    en: "Clear drill-down",
  },
  图表类型: {
    "zh-CN": "图表类型",
    en: "Chart type",
  },
  横轴维度: {
    "zh-CN": "横轴维度",
    en: "Horizontal dimension",
  },
  "这张表还没有可作维度的字段。": {
    "zh-CN": "这张表还没有可作维度的字段。",
    en: "This table has no fields that can serve as dimensions.",
  },
  纵轴维度: {
    "zh-CN": "纵轴维度",
    en: "Vertical dimension",
  },
  "热力图需要两个维度：横轴、纵轴，颜色表示度量。": {
    "zh-CN": "热力图需要两个维度：横轴、纵轴，颜色表示度量。",
    en: "Heatmaps need horizontal and vertical dimensions. Color represents the measure.",
  },
  "选了系列字段后只画第一个度量。": {
    "zh-CN": "选了系列字段后只画第一个度量。",
    en: "Selecting a series field displays only the first measure.",
  },
  不拆分系列: {
    "zh-CN": "不拆分系列",
    en: "No series split",
  },
  "X 轴度量": {
    "zh-CN": "X 轴度量",
    en: "X-axis measure",
  },
  "散点图需要两个「数字」字段。": {
    "zh-CN": "散点图需要两个「数字」字段。",
    en: "Scatter charts need two Number fields.",
  },
  "Y 轴度量": {
    "zh-CN": "Y 轴度量",
    en: "Y-axis measure",
  },
  "桑基图需要两个字段表示流向。": {
    "zh-CN": "桑基图需要两个字段表示流向。",
    en: "Sankey charts need two fields for flow.",
  },
  层级: {
    "zh-CN": "层级",
    en: "Hierarchy",
  },
  "最多三层。": {
    "zh-CN": "最多三层。",
    en: "Up to three levels.",
  },
  添加层级: {
    "zh-CN": "添加层级",
    en: "Add level",
  },
  度量: {
    "zh-CN": "度量",
    en: "Measures",
  },
  "这张表还没有「数字」字段，先按记录数统计。": {
    "zh-CN": "这张表还没有「数字」字段，先按记录数统计。",
    en: "This table has no Number field. Records will be counted for now.",
  },
  "区间图用两个度量作为区间的上下界。": {
    "zh-CN": "区间图用两个度量作为区间的上下界。",
    en: "Range charts use two measures as lower and upper bounds.",
  },
  添加度量: {
    "zh-CN": "添加度量",
    en: "Add measure",
  },
  排序: {
    "zh-CN": "排序",
    en: "Sort",
  },
  排序字段: {
    "zh-CN": "排序字段",
    en: "Sort field",
  },
  不排序: {
    "zh-CN": "不排序",
    en: "No sorting",
  },
  降序: {
    "zh-CN": "降序",
    en: "Descending",
  },
  升序: {
    "zh-CN": "升序",
    en: "Ascending",
  },
  "前 N 条": {
    "zh-CN": "前 N 条",
    en: "Top N",
  },
  点击行为: {
    "zh-CN": "点击行为",
    en: "Click action",
  },
  图例: {
    "zh-CN": "图例",
    en: "Legend",
  },
  数据标签: {
    "zh-CN": "数据标签",
    en: "Data labels",
  },
  悬浮提示: {
    "zh-CN": "悬浮提示",
    en: "Tooltip",
  },
  主题: {
    "zh-CN": "主题",
    en: "Theme",
  },
  色板: {
    "zh-CN": "色板",
    en: "Palette",
  },
  取消选择: {
    "zh-CN": "取消选择",
    en: "Deselect",
  },
  选择: {
    "zh-CN": "选择",
    en: "Select",
  },
  瀑布流: {
    "zh-CN": "瀑布流",
    en: "Masonry",
  },
  "先在表格视图中添加字段（例如「标题」和「封面」），再回到画廊把它们排成卡片墙。":
    {
      "zh-CN":
        "先在表格视图中添加字段（例如「标题」和「封面」），再回到画廊把它们排成卡片墙。",
      en: "Add fields, such as Title and Cover, in the table view, then return to display them as cards.",
    },
  "点下方按钮新增一条记录，新卡片会立刻出现在这里。": {
    "zh-CN": "点下方按钮新增一条记录，新卡片会立刻出现在这里。",
    en: "Click below to add a record. Its card will appear here immediately.",
  },
  "在表格视图中新增记录，它们会立刻出现在这里。": {
    "zh-CN": "在表格视图中新增记录，它们会立刻出现在这里。",
    en: "Add records in the table view. They will appear here immediately.",
  },
  添加记录: {
    "zh-CN": "添加记录",
    en: "Add record",
  },
  布局: {
    "zh-CN": "布局",
    en: "Layout",
  },
  排列方式: {
    "zh-CN": "排列方式",
    en: "Arrangement",
  },
  卡片尺寸: {
    "zh-CN": "卡片尺寸",
    en: "Card size",
  },
  今天: {
    "zh-CN": "今天",
    en: "Today",
  },
  个任务: {
    "zh-CN": "个任务",
    en: " tasks",
  },
  任务: {
    "zh-CN": "任务",
    en: "Tasks",
  },
  未分组: {
    "zh-CN": "未分组",
    en: "Ungrouped",
  },
  "先在表格视图中添加字段，再回来按起止日期把记录铺到时间轴上。": {
    "zh-CN": "先在表格视图中添加字段，再回来按起止日期把记录铺到时间轴上。",
    en: "Add fields in the table view, then return to place records on the timeline by start and end dates.",
  },
  "甘特图需要一个「日期」字段": {
    "zh-CN": "甘特图需要一个「日期」字段",
    en: "Gantt charts need a Date field",
  },
  "甘特图把每行画成一条起止日期之间的任务条。先用表格视图添加一个「日期」字段（例如「开始日」），再回到甘特图选择它。":
    {
      "zh-CN":
        "甘特图把每行画成一条起止日期之间的任务条。先用表格视图添加一个「日期」字段（例如「开始日」），再回到甘特图选择它。",
      en: "Gantt charts display rows as task bars between start and end dates. Add a Date field, such as Start date, in the table view, then select it here.",
    },
  "在上方工具条的「字段配置」里选择任务的开始日期，记录就会落到时间轴上。": {
    "zh-CN":
      "在上方工具条的「字段配置」里选择任务的开始日期，记录就会落到时间轴上。",
    en: "Select the task start date in Field settings on the toolbar to place records on the timeline.",
  },
  还没有带日期的记录: {
    "zh-CN": "还没有带日期的记录",
    en: "No records with dates yet",
  },
  "在开始日期字段里填上日期，任务就会画在时间轴上；结束日期留空的任务按单日显示。":
    {
      "zh-CN":
        "在开始日期字段里填上日期，任务就会画在时间轴上；结束日期留空的任务按单日显示。",
      en: "Enter start dates to show tasks on the timeline. Tasks without end dates appear as single days.",
    },
  "在开始日期字段里填上日期，任务就会画在时间轴上。": {
    "zh-CN": "在开始日期字段里填上日期，任务就会画在时间轴上。",
    en: "Enter start dates to show tasks on the timeline.",
  },
  表头名称: {
    "zh-CN": "表头名称",
    en: "Column header",
  },
  分组: {
    "zh-CN": "分组",
    en: "Group",
  },
  "这张表还没有「日期」字段，甘特图无法定位任务。": {
    "zh-CN": "这张表还没有「日期」字段，甘特图无法定位任务。",
    en: "This table has no Date field. The Gantt chart cannot place tasks.",
  },
  单日: {
    "zh-CN": "单日",
    en: "Single day",
  },
  "需要一个「数字」字段（取值 0–1），条形才会填充进度。": {
    "zh-CN": "需要一个「数字」字段（取值 0–1），条形才会填充进度。",
    en: "Use a Number field with values from 0 to 1 to show progress in task bars.",
  },
  不显示进度: {
    "zh-CN": "不显示进度",
    en: "Hide progress",
  },
  "需要一个「单选」或「多选」字段，才能按它分组。": {
    "zh-CN": "需要一个「单选」或「多选」字段，才能按它分组。",
    en: "Use a Single select or Multi-select field to group items.",
  },
  不分组: {
    "zh-CN": "不分组",
    en: "No grouping",
  },
  表头: {
    "zh-CN": "表头",
    en: "Header",
  },
  时间粒度: {
    "zh-CN": "时间粒度",
    en: "Time scale",
  },
  行高: {
    "zh-CN": "行高",
    en: "Row height",
  },
  今日线: {
    "zh-CN": "今日线",
    en: "Today marker",
  },
  周末: {
    "zh-CN": "周末",
    en: "Weekends",
  },
  "只有「日」粒度的时间轴有周末列。": {
    "zh-CN": "只有「日」粒度的时间轴有周末列。",
    en: "Weekend columns appear only on the daily timeline.",
  },
  力导向: {
    "zh-CN": "力导向",
    en: "Force-directed",
  },
  流程图: {
    "zh-CN": "流程图",
    en: "Flowchart",
  },
  "「流程图」布局在 @workspace/graph 里仍是占位壳，重建后即可切换。": {
    "zh-CN": "流程图布局尚未开放。",
    en: "The flowchart layout is not available yet.",
  },
  没有节点匹配当前的过滤条件: {
    "zh-CN": "没有节点匹配当前的过滤条件",
    en: "No nodes match the current filters",
  },
  "节点图画的是这个 collection 筛选出的子图，当前条件没有选中任何节点。": {
    "zh-CN":
      "节点图画的是这个 collection 筛选出的子图，当前条件没有选中任何节点。",
    en: "This graph shows the collection's filtered subgraph. No nodes match the current conditions.",
  },
  这个工作区还没有节点: {
    "zh-CN": "这个工作区还没有节点",
    en: "This workspace has no nodes yet",
  },
  "节点图画的是图谱里的节点与连边，先创建一些节点再回到这个视图。": {
    "zh-CN": "节点图画的是图谱里的节点与连边，先创建一些节点再回到这个视图。",
    en: "This view displays graph nodes and edges. Create some nodes, then return here.",
  },
  布局模式: {
    "zh-CN": "布局模式",
    en: "Layout mode",
  },
  背景: {
    "zh-CN": "背景",
    en: "Background",
  },
  折叠泳道: {
    "zh-CN": "折叠泳道",
    en: "Collapse lane",
  },
  拖动卡片到此泳道: {
    "zh-CN": "拖动卡片到此泳道",
    en: "Drag cards to this lane",
  },
  暂无卡片: {
    "zh-CN": "暂无卡片",
    en: "No cards yet",
  },
  移动到: {
    "zh-CN": "移动到",
    en: "Move to",
  },
  默认颜色: {
    "zh-CN": "默认颜色",
    en: "Default color",
  },
  "先在表格视图中添加字段，再回来按某个「单选」字段分列。": {
    "zh-CN": "先在表格视图中添加字段，再回来按某个「单选」字段分列。",
    en: "Add fields in the table view, then return to group cards by a Single select field.",
  },
  还没有选择分组字段: {
    "zh-CN": "还没有选择分组字段",
    en: "No grouping field selected",
  },
  看板需要一个单选或多选字段: {
    "zh-CN": "看板需要一个单选或多选字段",
    en: "Kanban needs a Single select or Multi-select field",
  },
  "在上方工具条的「分组」里选择用于分列的字段，卡片就会按它的选项落到各列。": {
    "zh-CN":
      "在上方工具条的「分组」里选择用于分列的字段，卡片就会按它的选项落到各列。",
    en: "Choose a field in Group on the toolbar. Cards will appear in columns by option.",
  },
  "看板把行按某个字段的选项分列。先用表格视图添加一个「单选」字段（例如「状态」），再回到看板选择它。":
    {
      "zh-CN":
        "看板把行按某个字段的选项分列。先用表格视图添加一个「单选」字段（例如「状态」），再回到看板选择它。",
      en: "Kanban groups rows into columns by field options. Add a Single select field, such as Status, in the table view, then select it here.",
    },
  分组字段: {
    "zh-CN": "分组字段",
    en: "Grouping field",
  },
  "这张表还没有「单选」或「多选」字段，看板无法分列。": {
    "zh-CN": "这张表还没有「单选」或「多选」字段，看板无法分列。",
    en: "This table has no Single select or Multi-select field. Kanban cannot create columns.",
  },
  显示未分组: {
    "zh-CN": "显示未分组",
    en: "Show ungrouped",
  },
  设置排序条件: {
    "zh-CN": "设置排序条件",
    en: "Set sort conditions",
  },
  包含: {
    "zh-CN": "包含",
    en: "Contains",
  },
  等于: {
    "zh-CN": "等于",
    en: "Equals",
  },
  为空: {
    "zh-CN": "为空",
    en: "Is empty",
  },
  不为空: {
    "zh-CN": "不为空",
    en: "Is not empty",
  },
  单元格: {
    "zh-CN": "单元格",
    en: "Cell",
  },
  填色: {
    "zh-CN": "填色",
    en: "Color",
  },
  设置填色条件: {
    "zh-CN": "设置填色条件",
    en: "Set color conditions",
  },
  清除全部: {
    "zh-CN": "清除全部",
    en: "Clear all",
  },
  填色颜色: {
    "zh-CN": "填色颜色",
    en: "Fill color",
  },
  填色范围: {
    "zh-CN": "填色范围",
    en: "Fill range",
  },
  填色运算符: {
    "zh-CN": "填色运算符",
    en: "Color operator",
  },
  删除填色条件: {
    "zh-CN": "删除填色条件",
    en: "Delete color condition",
  },
  请输入: {
    "zh-CN": "请输入",
    en: "Please enter",
  },
  条件值: {
    "zh-CN": "条件值",
    en: "Condition value",
  },
  请选择: {
    "zh-CN": "请选择",
    en: "Please select",
  },
  创建编组: {
    "zh-CN": "创建编组",
    en: "Create group",
  },
  加入编组: {
    "zh-CN": "加入编组",
    en: "Add to group",
  },
  移出编组: {
    "zh-CN": "移出编组",
    en: "Remove from group",
  },
  "」？该列数据一并清除。": {
    "zh-CN": "」？该列数据一并清除。",
    en: "”? Data in this column will also be deleted.",
  },
  重命名编组: {
    "zh-CN": "重命名编组",
    en: "Rename group",
  },
  解散编组: {
    "zh-CN": "解散编组",
    en: "Ungroup",
  },
  编组名称: {
    "zh-CN": "编组名称",
    en: "Group name",
  },
  设置筛选条件: {
    "zh-CN": "设置筛选条件",
    en: "Set filter conditions",
  },
  筛选运算符: {
    "zh-CN": "筛选运算符",
    en: "Filter operator",
  },
  删除筛选条件: {
    "zh-CN": "删除筛选条件",
    en: "Delete filter condition",
  },
  "先添加字段，才能设置筛选条件。": {
    "zh-CN": "先添加字段，才能设置筛选条件。",
    en: "Add fields before setting filter conditions.",
  },
  升序排列: {
    "zh-CN": "升序排列",
    en: "Sort ascending",
  },
  降序排列: {
    "zh-CN": "降序排列",
    en: "Sort descending",
  },
  隐藏该列: {
    "zh-CN": "隐藏该列",
    en: "Hide column",
  },
  冻结到此列: {
    "zh-CN": "冻结到此列",
    en: "Freeze through this column",
  },
  取消冻结: {
    "zh-CN": "取消冻结",
    en: "Unfreeze",
  },
  显示全部列: {
    "zh-CN": "显示全部列",
    en: "Show all columns",
  },
  删除此行: {
    "zh-CN": "删除此行",
    en: "Delete row",
  },
  "暂无数据，点击「添加记录」开始录入": {
    "zh-CN": "暂无数据，点击「添加记录」开始录入",
    en: "No data yet. Click Add record to get started.",
  },
  这个数据表还没有字段: {
    "zh-CN": "这个数据表还没有字段",
    en: "This database has no fields yet",
  },
  "添加第一个字段后，表格就会显示对应的列。": {
    "zh-CN": "添加第一个字段后，表格就会显示对应的列。",
    en: "Add your first field to display a column in the table.",
  },
  所有列都被隐藏了: {
    "zh-CN": "所有列都被隐藏了",
    en: "All columns are hidden",
  },
  "在字段配置里重新显示至少一列。": {
    "zh-CN": "在字段配置里重新显示至少一列。",
    en: "Show at least one column in Field settings.",
  },
  搜索表格: {
    "zh-CN": "搜索表格",
    en: "Search table",
  },
  无结果: {
    "zh-CN": "无结果",
    en: "No results",
  },
  关闭搜索: {
    "zh-CN": "关闭搜索",
    en: "Close search",
  },
  中等: {
    "zh-CN": "中等",
    en: "Medium",
  },
  设置分组条件: {
    "zh-CN": "设置分组条件",
    en: "Set grouping conditions",
  },
  自动排序: {
    "zh-CN": "自动排序",
    en: "Auto sort",
  },
  "CSV 文件": {
    "zh-CN": "CSV 文件",
    en: "CSV file",
  },
  "Excel 工作簿": {
    "zh-CN": "Excel 工作簿",
    en: "Excel workbook",
  },
  "Signing in...": {
    "zh-CN": "登录中…",
    en: "Signing in...",
  },
  "Creating account...": {
    "zh-CN": "创建账号中…",
    en: "Creating account...",
  },
  "Select node type": {
    "zh-CN": "选择节点类型",
    en: "Select node type",
  },
  "Select semantic": {
    "zh-CN": "选择语义类型",
    en: "Select semantic",
  },
  "Edit Node Semantic": {
    "zh-CN": "编辑节点语义类型",
    en: "Edit Node Semantic",
  },
  "Add Node Semantic": {
    "zh-CN": "添加节点语义类型",
    en: "Add Node Semantic",
  },
  Update: {
    "zh-CN": "更新",
    en: "Update",
  },
  "Edit Edge Semantic": {
    "zh-CN": "编辑边语义类型",
    en: "Edit Edge Semantic",
  },
  "Add Edge Semantic": {
    "zh-CN": "添加边语义类型",
    en: "Add Edge Semantic",
  },
  "Image load failed": {
    "zh-CN": "图片加载失败",
    en: "Image load failed",
  },
  "Audio load failed": {
    "zh-CN": "音频加载失败",
    en: "Audio load failed",
  },
  "Upload failed": {
    "zh-CN": "上传失败",
    en: "Upload failed",
  },
  Unknown: {
    "zh-CN": "未知",
    en: "Unknown",
  },
  Audio: {
    "zh-CN": "音频",
    en: "Audio",
  },
  Webpage: {
    "zh-CN": "网页",
    en: "Webpage",
  },
  Website: {
    "zh-CN": "网站",
    en: "Website",
  },
  Collection: {
    "zh-CN": "集合",
    en: "Collection",
  },
  "Rich Text": {
    "zh-CN": "富文本",
    en: "Rich Text",
  },
  "Select workspace": {
    "zh-CN": "选择工作区",
    en: "Select workspace",
  },
  "Command Palette": {
    "zh-CN": "命令面板",
    en: "Command Palette",
  },
  "Search for a command to run...": {
    "zh-CN": "搜索要运行的命令…",
    en: "Search for a command to run...",
  },
  "Save & Exit": {
    "zh-CN": "保存并退出",
    en: "Save & Exit",
  },
  Exit: {
    "zh-CN": "退出",
    en: "Exit",
  },
  "Double-click to edit Excalidraw diagram": {
    "zh-CN": "双击编辑 Excalidraw 图形",
    en: "Double-click to edit Excalidraw diagram",
  },
  "Click to upload": {
    "zh-CN": "点击上传",
    en: "Click to upload",
  },
  "or drag and drop": {
    "zh-CN": "或拖放文件",
    en: "or drag and drop",
  },
  Maximum: {
    "zh-CN": "最多",
    en: "Maximum",
  },
  file: {
    "zh-CN": "个文件",
    en: "file",
  },
  "MB each.": {
    "zh-CN": "MB / 文件。",
    en: "MB each.",
  },
  Uploading: {
    "zh-CN": "正在上传",
    en: "Uploading",
  },
  files: {
    "zh-CN": "个文件",
    en: "files",
  },
  "Clear All": {
    "zh-CN": "清除全部",
    en: "Clear All",
  },
  "Empty equation": {
    "zh-CN": "空公式",
    en: "Empty equation",
  },
  "Invalid equation": {
    "zh-CN": "无效公式",
    en: "Invalid equation",
  },
  "Block Equation": {
    "zh-CN": "块级公式",
    en: "Block Equation",
  },
  Empty: {
    "zh-CN": "空",
    en: "Empty",
  },
  Invalid: {
    "zh-CN": "无效",
    en: "Invalid",
  },
  "Inline Equation": {
    "zh-CN": "行内公式",
    en: "Inline Equation",
  },
  Alignment: {
    "zh-CN": "对齐方式",
    en: "Alignment",
  },
  "Table cells option": {
    "zh-CN": "表格单元格选项",
    en: "Table cells option",
  },
  "Insert table": {
    "zh-CN": "插入表格",
    en: "Insert table",
  },
  "Add headings to create a table of contents.": {
    "zh-CN": "添加标题以生成目录。",
    en: "Add headings to create a table of contents.",
  },
  "Table of contents": {
    "zh-CN": "目录",
    en: "Table of contents",
  },
  "Show title": {
    "zh-CN": "显示标题",
    en: "Show title",
  },
  输出编辑器内容: {
    "zh-CN": "输出编辑器内容",
    en: "Print editor content",
  },
  "Text Highlighter": {
    "zh-CN": "文本高亮",
    en: "Text Highlighter",
  },
  "Link Editor": {
    "zh-CN": "链接编辑器",
    en: "Link Editor",
  },
  "Recent colors": {
    "zh-CN": "最近使用的颜色",
    en: "Recent colors",
  },
  "Text color": {
    "zh-CN": "文字颜色",
    en: "Text color",
  },
  "Highlight color": {
    "zh-CN": "高亮颜色",
    en: "Highlight color",
  },
  "Turn into": {
    "zh-CN": "转换为",
    en: "Turn into",
  },
  文本格式: {
    "zh-CN": "文本格式",
    en: "Text formatting",
  },
  "Ask AI Assistant": {
    "zh-CN": "询问 AI 助手",
    en: "Ask AI Assistant",
  },
  "Try again": {
    "zh-CN": "重试",
    en: "Try again",
  },
  Discard: {
    "zh-CN": "放弃",
    en: "Discard",
  },
  Apply: {
    "zh-CN": "应用",
    en: "Apply",
  },
  "Tell AI what else needs to be changed...": {
    "zh-CN": "告诉 AI 还需要修改什么…",
    en: "Tell AI what else needs to be changed...",
  },
  "Tone adjustment options": {
    "zh-CN": "语气调整选项",
    en: "Tone adjustment options",
  },
  Tone: {
    "zh-CN": "语气",
    en: "Tone",
  },
  "Submit prompt": {
    "zh-CN": "提交提示",
    en: "Submit prompt",
  },
  English: {
    "zh-CN": "英语",
    en: "English",
  },
  Korean: {
    "zh-CN": "韩语",
    en: "Korean",
  },
  Chinese: {
    "zh-CN": "中文",
    en: "Chinese",
  },
  Japanese: {
    "zh-CN": "日语",
    en: "Japanese",
  },
  Spanish: {
    "zh-CN": "西班牙语",
    en: "Spanish",
  },
  Russian: {
    "zh-CN": "俄语",
    en: "Russian",
  },
  French: {
    "zh-CN": "法语",
    en: "French",
  },
  Portuguese: {
    "zh-CN": "葡萄牙语",
    en: "Portuguese",
  },
  German: {
    "zh-CN": "德语",
    en: "German",
  },
  Italian: {
    "zh-CN": "意大利语",
    en: "Italian",
  },
  Dutch: {
    "zh-CN": "荷兰语",
    en: "Dutch",
  },
  Indonesian: {
    "zh-CN": "印度尼西亚语",
    en: "Indonesian",
  },
  Vietnamese: {
    "zh-CN": "越南语",
    en: "Vietnamese",
  },
  Turkish: {
    "zh-CN": "土耳其语",
    en: "Turkish",
  },
  Arabic: {
    "zh-CN": "阿拉伯语",
    en: "Arabic",
  },
  Academic: {
    "zh-CN": "学术",
    en: "Academic",
  },
  Business: {
    "zh-CN": "商务",
    en: "Business",
  },
  Casual: {
    "zh-CN": "随意",
    en: "Casual",
  },
  Childfriendly: {
    "zh-CN": "适合儿童",
    en: "Childfriendly",
  },
  Confident: {
    "zh-CN": "自信",
    en: "Confident",
  },
  Conversational: {
    "zh-CN": "口语",
    en: "Conversational",
  },
  Creative: {
    "zh-CN": "创意",
    en: "Creative",
  },
  Emotional: {
    "zh-CN": "感性",
    en: "Emotional",
  },
  Excited: {
    "zh-CN": "兴奋",
    en: "Excited",
  },
  Formal: {
    "zh-CN": "正式",
    en: "Formal",
  },
  Friendly: {
    "zh-CN": "友好",
    en: "Friendly",
  },
  Funny: {
    "zh-CN": "幽默",
    en: "Funny",
  },
  Numorous: {
    "zh-CN": "幽默",
    en: "Numorous",
  },
  Informative: {
    "zh-CN": "知识性",
    en: "Informative",
  },
  Inspirational: {
    "zh-CN": "鼓舞",
    en: "Inspirational",
  },
  Memeify: {
    "zh-CN": "表情化",
    en: "Memeify",
  },
  Narrative: {
    "zh-CN": "叙事",
    en: "Narrative",
  },
  Objective: {
    "zh-CN": "客观",
    en: "Objective",
  },
  Persuasive: {
    "zh-CN": "说服",
    en: "Persuasive",
  },
  Poetic: {
    "zh-CN": "诗意",
    en: "Poetic",
  },
  "Adjust tone": {
    "zh-CN": "调整语气",
    en: "Adjust tone",
  },
  "Fix spelling & grammar": {
    "zh-CN": "修正拼写与语法",
    en: "Fix spelling & grammar",
  },
  "Make longer": {
    "zh-CN": "扩写",
    en: "Make longer",
  },
  "Make shorter": {
    "zh-CN": "缩写",
    en: "Make shorter",
  },
  "Simplify language": {
    "zh-CN": "简化语言",
    en: "Simplify language",
  },
  "Improve writing": {
    "zh-CN": "改进写作",
    en: "Improve writing",
  },
  Emojify: {
    "zh-CN": "添加表情",
    en: "Emojify",
  },
  "Continue writing": {
    "zh-CN": "续写",
    en: "Continue writing",
  },
  "Add a summary": {
    "zh-CN": "添加摘要",
    en: "Add a summary",
  },
  Languages: {
    "zh-CN": "语言",
    en: "Languages",
  },
  Write: {
    "zh-CN": "写作",
    en: "Write",
  },
  "Adjust Tone": {
    "zh-CN": "调整语气",
    en: "Adjust Tone",
  },
  "AI is writing": {
    "zh-CN": "AI 正在写作",
    en: "AI is writing",
  },
  Stop: {
    "zh-CN": "停止",
    en: "Stop",
  },
  Blockquote: {
    "zh-CN": "引用",
    en: "Blockquote",
  },
  "Code Block": {
    "zh-CN": "代码块",
    en: "Code Block",
  },
  "Default background": {
    "zh-CN": "默认背景",
    en: "Default background",
  },
  "Gray background": {
    "zh-CN": "灰色背景",
    en: "Gray background",
  },
  "Brown background": {
    "zh-CN": "棕色背景",
    en: "Brown background",
  },
  "Orange background": {
    "zh-CN": "橙色背景",
    en: "Orange background",
  },
  "Yellow background": {
    "zh-CN": "黄色背景",
    en: "Yellow background",
  },
  "Green background": {
    "zh-CN": "绿色背景",
    en: "Green background",
  },
  "Blue background": {
    "zh-CN": "蓝色背景",
    en: "Blue background",
  },
  "Purple background": {
    "zh-CN": "紫色背景",
    en: "Purple background",
  },
  "Pink background": {
    "zh-CN": "粉色背景",
    en: "Pink background",
  },
  "Red background": {
    "zh-CN": "红色背景",
    en: "Red background",
  },
  "Remove highlight": {
    "zh-CN": "移除高亮",
    en: "Remove highlight",
  },
  "Highlight text": {
    "zh-CN": "高亮文本",
    en: "Highlight text",
  },
  "Highlight colors": {
    "zh-CN": "高亮颜色",
    en: "Highlight colors",
  },
  "Background color": {
    "zh-CN": "背景颜色",
    en: "Background color",
  },
  "Default text": {
    "zh-CN": "默认文字颜色",
    en: "Default text",
  },
  "Gray text": {
    "zh-CN": "灰色文字",
    en: "Gray text",
  },
  "Brown text": {
    "zh-CN": "棕色文字",
    en: "Brown text",
  },
  "Orange text": {
    "zh-CN": "橙色文字",
    en: "Orange text",
  },
  "Yellow text": {
    "zh-CN": "黄色文字",
    en: "Yellow text",
  },
  "Green text": {
    "zh-CN": "绿色文字",
    en: "Green text",
  },
  "Blue text": {
    "zh-CN": "蓝色文字",
    en: "Blue text",
  },
  "Purple text": {
    "zh-CN": "紫色文字",
    en: "Purple text",
  },
  "Pink text": {
    "zh-CN": "粉色文字",
    en: "Pink text",
  },
  "Red text": {
    "zh-CN": "红色文字",
    en: "Red text",
  },
  "Recently used": {
    "zh-CN": "最近使用",
    en: "Recently used",
  },
  "Text color options": {
    "zh-CN": "文字颜色选项",
    en: "Text color options",
  },
  "Copy anchor link": {
    "zh-CN": "复制锚点链接",
    en: "Copy anchor link",
  },
  "Copy to clipboard": {
    "zh-CN": "复制到剪贴板",
    en: "Copy to clipboard",
  },
  "Click for options": {
    "zh-CN": "点击查看选项",
    en: "Click for options",
  },
  "Hold for drag": {
    "zh-CN": "按住拖动",
    en: "Hold for drag",
  },
  "Duplicate node": {
    "zh-CN": "复制节点",
    en: "Duplicate node",
  },
  "Add a emoji reaction...": {
    "zh-CN": "添加表情回应…",
    en: "Add a emoji reaction...",
  },
  "Add emoji": {
    "zh-CN": "添加表情",
    en: "Add emoji",
  },
  Caption: {
    "zh-CN": "说明文字",
    en: "Caption",
  },
  "Download image": {
    "zh-CN": "下载图片",
    en: "Download image",
  },
  "Add image": {
    "zh-CN": "添加图片",
    en: "Add image",
  },
  Improve: {
    "zh-CN": "改进",
    en: "Improve",
  },
  "Math block": {
    "zh-CN": "块级公式",
    en: "Math block",
  },
  "Inline math": {
    "zh-CN": "行内公式",
    en: "Inline math",
  },
  Link: {
    "zh-CN": "链接",
    en: "Link",
  },
  "Paste a link...": {
    "zh-CN": "粘贴链接…",
    en: "Paste a link...",
  },
  "Apply link": {
    "zh-CN": "应用链接",
    en: "Apply link",
  },
  "Open in new window": {
    "zh-CN": "在新窗口打开",
    en: "Open in new window",
  },
  "Remove link": {
    "zh-CN": "移除链接",
    en: "Remove link",
  },
  "Add mention": {
    "zh-CN": "添加提及",
    en: "Add mention",
  },
  "Reset formatting": {
    "zh-CN": "重置格式",
    en: "Reset formatting",
  },
  "Insert block": {
    "zh-CN": "插入块",
    en: "Insert block",
  },
  "Continue Writing": {
    "zh-CN": "续写",
    en: "Continue Writing",
  },
  "Ask AI": {
    "zh-CN": "询问 AI",
    en: "Ask AI",
  },
  "Heading 1": {
    "zh-CN": "一级标题",
    en: "Heading 1",
  },
  "Heading 2": {
    "zh-CN": "二级标题",
    en: "Heading 2",
  },
  "Heading 3": {
    "zh-CN": "三级标题",
    en: "Heading 3",
  },
  "Bullet List": {
    "zh-CN": "无序列表",
    en: "Bullet List",
  },
  "Numbered List": {
    "zh-CN": "有序列表",
    en: "Numbered List",
  },
  "To-do list": {
    "zh-CN": "待办列表",
    en: "To-do list",
  },
  Mention: {
    "zh-CN": "提及",
    en: "Mention",
  },
  Table: {
    "zh-CN": "表格",
    en: "Table",
  },
  Separator: {
    "zh-CN": "分隔线",
    en: "Separator",
  },
  "Excalidraw diagram": {
    "zh-CN": "Excalidraw 图形",
    en: "Excalidraw diagram",
  },
  "Inline LaTeX": {
    "zh-CN": "行内 LaTeX",
    en: "Inline LaTeX",
  },
  "Block LaTeX": {
    "zh-CN": "块级 LaTeX",
    en: "Block LaTeX",
  },
  Image: {
    "zh-CN": "图片",
    en: "Image",
  },
  "Bulleted list": {
    "zh-CN": "无序列表",
    en: "Bulleted list",
  },
  "Numbered list": {
    "zh-CN": "有序列表",
    en: "Numbered list",
  },
  "Code block": {
    "zh-CN": "代码块",
    en: "Code block",
  },
  "Latex block": {
    "zh-CN": "块级公式",
    en: "Latex block",
  },
  "Latex inline": {
    "zh-CN": "行内公式",
    en: "Latex inline",
  },
  "Resize sidebar": {
    "zh-CN": "调整侧边栏宽度",
    en: "Resize sidebar",
  },
  toolbar: {
    "zh-CN": "工具栏",
    en: "toolbar",
  },
  Suggestions: {
    "zh-CN": "建议",
    en: "Suggestions",
  },
  Replace: {
    "zh-CN": "替换",
    en: "Replace",
  },
  "Add a caption...": {
    "zh-CN": "添加说明文字…",
    en: "Add a caption...",
  },
  "No file selected": {
    "zh-CN": "未选择文件",
    en: "No file selected",
  },
  "Insert row above": {
    "zh-CN": "在上方插入行",
    en: "Insert row above",
  },
  "Insert row below": {
    "zh-CN": "在下方插入行",
    en: "Insert row below",
  },
  "Insert column left": {
    "zh-CN": "在左侧插入列",
    en: "Insert column left",
  },
  "Insert column right": {
    "zh-CN": "在右侧插入列",
    en: "Insert column right",
  },
  "Align left": {
    "zh-CN": "左对齐",
    en: "Align left",
  },
  "Align center": {
    "zh-CN": "居中对齐",
    en: "Align center",
  },
  "Align right": {
    "zh-CN": "右对齐",
    en: "Align right",
  },
  Justify: {
    "zh-CN": "两端对齐",
    en: "Justify",
  },
  "Align top": {
    "zh-CN": "顶部对齐",
    en: "Align top",
  },
  "Align middle": {
    "zh-CN": "垂直居中",
    en: "Align middle",
  },
  "Align bottom": {
    "zh-CN": "底部对齐",
    en: "Align bottom",
  },
  "Clear row contents": {
    "zh-CN": "清除行内容",
    en: "Clear row contents",
  },
  "Clear column contents": {
    "zh-CN": "清除列内容",
    en: "Clear column contents",
  },
  "Clear contents": {
    "zh-CN": "清除内容",
    en: "Clear contents",
  },
  "Delete row": {
    "zh-CN": "删除行",
    en: "Delete row",
  },
  "Delete column": {
    "zh-CN": "删除列",
    en: "Delete column",
  },
  "Duplicate row": {
    "zh-CN": "复制行",
    en: "Duplicate row",
  },
  "Duplicate column": {
    "zh-CN": "复制列",
    en: "Duplicate column",
  },
  "Add or remove rows": {
    "zh-CN": "添加或移除行",
    en: "Add or remove rows",
  },
  "Add or remove columns": {
    "zh-CN": "添加或移除列",
    en: "Add or remove columns",
  },
  "Fit to width": {
    "zh-CN": "适配宽度",
    en: "Fit to width",
  },
  "Row actions": {
    "zh-CN": "行操作",
    en: "Row actions",
  },
  "Column actions": {
    "zh-CN": "列操作",
    en: "Column actions",
  },
  "Header row": {
    "zh-CN": "标题行",
    en: "Header row",
  },
  "Header column": {
    "zh-CN": "标题列",
    en: "Header column",
  },
  "Merge cells": {
    "zh-CN": "合并单元格",
    en: "Merge cells",
  },
  "Split cell": {
    "zh-CN": "拆分单元格",
    en: "Split cell",
  },
  "Move row up": {
    "zh-CN": "上移行",
    en: "Move row up",
  },
  "Move row down": {
    "zh-CN": "下移行",
    en: "Move row down",
  },
  "Move row left": {
    "zh-CN": "左移行",
    en: "Move row left",
  },
  "Move row right": {
    "zh-CN": "右移行",
    en: "Move row right",
  },
  "Move column up": {
    "zh-CN": "上移列",
    en: "Move column up",
  },
  "Move column down": {
    "zh-CN": "下移列",
    en: "Move column down",
  },
  "Move column left": {
    "zh-CN": "左移列",
    en: "Move column left",
  },
  "Move column right": {
    "zh-CN": "右移列",
    en: "Move column right",
  },
  "More options": {
    "zh-CN": "更多选项",
    en: "More options",
  },
  "Loading editor…": {
    "zh-CN": "加载编辑器…",
    en: "Loading editor…",
  },
  "Start writing...": {
    "zh-CN": "开始写作…",
    en: "Start writing...",
  },
  "Ask AI what you want...": {
    "zh-CN": "告诉 AI 你想做什么…",
    en: "Ask AI what you want...",
  },
  Highlight: {
    "zh-CN": "高亮",
    en: "Highlight",
  },
  "Turn Into": {
    "zh-CN": "转换为",
    en: "Turn Into",
  },
  "Clear all contents": {
    "zh-CN": "清除全部内容",
    en: "Clear all contents",
  },
  Duplicate: {
    "zh-CN": "复制",
    en: "Duplicate",
  },
  "Image align left": {
    "zh-CN": "图片左对齐",
    en: "Image align left",
  },
  "Image align center": {
    "zh-CN": "图片居中",
    en: "Image align center",
  },
  "Image align right": {
    "zh-CN": "图片右对齐",
    en: "Image align right",
  },
  "Increase indent": {
    "zh-CN": "增加缩进",
    en: "Increase indent",
  },
  "Decrease indent": {
    "zh-CN": "减少缩进",
    en: "Decrease indent",
  },
  "Math Block": {
    "zh-CN": "块级公式",
    en: "Math Block",
  },
  "Inline Math": {
    "zh-CN": "行内公式",
    en: "Inline Math",
  },
  "Ordered List": {
    "zh-CN": "有序列表",
    en: "Ordered List",
  },
  "Task List": {
    "zh-CN": "任务列表",
    en: "Task List",
  },
  "Move Up": {
    "zh-CN": "上移",
    en: "Move Up",
  },
  "Move Down": {
    "zh-CN": "下移",
    en: "Move Down",
  },
  "Filter...": {
    "zh-CN": "筛选…",
    en: "Filter...",
  },
  "Continue writing from the current position": {
    "zh-CN": "从当前位置续写",
    en: "Continue writing from the current position",
  },
  "Ask AI to generate content": {
    "zh-CN": "请 AI 生成内容",
    en: "Ask AI to generate content",
  },
  "Regular text paragraph": {
    "zh-CN": "普通文本段落",
    en: "Regular text paragraph",
  },
  Style: {
    "zh-CN": "样式",
    en: "Style",
  },
  "Key section heading": {
    "zh-CN": "主要章节标题",
    en: "Key section heading",
  },
  "Subsection and group heading": {
    "zh-CN": "子章节标题",
    en: "Subsection and group heading",
  },
  "List with unordered items": {
    "zh-CN": "无序项目列表",
    en: "List with unordered items",
  },
  "List with ordered items": {
    "zh-CN": "有序项目列表",
    en: "List with ordered items",
  },
  "List with tasks": {
    "zh-CN": "任务列表",
    en: "List with tasks",
  },
  "Blockquote block": {
    "zh-CN": "引用块",
    en: "Blockquote block",
  },
  "Code block with syntax highlighting": {
    "zh-CN": "带语法高亮的代码块",
    en: "Code block with syntax highlighting",
  },
  "Mention a user or item": {
    "zh-CN": "提及用户或项目",
    en: "Mention a user or item",
  },
  Insert: {
    "zh-CN": "插入",
    en: "Insert",
  },
  "Insert an emoji": {
    "zh-CN": "插入表情",
    en: "Insert an emoji",
  },
  "Insert a table": {
    "zh-CN": "插入表格",
    en: "Insert a table",
  },
  "Horizontal line to separate content": {
    "zh-CN": "用于分隔内容的横线",
    en: "Horizontal line to separate content",
  },
  "Insert a table of contents": {
    "zh-CN": "插入目录",
    en: "Insert a table of contents",
  },
  "Draw and sketch excalidraw diagrams": {
    "zh-CN": "绘制 Excalidraw 图形",
    en: "Draw and sketch excalidraw diagrams",
  },
  "Insert inline mathematical formula": {
    "zh-CN": "插入行内数学公式",
    en: "Insert inline mathematical formula",
  },
  "Resizable image with caption": {
    "zh-CN": "可调整大小的图片和说明文字",
    en: "Resizable image with caption",
  },
  "Align justify": {
    "zh-CN": "两端对齐",
    en: "Align justify",
  },
  Undo: {
    "zh-CN": "撤销",
    en: "Undo",
  },
  Redo: {
    "zh-CN": "重做",
    en: "Redo",
  },
  本地后端启动失败: {
    "zh-CN": "本地后端启动失败",
    en: "Failed to start local backend",
  },
  "本地后端连接中断，请重试启动。数据库保存在应用数据目录。": {
    "zh-CN": "本地后端连接中断，请重试启动。数据库保存在应用数据目录。",
    en: "Local backend disconnected. Please restart. Your database is stored in the app data directory.",
  },
  重试启动: {
    "zh-CN": "重试启动",
    en: "Retry startup",
  },
  "正在启动本地工作空间…": {
    "zh-CN": "正在启动本地工作空间…",
    en: "Starting local workspace…",
  },
  语言切换: {
    "zh-CN": "语言切换",
    en: "Switch language",
  },
  切换侧边栏: {
    "zh-CN": "切换侧边栏",
    en: "Toggle sidebar",
  },
  登录失败: {
    "zh-CN": "登录失败",
    en: "Sign in failed",
  },
  注册失败: {
    "zh-CN": "注册失败",
    en: "Registration failed",
  },
  "Sign in failed": {
    "zh-CN": "登录失败",
    en: "Sign in failed",
  },
  "Registration failed": {
    "zh-CN": "注册失败",
    en: "Registration failed",
  },
  细: {
    "zh-CN": "细",
    en: "Thin",
  },
  中: {
    "zh-CN": "中",
    en: "Medium",
  },
  粗: {
    "zh-CN": "粗",
    en: "Thick",
  },
  红: {
    "zh-CN": "红",
    en: "Red",
  },
  黄: {
    "zh-CN": "黄",
    en: "Yellow",
  },
  绿: {
    "zh-CN": "绿",
    en: "Green",
  },
  蓝: {
    "zh-CN": "蓝",
    en: "Blue",
  },
  紫: {
    "zh-CN": "紫",
    en: "Purple",
  },
  墨: {
    "zh-CN": "墨",
    en: "Ink",
  },
  边: {
    "zh-CN": "边",
    en: "Edges",
  },
  无: {
    "zh-CN": "无",
    en: "None",
  },
  橙: {
    "zh-CN": "橙",
    en: "Orange",
  },
  青: {
    "zh-CN": "青",
    en: "Cyan",
  },
  粉: {
    "zh-CN": "粉",
    en: "Pink",
  },
  空: {
    "zh-CN": "空",
    en: "Empty",
  },
  共: {
    "zh-CN": "共",
    en: "Total",
  },
  月: {
    "zh-CN": "月",
    en: "Month",
  },
  周: {
    "zh-CN": "周",
    en: "Week",
  },
  日: {
    "zh-CN": "日",
    en: "Day",
  },
  值: {
    "zh-CN": "值",
    en: "Value",
  },
  级: {
    "zh-CN": "级",
    en: "Level",
  },
  小: {
    "zh-CN": "小",
    en: "Small",
  },
  大: {
    "zh-CN": "大",
    en: "Large",
  },
  低: {
    "zh-CN": "低",
    en: "Low",
  },
  高: {
    "zh-CN": "高",
    en: "High",
  },
  行: {
    "zh-CN": "行",
    en: "Row",
  },
  列: {
    "zh-CN": "列",
    en: "Column",
  },
  是: {
    "zh-CN": "是",
    en: "Yes",
  },
  否: {
    "zh-CN": "否",
    en: "No",
  },
  Database: {
    "zh-CN": "数据库",
    en: "Database",
  },
  Video: {
    "zh-CN": "视频",
    en: "Video",
  },
  "Multi-month": {
    "zh-CN": "多月",
    en: "Multi-month",
  },
  "Flow mode is under reconstruction": {
    "zh-CN": "流程图模式正在开发中",
    en: "Flow mode is under reconstruction",
  },
  "Worker init failed:": {
    "zh-CN": "图谱渲染初始化失败：",
    en: "Worker init failed:",
  },
  "Initializing…": {
    "zh-CN": "初始化中…",
    en: "Initializing…",
  },
  "ForceGraph render error:": {
    "zh-CN": "图谱渲染失败：",
    en: "ForceGraph render error:",
  },
  "No view selected": {
    "zh-CN": "未选择视图",
    en: "No view selected",
  },
  "画笔 · {value1}（{value2}）· 双击设置": {
    "zh-CN": "画笔 · {value1}（{value2}）· 双击设置",
    en: "Brush · {value1} ({value2}) · Double-click for settings",
  },
  "颜色与粗细（{value1}）": {
    "zh-CN": "颜色与粗细（{value1}）",
    en: "Color and thickness ({value1})",
  },
  "添加 {value1}": {
    "zh-CN": "添加 {value1}",
    en: "Add {value1}",
  },
  "删除“{value1}”及其布局？节点内容和组件库会保留。": {
    "zh-CN": "删除“{value1}”及其布局？节点内容和组件库会保留。",
    en: "Delete “{value1}” and its layout? Node content and the widget library will be kept.",
  },
  "Dashboard 标题：{value1}，双击或按回车重命名": {
    "zh-CN": "Dashboard 标题：{value1}，双击或按回车重命名",
    en: "Dashboard title: {value1}. Double-click or press Enter to rename.",
  },
  "打开节点 {value1}": {
    "zh-CN": "打开节点 {value1}",
    en: "Open node {value1}",
  },
  "移除组件 {value1}": {
    "zh-CN": "移除组件 {value1}",
    en: "Remove widget {value1}",
  },
  "跳到 {value1}": {
    "zh-CN": "跳到 {value1}",
    en: "Jump to {value1}",
  },
  "{value1}，{value2} 条笔记": {
    "zh-CN": "{value1}，{value2} 条笔记",
    en: "{value1}, {value2} notes",
  },
  "定位到 {value1}": {
    "zh-CN": "定位到 {value1}",
    en: "Jump to {value1}",
  },
  "撤销删除 {value1} 的笔记": {
    "zh-CN": "撤销删除 {value1} 的笔记",
    en: "Undo deleting the note at {value1}",
  },
  "跳到 {value1}：{value2}": {
    "zh-CN": "跳到 {value1}：{value2}",
    en: "Jump to {value1}: {value2}",
  },
  "上传失败：{value1}": {
    "zh-CN": "上传失败：{value1}",
    en: "Upload failed: {value1}",
  },
  "不支持的文件类型：{value1}（期望 {value2}）": {
    "zh-CN": "不支持的文件类型：{value1}（期望 {value2}）",
    en: "Unsupported file type: {value1} (expected {value2})",
  },
  "源码文件超过 {value1}MB，无法载入编辑器": {
    "zh-CN": "源码文件超过 {value1}MB，无法载入编辑器",
    en: "Source file exceeds {value1} MB and cannot be loaded into the editor",
  },
  "{value1} 文档": {
    "zh-CN": "{value1} 文档",
    en: "{value1} document",
  },
  "PDF 加载失败：{value1}": {
    "zh-CN": "PDF 加载失败：{value1}",
    en: "Failed to load PDF: {value1}",
  },
  "{value1}预览": {
    "zh-CN": "{value1}预览",
    en: "{value1} preview",
  },
  "底色 {value1}": {
    "zh-CN": "底色 {value1}",
    en: "Background color {value1}",
  },
  "{value1}尚未实现": {
    "zh-CN": "{value1}尚未实现",
    en: "{value1} is not available yet",
  },
  "隐藏 {value1}": {
    "zh-CN": "隐藏 {value1}",
    en: "Hide {value1}",
  },
  "显示 {value1}": {
    "zh-CN": "显示 {value1}",
    en: "Show {value1}",
  },
  "{value1} 更多操作": {
    "zh-CN": "{value1} 更多操作",
    en: "More actions for {value1}",
  },
  "{value1} 选项颜色": {
    "zh-CN": "{value1} 选项颜色",
    en: "Option color for {value1}",
  },
  "选项 {value1}": {
    "zh-CN": "选项 {value1}",
    en: "Option {value1}",
  },
  "删除选项 {value1}": {
    "zh-CN": "删除选项 {value1}",
    en: "Delete option {value1}",
  },
  "移除 {value1}": {
    "zh-CN": "移除 {value1}",
    en: "Remove {value1}",
  },
  "创建 {value1}": {
    "zh-CN": "创建 {value1}",
    en: "Create {value1}",
  },
  "字段操作：{value1}": {
    "zh-CN": "字段操作：{value1}",
    en: "Field actions: {value1}",
  },
  "{value1} 副本": {
    "zh-CN": "{value1} 副本",
    en: "{value1} copy",
  },
  "{value1}（计数）": {
    "zh-CN": "{value1}（计数）",
    en: "{value1} (count)",
  },
  "{value1} 条记录": {
    "zh-CN": "{value1} 条记录",
    en: "{value1} records",
  },
  "{value1} 级": {
    "zh-CN": "{value1} 级",
    en: "Level {value1}",
  },
  "度量{value1}": {
    "zh-CN": "度量{value1}",
    en: "Measure {value1}",
  },
  "度量 {value1} 聚合": {
    "zh-CN": "度量 {value1} 聚合",
    en: "Aggregation for measure {value1}",
  },
  "删除度量 {value1}": {
    "zh-CN": "删除度量 {value1}",
    en: "Delete measure {value1}",
  },
  "删除第 {value1} 级": {
    "zh-CN": "删除第 {value1} 级",
    en: "Delete level {value1}",
  },
  "打开「{value1}」": {
    "zh-CN": "打开「{value1}」",
    en: "Open “{value1}”",
  },
  "删除选中的 {value1} 条记录": {
    "zh-CN": "删除选中的 {value1} 条记录",
    en: "Delete {value1} selected records",
  },
  "拖动泳道：{value1}": {
    "zh-CN": "拖动泳道：{value1}",
    en: "Drag lane: {value1}",
  },
  "编辑选项：{value1}": {
    "zh-CN": "编辑选项：{value1}",
    en: "Edit option: {value1}",
  },
  "在「{value1}」新建卡片": {
    "zh-CN": "在「{value1}」新建卡片",
    en: "Create card in “{value1}”",
  },
  "展开泳道：{value1}": {
    "zh-CN": "展开泳道：{value1}",
    en: "Expand lane: {value1}",
  },
  "拖动卡片：{value1}": {
    "zh-CN": "拖动卡片：{value1}",
    en: "Drag card: {value1}",
  },
  "颜色 {value1}": {
    "zh-CN": "颜色 {value1}",
    en: "Color {value1}",
  },
  "编组 {value1}": {
    "zh-CN": "编组 {value1}",
    en: "Group {value1}",
  },
  "展开 {value1}": {
    "zh-CN": "展开 {value1}",
    en: "Expand {value1}",
  },
  "折叠 {value1}": {
    "zh-CN": "折叠 {value1}",
    en: "Collapse {value1}",
  },
  "删除选中的 {value1} 行": {
    "zh-CN": "删除选中的 {value1} 行",
    en: "Delete {value1} selected rows",
  },
  "已删除 {time} 的笔记": {
    "zh-CN": "已删除 {time} 的笔记",
    en: "Deleted note at {time}",
  },
  "{count} 个隐藏字段": {
    "zh-CN": "{count} 个隐藏字段",
    en: "{count} hidden fields",
  },
  "Heading {level}": {
    "zh-CN": "{level} 级标题",
    en: "Heading {level}",
  },
  Bold: {
    "zh-CN": "加粗",
    en: "Bold",
  },
  Italic: {
    "zh-CN": "斜体",
    en: "Italic",
  },
  Underline: {
    "zh-CN": "下划线",
    en: "Underline",
  },
  Strike: {
    "zh-CN": "删除线",
    en: "Strike",
  },
  Subscript: {
    "zh-CN": "下标",
    en: "Subscript",
  },
  Superscript: {
    "zh-CN": "上标",
    en: "Superscript",
  },
  Code: {
    "zh-CN": "行内代码",
    en: "Code",
  },
  "Export editor content": {
    "zh-CN": "输出编辑器内容",
    en: "Export editor content",
  },
  And: {
    "zh-CN": "且",
    en: "And",
  },
  Or: {
    "zh-CN": "或",
    en: "Or",
  },
  "is equal to": {
    "zh-CN": "等于",
    en: "is equal to",
  },
  "is not equal to": {
    "zh-CN": "不等于",
    en: "is not equal to",
  },
  contains: {
    "zh-CN": "包含",
    en: "contains",
  },
  "does not contain": {
    "zh-CN": "不包含",
    en: "does not contain",
  },
  "begins with": {
    "zh-CN": "开头为",
    en: "begins with",
  },
  "ends with": {
    "zh-CN": "结尾为",
    en: "ends with",
  },
  "is null": {
    "zh-CN": "为空",
    en: "is null",
  },
  "is not null": {
    "zh-CN": "不为空",
    en: "is not null",
  },
  "is in": {
    "zh-CN": "属于",
    en: "is in",
  },
  "is not in": {
    "zh-CN": "不属于",
    en: "is not in",
  },
  "is between": {
    "zh-CN": "介于",
    en: "is between",
  },
  "is not between": {
    "zh-CN": "不介于",
    en: "is not between",
  },
  and: {
    "zh-CN": "且",
    en: "and",
  },
  or: {
    "zh-CN": "或",
    en: "or",
  },
  "Sort row A-Z": {
    "zh-CN": "行升序排列",
    en: "Sort row A-Z",
  },
  "Sort row Z-A": {
    "zh-CN": "行降序排列",
    en: "Sort row Z-A",
  },
  "Sort column A-Z": {
    "zh-CN": "列升序排列",
    en: "Sort column A-Z",
  },
  "Sort column Z-A": {
    "zh-CN": "列降序排列",
    en: "Sort column Z-A",
  },
  AND: {
    "zh-CN": "且",
    en: "AND",
  },
  OR: {
    "zh-CN": "或",
    en: "OR",
  },
  "does not begin with": {
    "zh-CN": "开头不为",
    en: "does not begin with",
  },
  "does not end with": {
    "zh-CN": "结尾不为",
    en: "does not end with",
  },
  in: {
    "zh-CN": "属于",
    en: "in",
  },
  "not in": {
    "zh-CN": "不属于",
    en: "not in",
  },
  between: {
    "zh-CN": "介于",
    en: "between",
  },
  "not between": {
    "zh-CN": "不介于",
    en: "not between",
  },
  展开大纲: {
    "zh-CN": "展开大纲",
    en: "Expand outline",
  },
  收起大纲: {
    "zh-CN": "收起大纲",
    en: "Collapse outline",
  },
  关闭侧边栏: {
    "zh-CN": "关闭侧边栏",
    en: "Close sidebar",
  },
  固定侧边栏: {
    "zh-CN": "固定侧边栏",
    en: "Pin sidebar",
  },
  打开组件库: {
    "zh-CN": "打开组件库",
    en: "Open component library",
  },
  "打开 Dashboard 侧边栏": {
    "zh-CN": "打开 Dashboard 侧边栏",
    en: "Open dashboard sidebar",
  },
  还没有页面: {
    "zh-CN": "还没有页面",
    en: "No pages yet",
  },
  上传成功: {
    "zh-CN": "上传成功",
    en: "Upload successful",
  },
  // Page destinations of the dynamic island. The host owns the route table; the
  // label lives in the shared catalog because the island renders it.
  资源库: {
    "zh-CN": "资源库",
    en: "Resources",
  },
  打开资源库: {
    "zh-CN": "打开资源库",
    en: "Open resources",
  },
};
