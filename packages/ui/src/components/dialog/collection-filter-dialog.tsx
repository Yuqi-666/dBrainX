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
import { Label } from "@workspace/ui/components/ui/label";
import { FilterQueryBuilder } from "@workspace/ui/components/filter/filter";
import { NodeSelectionList } from "./node-selection-list";
import {
  type FilterConfig,
  type NodeData,
  type NodeId,
  type NodeSemantic,
  type NodeSemanticId,
} from "@workspace/interfaces";
import type { RuleGroupType } from "@workspace/utils";

const EMPTY_RULE_GROUP: RuleGroupType = { combinator: "and", rules: [] };

export interface CollectionFilterDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * The collection's current filter — the form is seeded from it on every open,
   * and the result is **merged into it**, because `filterConfig` carries keys
   * this dialog does not own (`collectionType`, written by the attributes
   * sidebar).
   */
  filterConfig: FilterConfig | undefined;
  /** The workspace's nodes, listed by 节点选择. */
  nodes: ReadonlyMap<NodeId, NodeData>;
  /** The rule builder's 语义类型 options. */
  nodeSemantics: ReadonlyMap<NodeSemanticId, NodeSemantic>;
  onSubmit: (filterConfig: FilterConfig) => void | Promise<void>;
}

/**
 * The **collection node's** filter editor — what a `collection` projects.
 *
 * A collection is `filter(workspace)`: the nodes picked in 节点选择 **plus** the
 * nodes matching 筛选条件, and everything when both are empty
 * (`filterByViewFilterConfig`, README §4.2). This dialog is the one editor for
 * that config, and it is the **host's**: `collection-node-content.tsx` renders it
 * from its own 编辑过滤 entry and writes the result into the node content it
 * owns. No data view knows about it — a view renders the filtered projection.
 *
 * It deliberately has **no name field**: this is not a view (that is
 * `view-dialog.tsx`, which edits a workspace `View` and therefore also names
 * it). The 节点选择 list is the same picker that dialog draws, over the same
 * store data — kept local rather than shared because the two dialogs write
 * different aggregates.
 */
export function CollectionFilterDialog({
  open,
  onOpenChange,
  filterConfig,
  nodes,
  nodeSemantics,
  onSubmit,
}: CollectionFilterDialogProps) {
  const { t } = useI18n();

  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<NodeId>>(
    new Set(),
  );
  const [ruleGroup, setRuleGroup] = useState<RuleGroupType>(EMPTY_RULE_GROUP);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Every open (re)seeds the form from the live config, so a cancelled edit or
  // another writer's change never leaks into the next session.
  useEffect(() => {
    if (!open) return;
    setSelectedNodeIds(new Set(filterConfig?.selectedNodes ?? []));
    setRuleGroup(filterConfig?.ruleGroup ?? EMPTY_RULE_GROUP);
    setIsSubmitting(false);
    setError(null);
  }, [open, filterConfig]);

  const filterFields = useLocaleMemo(
    () => buildNodeFilterFields(nodeSemantics),
    [nodeSemantics],
  );

  const hasRules = (ruleGroup.rules?.length ?? 0) > 0;

  /**
   * The merge, and why empty is a *deletion*: `filterByViewFilterConfig` treats
   * "no enumeration and no rule" as "the whole workspace", so writing `[]` / an
   * empty rule group instead of removing the keys would change the meaning.
   * Keys this dialog does not own (`collectionType`) are passed through.
   */
  const buildFilterConfig = useCallback((): FilterConfig => {
    const next: FilterConfig = { ...filterConfig };
    if (selectedNodeIds.size > 0) {
      next.selectedNodes = Array.from(selectedNodeIds);
    } else {
      delete next.selectedNodes;
    }
    if (hasRules) {
      next.ruleGroup = ruleGroup;
    } else {
      delete next.ruleGroup;
    }
    return next;
  }, [filterConfig, selectedNodeIds, hasRules, ruleGroup]);

  const handleSubmit = useCallback(async () => {
    setIsSubmitting(true);
    setError(null);
    try {
      await onSubmit(buildFilterConfig());
      onOpenChange(false);
    } catch (submitError) {
      console.error("Failed to save collection filter:", submitError);
      setError(t("保存失败，请稍后重试"));
    } finally {
      setIsSubmitting(false);
    }
  }, [buildFilterConfig, onSubmit, onOpenChange, t]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("编辑过滤")}</DialogTitle>
          <DialogDescription>
            {t(
              "这个 collection 显示「已勾选节点」与「命中筛选条件的节点」的并集； 两者都为空时显示全部节点。",
            )}{" "}
          </DialogDescription>
        </DialogHeader>

        {/*
          Deliberately not a <form>: react-querybuilder's Add Rule / Remove
          controls are untyped <button>s that would become the implicit submit.
        */}
        <div className="flex flex-col gap-5 py-2">
          <NodeSelectionList
            idPrefix="collection-filter-node"
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
            disabled={isSubmitting}
            onClick={() => void handleSubmit()}
          >
            {isSubmitting ? t("保存中…") : t("保存")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
