// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n } from "@workspace/ui/lib/i18n";

import type { RichTextNodeData } from "@workspace/interfaces";
import { Link2 } from "lucide-react";

/** A Tiptap document node, as far as a rich-text preview needs to read it. */
interface DocNode {
  text?: unknown;
  content?: unknown;
}

function extractTextContent(docs: Record<string, unknown>): string {
  if (!docs || !docs.content) return "";

  const extractText = (node: unknown): string => {
    if (!node) return "";
    if (typeof node === "string") return node;
    if (typeof node !== "object") return "";
    const record = node as DocNode;
    if (typeof record.text === "string") return record.text;
    if (Array.isArray(record.content)) {
      return record.content.map(extractText).join(" ");
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
