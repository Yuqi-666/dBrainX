// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n } from "@workspace/ui/lib/i18n";

import type { TextNodeData } from "@workspace/interfaces";

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

export function TextPreview({ node }: { node: TextNodeData }) {
  const { t } = useI18n();

  const content = node.content?.docs
    ? extractTextContent(node.content.docs)
    : "";
  const previewText =
    content.slice(0, 150) + (content.length > 150 ? "..." : "");

  return (
    <div className="flex items-start gap-2">
      <div className="min-w-0 flex-1">
        <p className="text-sm text-foreground leading-relaxed line-clamp-5">
          {previewText || t("暂无内容")}
        </p>
      </div>
    </div>
  );
}
