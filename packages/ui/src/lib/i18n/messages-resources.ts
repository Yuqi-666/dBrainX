// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Interface copy of the media resource library (the `/resources` surface).
 *
 * Kept in its own module so the shared catalog file stays a merge-free region
 * while this feature is written; `messages.ts` spreads it into the one map
 * `translate` reads. Every key must carry both languages and the same
 * `{placeholder}` names, which `runtime.test.ts` checks.
 *
 * Existing keys (`重命名`, `删除`, `取消`, `保存`, `图片`, `视频`, `音频`, `全部`,
 * …) stay in the shared catalog and are translated through it; only copy this
 * feature introduces lives here. The `PDF` / `其他` category labels and the
 * loading line are shared with the resource selector and live in that feature's
 * module, which spreads after this one — leave them there so the catalog keeps
 * one source per string.
 */
export const resourceLibraryMessages: Record<
  string,
  { "zh-CN": string; en: string }
> = {
  /**
   * The island names this destination 「资源库」/「Resources」. The page title
   * spells it out in English, so it needs its own key: the shared one is a
   * navigation label and must not be reworded for the page.
   */
  "Resource library": {
    "zh-CN": "资源库",
    en: "Resource library",
  },
  "上传的图片、音视频和文档都在这里；可以重命名、复制链接，也可以释放存储空间。":
    {
      "zh-CN":
        "上传的图片、音视频和文档都在这里；可以重命名、复制链接，也可以释放存储空间。",
      en: "Every image, audio, video, and document you upload lives here. Rename it, copy its link, or free the space.",
    },
  刷新: {
    "zh-CN": "刷新",
    en: "Refresh",
  },
  上传文件: {
    "zh-CN": "上传文件",
    en: "Upload files",
  },
  "上传中…": {
    "zh-CN": "上传中…",
    en: "Uploading…",
  },
  "正在上传 {value1}/{value2}": {
    "zh-CN": "正在上传 {value1}/{value2}",
    en: "Uploading {value1}/{value2}",
  },
  存储空间: {
    "zh-CN": "存储空间",
    en: "Storage",
  },
  存储空间占用: {
    "zh-CN": "存储空间占用",
    en: "Storage usage",
  },
  "已用 {value1} / {value2}": {
    "zh-CN": "已用 {value1} / {value2}",
    en: "Used {value1} / {value2}",
  },
  "已用 {value1}%": {
    "zh-CN": "已用 {value1}%",
    en: "{value1}% used",
  },
  "剩余 {value1}": {
    "zh-CN": "剩余 {value1}",
    en: "{value1} remaining",
  },
  不限: {
    "zh-CN": "不限",
    en: "Unlimited",
  },
  "存储空间已用超过 90%。": {
    "zh-CN": "存储空间已用超过 90%。",
    en: "More than 90% of the storage quota is used.",
  },
  按类型: {
    "zh-CN": "按类型",
    en: "By category",
  },
  "搜索资源…": {
    "zh-CN": "搜索资源…",
    en: "Search resources…",
  },
  搜索资源: {
    "zh-CN": "搜索资源",
    en: "Search resources",
  },
  按类型筛选: {
    "zh-CN": "按类型筛选",
    en: "Filter by type",
  },
  "共 {value1} 个资源": {
    "zh-CN": "共 {value1} 个资源",
    en: "{value1} resources",
  },
  没有符合条件的资源: {
    "zh-CN": "没有符合条件的资源",
    en: "No resources match these filters",
  },
  "换个关键词或类型试试。": {
    "zh-CN": "换个关键词或类型试试。",
    en: "Try a different keyword or type.",
  },
  清除筛选: {
    "zh-CN": "清除筛选",
    en: "Clear filters",
  },
  还没有任何资源: {
    "zh-CN": "还没有任何资源",
    en: "No resources yet",
  },
  "上传图片、音视频或文档，它们会出现在这里，也能在节点中引用。": {
    "zh-CN": "上传图片、音视频或文档，它们会出现在这里，也能在节点中引用。",
    en: "Upload images, audio, video, or documents. They show up here and can be referenced from nodes.",
  },
  上传第一个文件: {
    "zh-CN": "上传第一个文件",
    en: "Upload your first file",
  },
  资源加载失败: {
    "zh-CN": "资源加载失败",
    en: "Could not load resources",
  },
  "加载资源时出错，请检查网络后重试。": {
    "zh-CN": "加载资源时出错，请检查网络后重试。",
    en: "Something went wrong while loading the library. Check your connection and try again.",
  },
  "删除节点不会删除它引用的文件；只有在这里删除，存储空间才会释放。": {
    "zh-CN": "删除节点不会删除它引用的文件；只有在这里删除，存储空间才会释放。",
    en: "Deleting a node does not delete the file it references. Storage is only freed when you delete the file here.",
  },
  重命名资源: {
    "zh-CN": "重命名资源",
    en: "Rename resource",
  },
  "给这个文件一个更好认的名字，文件本身不会改变。": {
    "zh-CN": "给这个文件一个更好认的名字，文件本身不会改变。",
    en: "Give this file an easier name. The file itself does not change.",
  },
  资源名称: {
    "zh-CN": "资源名称",
    en: "Resource name",
  },
  已重命名: {
    "zh-CN": "已重命名",
    en: "Renamed",
  },
  "重命名失败，请稍后重试。": {
    "zh-CN": "重命名失败，请稍后重试。",
    en: "Rename failed. Try again later.",
  },
  删除资源: {
    "zh-CN": "删除资源",
    en: "Delete resource",
  },
  "确定删除“{value1}”？此操作无法撤销。": {
    "zh-CN": "确定删除“{value1}”？此操作无法撤销。",
    en: "Delete “{value1}”? This cannot be undone.",
  },
  "引用这个文件的节点会失去该链接（显示为空）。删除节点不会释放存储；只有在这里删除才会释放。":
    {
      "zh-CN":
        "引用这个文件的节点会失去该链接（显示为空）。删除节点不会释放存储；只有在这里删除才会释放。",
      en: "Every node that references this file loses the link (it becomes empty). Deleting a node does not free storage; only deleting the file here does.",
    },
  此资源关联以下节点: {
    "zh-CN": "此资源关联以下节点",
    en: "This resource is referenced by these nodes",
  },
  "正在查找引用此资源的节点…": {
    "zh-CN": "正在查找引用此资源的节点…",
    en: "Finding the nodes that reference this resource…",
  },
  "删除中…": {
    "zh-CN": "删除中…",
    en: "Deleting…",
  },
  "删除失败，请稍后重试。": {
    "zh-CN": "删除失败，请稍后重试。",
    en: "Delete failed. Try again later.",
  },
  复制链接: {
    "zh-CN": "复制链接",
    en: "Copy link",
  },
  链接已复制: {
    "zh-CN": "链接已复制",
    en: "Link copied",
  },
  "复制失败，请手动复制链接。": {
    "zh-CN": "复制失败，请手动复制链接。",
    en: "Could not copy the link. Copy it manually.",
  },
  未命名文件: {
    "zh-CN": "未命名文件",
    en: "Unnamed file",
  },
  "创建于 {value1}": {
    "zh-CN": "创建于 {value1}",
    en: "Created {value1}",
  },
  "打开 {value1} 的操作菜单": {
    "zh-CN": "打开 {value1} 的操作菜单",
    en: "Open the actions menu for {value1}",
  },
  无法上传文件: {
    "zh-CN": "无法上传文件",
    en: "File not uploaded",
  },
  存储空间不足: {
    "zh-CN": "存储空间不足",
    en: "Not enough storage",
  },
  "“{value1}”超出{value2}类文件的上限（{value3}）。": {
    "zh-CN": "“{value1}”超出{value2}类文件的上限（{value3}）。",
    en: "“{value1}” is over the {value2} limit ({value3}).",
  },
  "存储空间不足：“{value1}”需要 {value2}，剩余 {value3}。": {
    "zh-CN": "存储空间不足：“{value1}”需要 {value2}，剩余 {value3}。",
    en: "Not enough storage: “{value1}” needs {value2}, with {value3} left.",
  },
  上传失败: {
    "zh-CN": "上传失败",
    en: "Upload failed",
  },
  "“{value1}”上传失败，请重试。": {
    "zh-CN": "“{value1}”上传失败，请重试。",
    en: "“{value1}” could not be uploaded. Try again.",
  },
  上传完成: {
    "zh-CN": "上传完成",
    en: "Upload finished",
  },
  "已上传 {value1} 个文件。": {
    "zh-CN": "已上传 {value1} 个文件。",
    en: "{value1} files uploaded.",
  },
  "已上传 {value1} 个文件，{value2} 个失败。": {
    "zh-CN": "已上传 {value1} 个文件，{value2} 个失败。",
    en: "{value1} files uploaded, {value2} failed.",
  },
};
