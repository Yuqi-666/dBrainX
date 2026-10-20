// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Interface copy of the resource selector and the drop zone's 「从资源库选择」
 * method card.
 *
 * Kept in its own module so the shared catalog file stays a merge-free region;
 * `messages.ts` spreads it into the one map `translate` reads. Every key must
 * carry both languages and the same `{placeholder}` names, which
 * `runtime.test.ts` checks.
 */
export const resourceSelectorMessages: Record<
  string,
  { "zh-CN": string; en: string }
> = {
  从资源库选择: {
    "zh-CN": "从资源库选择",
    en: "Select from library",
  },
  "选择已上传的资源，节点会引用该文件。": {
    "zh-CN": "选择已上传的资源，节点会引用该文件。",
    en: "Choose a file you already uploaded. The node will reference it.",
  },
  "搜索资源名称…": {
    "zh-CN": "搜索资源名称…",
    en: "Search resources…",
  },
  按分类筛选: {
    "zh-CN": "按分类筛选",
    en: "Filter by category",
  },
  其他: {
    "zh-CN": "其他",
    en: "Other",
  },
  PDF: {
    "zh-CN": "PDF",
    en: "PDF",
  },
  共享: {
    "zh-CN": "共享",
    en: "Shared",
  },
  资源库还是空的: {
    "zh-CN": "资源库还是空的",
    en: "The resource library is empty",
  },
  "先上传文件，之后就能在这里直接引用。": {
    "zh-CN": "先上传文件，之后就能在这里直接引用。",
    en: "Upload a file first, then reference it here.",
  },
  没有匹配的资源: {
    "zh-CN": "没有匹配的资源",
    en: "No matching resources",
  },
  资源库加载失败: {
    "zh-CN": "资源库加载失败",
    en: "Could not load the resource library",
  },
  "正在加载资源…": {
    "zh-CN": "正在加载资源…",
    en: "Loading resources…",
  },
  "正在应用资源…": {
    "zh-CN": "正在应用资源…",
    en: "Applying resource…",
  },
  引用资源失败: {
    "zh-CN": "引用资源失败",
    en: "Failed to reference the resource",
  },
};
