// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Interface copy of the node disposition dialog (delete or clear a node, and
 * decide what happens to the uploaded files it references).
 *
 * Kept in its own module so the shared catalog file stays a merge-free region
 * while this feature is written; `messages.ts` spreads it into the one map
 * `translate` reads. Every key must carry both languages and the same
 * `{placeholder}` names, which `runtime.test.ts` checks.
 *
 * Delete/clear generic copy (`删除节点`, `确定删除“{value1}”？此操作无法撤销。`,
 * `取消`, `删除`, `已删除`, …) stays in the shared catalog and is translated
 * through it; only copy this feature introduces lives here.
 */
export const nodeDispositionMessages: Record<
  string,
  { "zh-CN": string; en: string }
> = {
  清空节点: {
    "zh-CN": "清空节点",
    en: "Clear node",
  },
  "确定清空“{value1}”？此操作无法撤销。": {
    "zh-CN": "确定清空“{value1}”？此操作无法撤销。",
    en: "Clear “{value1}”? This cannot be undone.",
  },
  "这个节点引用了以下已上传资源：": {
    "zh-CN": "这个节点引用了以下已上传资源：",
    en: "This node references these uploaded resources:",
  },
  "没有找到引用的已上传资源。": {
    "zh-CN": "没有找到引用的已上传资源。",
    en: "No referenced uploaded resources were found.",
  },
  "其中 {value1} 个资源还被其他节点引用，那些节点里的链接会一并清空。": {
    "zh-CN":
      "其中 {value1} 个资源还被其他节点引用，那些节点里的链接会一并清空。",
    en: "{value1} of these resources are also referenced by other nodes; those links will be cleared as well.",
  },
  仅删除节点: {
    "zh-CN": "仅删除节点",
    en: "Delete the node only",
  },
  仅清空节点: {
    "zh-CN": "仅清空节点",
    en: "Clear the node only",
  },
  "保留已上传的文件，之后仍可在资源库中使用。": {
    "zh-CN": "保留已上传的文件，之后仍可在资源库中使用。",
    en: "Keep the uploaded files; they stay available in the resource library.",
  },
  同时删除已上传资源: {
    "zh-CN": "同时删除已上传资源",
    en: "Delete the uploaded resources too",
  },
  "文件会从资源库和存储中删除，无法恢复。": {
    "zh-CN": "文件会从资源库和存储中删除，无法恢复。",
    en: "The files are deleted from the resource library and storage. This cannot be undone.",
  },
  "清空中…": {
    "zh-CN": "清空中…",
    en: "Clearing…",
  },
  节点已清空: {
    "zh-CN": "节点已清空",
    en: "Node cleared",
  },
  "部分资源删除失败，请稍后重试。": {
    "zh-CN": "部分资源删除失败，请稍后重试。",
    en: "Some resources could not be deleted. Please try again later.",
  },
  "清空失败，请稍后重试。": {
    "zh-CN": "清空失败，请稍后重试。",
    en: "Clear failed. Please try again later.",
  },
};
