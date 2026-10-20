// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n } from "@workspace/ui/lib/i18n";

import type { RichTextNodeData } from "@workspace/interfaces";
import { Link2 } from "lucide-react";

function extractTextContent(docs: Record<string, any>): string {
  if (!docs || !docs.content) return "";

  const extractText = (node: any): string => {
    if (!node) return "";
    if (typeof node === "string") return node;
    if (node.text) return node.text;
    if (node.content && Array.isArray(node.content)) {
      return node.content.map(extractText).join(" ");
    }
    return "";
  };

  return extractText(docs);
}

export function RichTextPreview({ node }: { node: RichTextNodeData }) {
  const { t } = useI18n();

  const docsText = node.content?.docs
    ? extractTextContent(node.content.docs)
    : "";
  const previewText =
    docsText.slice(0, 150) + (docsText.length > 150 ? "..." : "");
  const referencedCount = node.content?.referencedNodes?.length || 0;

  return (
    <div className="space-y-2">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm text-foreground leading-relaxed line-clamp-5">
            {previewText || t("暂无内容")}
          </p>
        </div>
      </div>
      {referencedCount > 0 && (
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Link2 className="size-3.5" />
          <span>
            {referencedCount} {t("referenced nodes")}
          </span>
        </div>
      )}
    </div>
  );
}
