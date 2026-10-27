// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { buildNodeFilterFields } from "@workspace/ui/lib/node-filter-fields";
import { useI18n, useLocaleMemo } from "@workspace/ui/lib/i18n";

import { useCallback, useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/ui/dialog";
import { Button } from "@workspace/ui/components/ui/button";
import { Input } from "@workspace/ui/components/ui/input";
import { Label } from "@workspace/ui/components/ui/label";
import { FilterQueryBuilder } from "@workspace/ui/components/filter/filter";
import { NodeSelectionList } from "./node-selection-list";
import { useDataStore, useUIStore, useWorkspaceStore } from "@workspace/store";
import { ViewService } from "@workspace/services";
import {
  type FilterConfig,
  type NodeData,
  type NodeId,
  type NodeSemantic,
  type NodeSemanticId,
  type View,
} from "@workspace/interfaces";
import type { RuleGroupType } from "@workspace/utils";

const VIEW_NAME_MAX_LENGTH = 50;

/** 新建视图的默认类型，与视图配置面板的选项保持一致。 */
const DEFAULT_VIEW_TYPE = "Force" as const;

const EMPTY_RULE_GROUP: RuleGroupType = { combinator: "and", rules: [] };

/**
 * 创建 / 编辑 view 的 dialog。
 *
 * 与 `CreateWorkspaceDialog` / `NodeSemanticDialog` 同模式：开合状态与编辑目标
 * 读自 `useUIStore.viewDialog`，service 调用内联在本组件里，页面级挂载。任何入口
 * 调用 `openViewCreateDialog()` 打开新建，调用 `openViewEditDialog(view)` 打开编辑。
 *
 * 两种模式共用同一套表单（名称、节点选择、筛选条件），只是初始值不同：编辑时用
 * `editingView` 回填，提交走 `ViewService.upsert(id, patch)`，因此 `viewType` /
 * `visualConfig` / `isPinned` 等本表单不涉及的字段会被保留。
 *
 * 表单包含三部分：名称、节点选择（写入 `filterConfig.selectedNodes`）、
 * 筛选条件（写入 `filterConfig.ruleGroup`）。后两者是"并集"语义——视图显示
 * 已勾选节点 ∪ 命中筛选条件的节点；两者都为空则为全局视图，显示全部节点。
 */
export function ViewDialog() {
  useI18n();

  const { open, editingView } = useUIStore((state) => state.viewDialog);
  const closeDialog = useUIStore((state) => state.closeViewDialog);
  const setCurrentViewId = useUIStore((state) => state.setCurrentViewId);
  const nodes = useDataStore((state) => state.nodes);
  const nodeSemantics = useDataStore((state) => state.nodeSemantics);

  const handleSubmit = useCallback(
    async (input: ViewDialogInput) => {
      if (editingView) {
        // 局部更新：service 会与 store 中的当前视图合并，未提交的字段保持不变。
        await ViewService.upsert(editingView.id, {
          name: input.name.trim(),
          filterConfig: input.filterConfig,
        });
        closeDialog();
        return;
      }

      const workspaceId =
        useWorkspaceStore.getState().currentWorkspaceId ?? undefined;

      const view: View = {
        id: `tmp_${crypto.randomUUID()}`,
        name: input.name.trim(),
        viewType: DEFAULT_VIEW_TYPE,
        visualConfig: {},
        filterConfig: input.filterConfig,
        workspaceId,
      };

      const created = await ViewService.upsert(view);
      const createdView = (created ?? view) as View;
      // 新视图立即可用：切到它，Graph 会按它的 filterConfig 重新过滤。
      setCurrentViewId(createdView.id);
      closeDialog();
    },
    [editingView, closeDialog, setCurrentViewId],
  );

  return (
    <ViewDialogContent
      open={open}
      onOpenChange={(o) => !o && closeDialog()}
      editingView={editingView}
      nodes={nodes}
      nodeSemantics={nodeSemantics}
      onSubmit={handleSubmit}
    />
  );
}

export interface ViewDialogInput {
  name: string;
  filterConfig: FilterConfig;
}

export interface ViewDialogContentProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 编辑目标；为 null 时表示新建视图。 */
  editingView: View | null;
  /** 当前 workspace 的节点，用于"节点选择"列表。 */
  nodes: ReadonlyMap<NodeId, NodeData>;
  /** 用于构建筛选字段（语义类型下拉的选项）。 */
  nodeSemantics: ReadonlyMap<NodeSemanticId, NodeSemantic>;
  onSubmit: (input: ViewDialogInput) => void | Promise<void>;
}

export function ViewDialogContent({
  open,
  onOpenChange,
  editingView,
  nodes,
  nodeSemantics,
  onSubmit,
}: ViewDialogContentProps) {
  const { t } = useI18n();

  const isEditing = editingView !== null;
  const [name, setName] = useState("");
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<NodeId>>(
    new Set(),
  );
  const [ruleGroup, setRuleGroup] = useState<RuleGroupType>(EMPTY_RULE_GROUP);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 每次打开（或切换编辑目标）都用编辑对象回填表单，避免上一次的输入/错误残留。
  useEffect(() => {
    if (!open) return;
    setName(editingView?.name ?? "");
    setSelectedNodeIds(new Set(editingView?.filterConfig?.selectedNodes ?? []));
    setRuleGroup(editingView?.filterConfig?.ruleGroup ?? EMPTY_RULE_GROUP);
    setIsSubmitting(false);
    setError(null);
  }, [open, editingView]);

  const filterFields = useLocaleMemo(
    () => buildNodeFilterFields(nodeSemantics),
    [nodeSemantics],
  );

  const hasRules = (ruleGroup.rules?.length ?? 0) > 0;

  /**
   * 只在非空时写入字段：`filterByViewFilterConfig` 把"无 selectedNodes 且无
   * ruleGroup"判定为全局视图，写入空数组 / 空 ruleGroup 会破坏这个语义。
   */
  const buildFilterConfig = useCallback((): FilterConfig => {
    const filterConfig: FilterConfig = {};
    if (selectedNodeIds.size > 0) {
      filterConfig.selectedNodes = Array.from(selectedNodeIds);
    }
    if (hasRules) {
      filterConfig.ruleGroup = ruleGroup;
    }
    return filterConfig;
  }, [selectedNodeIds, hasRules, ruleGroup]);

  const handleSubmit = useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError(t("请输入视图名称"));
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      await onSubmit({ name: trimmed, filterConfig: buildFilterConfig() });
      onOpenChange(false);
    } catch (err) {
      console.error("Failed to save view:", err);
      setError(
        isEditing ? t("保存失败，请稍后重试") : t("创建失败，请稍后重试"),
      );
    } finally {
      setIsSubmitting(false);
    }
  }, [name, buildFilterConfig, onSubmit, onOpenChange, isEditing, t]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? t("编辑视图") : t("创建新视图")}
          </DialogTitle>
          <DialogDescription>
            {isEditing
              ? t("修改视图名称与筛选配置，保存后立即生效。")
              : t("视图按筛选配置决定显示哪些节点，可随时在侧边栏切换。")}
          </DialogDescription>
        </DialogHeader>

        {/*
          这里刻意不使用 <form>：内嵌的 react-querybuilder 控件（Add Rule /
          Remove 等）是未指定 type 的 <button>，在 form 内会隐式成为 submit，
          点击即触发创建。名称输入框单独处理 Enter 键提交。
        */}
        <div className="flex flex-col gap-5 py-2">
          <div className="grid gap-2">
            <Label htmlFor="view-name">{t("名称")}</Label>
            <Input
              id="view-name"
              name="name"
              autoFocus
              value={name}
              maxLength={VIEW_NAME_MAX_LENGTH}
              placeholder={t("例如：待办事项")}
              disabled={isSubmitting}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void handleSubmit();
                }
              }}
              onChange={(event) => {
                setName(event.target.value);
                if (error) setError(null);
              }}
            />
          </div>

          <NodeSelectionList
            idPrefix="view-node"
            nodes={nodes}
            nodeSemantics={nodeSemantics}
            selectedNodeIds={selectedNodeIds}
            disabled={isSubmitting}
            onChange={setSelectedNodeIds}
          />

          <div className="grid gap-2">
            <Label>{t("筛选条件")}</Label>
            <FilterQueryBuilder
              fields={filterFields}
              query={ruleGroup}
              onQueryChange={setRuleGroup}
            />
          </div>

          <p className="text-xs text-muted-foreground">
            {t(
              "视图显示「已勾选节点」与「命中筛选条件的节点」的并集；两者都为空时显示全部节点。",
            )}{" "}
          </p>

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={isSubmitting}
            onClick={() => onOpenChange(false)}
          >
            {t("取消")}{" "}
          </Button>
          <Button
            type="button"
            disabled={isSubmitting || !name.trim()}
            onClick={() => void handleSubmit()}
          >
            {isSubmitting
              ? isEditing
                ? t("保存中…")
                : t("创建中…")
              : isEditing
                ? t("保存")
                : t("创建")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
