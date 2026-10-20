// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n } from "@workspace/ui/lib/i18n";

import { useDataStore } from "@workspace/store";
import { Button } from "@workspace/ui/components/ui/button";
import { NodePreviewBody } from "./node-preview-body";

export function IslandNodePreview({
  nodeId,
  onClose,
}: {
  nodeId: string;
  onClose: () => void;
}) {
  const { t } = useI18n();

  const node = useDataStore((s) => s.nodes.get(nodeId));
  if (!node)
    return (
      <div className="p-4 text-sm text-muted-foreground">
        {t("节点已不存在")}{" "}
        <Button variant="ghost" onClick={onClose}>
          {t("收起")}{" "}
        </Button>
      </div>
    );
  return <NodePreviewBody node={node} />;
}
