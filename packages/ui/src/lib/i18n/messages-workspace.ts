// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Interface copy of the workspace edit and delete dialogs plus the workspace
 * actions menu.
 *
 * Kept in its own module so the shared catalog file stays a merge-free region
 * while this feature is written; `messages.ts` spreads it into the one map
 * `translate` reads. Every key must carry both languages and the same
 * `{placeholder}` names, which `runtime.test.ts` checks.
 *
 * Generic copy (`重命名`, `删除`, `取消`, `保存`, `保存中…`, `名称`, `已删除`)
 * stays in the shared catalog and is translated through it; only copy this
 * feature introduces lives here.
 */
export const workspaceMessages: Record<
  string,
  { "zh-CN": string; en: string }
> = {
  工作区操作: {
    "zh-CN": "工作区操作",
    en: "Workspace actions",
  },
  编辑工作区: {
    "zh-CN": "编辑工作区",
    en: "Edit workspace",
  },
  "修改工作区的名称和图标。": {
    "zh-CN": "修改工作区的名称和图标。",
    en: "Change the workspace's name and icon.",
  },
  已更新工作区: {
    "zh-CN": "已更新工作区",
    en: "Workspace updated",
  },
  "更新工作区失败，请稍后重试。": {
    "zh-CN": "更新工作区失败，请稍后重试。",
    en: "Update failed. Try again later.",
  },
  删除工作区: {
    "zh-CN": "删除工作区",
    en: "Delete workspace",
  },
  "确定删除“{value1}”？工作区中的节点、关系、视图、语义和 Dashboard 页面会一并删除，且无法撤销。":
    {
      "zh-CN":
        "确定删除“{value1}”？工作区中的节点、关系、视图、语义和 Dashboard 页面会一并删除，且无法撤销。",
      en: "Delete “{value1}”? The workspace's nodes, relations, views, semantics, and Dashboard pages are deleted with it. This cannot be undone.",
    },
  "资源库中已上传的文件不会被删除。": {
    "zh-CN": "资源库中已上传的文件不会被删除。",
    en: "Uploaded files in the resource library are not deleted.",
  },
  // The stored name of the auto-provisioned default workspace. The interface
  // shows this translation while the default keeps its canonical name.
  默认工作区: {
    "zh-CN": "默认工作区",
    en: "Default workspace",
  },
  "删除中…": {
    "zh-CN": "删除中…",
    en: "Deleting…",
  },
  已删除工作区: {
    "zh-CN": "已删除工作区",
    en: "Workspace deleted",
  },
  "删除工作区失败，请稍后重试。": {
    "zh-CN": "删除工作区失败，请稍后重试。",
    en: "Delete failed. Try again later.",
  },
};
