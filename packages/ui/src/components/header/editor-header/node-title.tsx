// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n } from "@workspace/ui/lib/i18n";

import { Input } from "@workspace/ui/components/ui/input";
import { useDataStore, useUIStore } from "@workspace/store";
import { useAttributeDraft } from "@workspace/ui/hooks/use-attribute-draft";
import { useAttributeOperation } from "@workspace/ui/hooks/use-attribute-operation";
import { titleRequest } from "@workspace/ui/lib/attribute-operations";

interface NodeTitleProps {
  className?: string;
}

export function NodeTitle({ className }: NodeTitleProps) {
  const { t } = useI18n();

  const currentEditingNodeId = useUIStore(
    (state) => state.currentEditingNodeId,
  );
  const nodes = useDataStore((state) => state.nodes);
  const applyOperation = useAttributeOperation();

  const currentNode = currentEditingNodeId
    ? nodes.get(currentEditingNodeId)
    : null;

  const title = useAttributeDraft(currentNode?.title ?? "", async (value) => {
    if (!currentEditingNodeId) return;
    await applyOperation(titleRequest(currentEditingNodeId, value));
  });

  return (
    <Input
      value={currentNode ? title.value : ""}
      onChange={(e) => title.change(e.target.value)}
      placeholder={t("未命名节点")}
      className={className}
      disabled={!currentNode}
    />
  );
}
