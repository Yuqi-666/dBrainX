// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n } from "@workspace/ui/lib/i18n";

import { useDataStore } from "@workspace/store";
import type { NodeData } from "@workspace/interfaces";
import { FileText } from "lucide-react";
import { IconView } from "@workspace/ui/components/icon/icon-view";
import { NODE_TYPE_ICONS } from "@workspace/ui/components/icon/node-type-icons";

export function PreviewHeader({ node }: { node: NodeData }) {
  const { t } = useI18n();

  const nodeSemantics = useDataStore((state) => state.nodeSemantics);
  const semantic = nodeSemantics.get(node.semanticId);
  const Icon = NODE_TYPE_ICONS[node.nodeType] ?? FileText;

  return (
    <div className="px-4 pt-4 pb-2 pr-12">
      <div className="flex items-start gap-2">
        <IconView
          icon={node.icon ?? undefined}
          fallback={<Icon className="size-4 text-muted-foreground" />}
          className="mt-0.5 size-4 shrink-0 text-muted-foreground"
        />
        <div className="min-w-0 flex-1">
          <h3 className="line-clamp-2 text-sm font-medium leading-snug">
            {node.title || t("未命名节点")}
          </h3>
          {semantic && (
            <p className="mt-1 truncate text-xs text-muted-foreground">
              {semantic.name}
            </p>
          )}
        </div>
      </div>
      {node.abstract && (
        <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
          {node.abstract}
        </p>
      )}
    </div>
  );
}
