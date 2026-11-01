// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n } from "@workspace/ui/lib/i18n";

import type { CollectionNodeData } from "@workspace/interfaces";
import { Filter } from "lucide-react";

export function CollectionPreview({ node }: { node: CollectionNodeData }) {
  const { t } = useI18n();

  const filter = node.content?.filterConfig;
  return (
    <div className="space-y-2 text-xs text-muted-foreground">
      <p>
        {filter?.selectedNodes?.length ?? 0} {t("个已选节点")}
      </p>
      {filter?.ruleGroup && (
        <p className="flex items-center gap-2">
          <Filter className="size-3.5" />
          {t("按条件筛选")}{" "}
        </p>
      )}
    </div>
  );
}
