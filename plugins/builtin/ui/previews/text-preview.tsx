// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n } from "@workspace/ui/lib/i18n";

import type { TextNodeData } from "@workspace/interfaces";

/** A Tiptap document node, as far as a text preview needs to read it. */
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
