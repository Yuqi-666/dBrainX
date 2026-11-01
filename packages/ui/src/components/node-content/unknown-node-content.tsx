// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import type { NodeContentViewProps } from "@workspace/plugin-sdk/ui";
import { translate } from "@workspace/ui/lib/i18n/runtime";
import { cn } from "@workspace/ui/lib/utils";

/** Longest content summary the fallback prints, in characters. */
const SUMMARY_LIMIT = 480;

/**
 * A JSON summary that cannot break the page.
 *
 * The payload comes from persisted (or plugin-written) node content, so it may
 * be cyclic, may hold a throwing getter, or may be megabytes wide. A thrown
 * `JSON.stringify` would take the whole route down, so this catches it, replaces
 * cycles and bigints with readable markers, and truncates the result.
 */
export function summarizeNodeContent(
  value: unknown,
  limit: number = SUMMARY_LIMIT,
): string {
  if (value === undefined) return "undefined";
  const seen = new WeakSet<object>();
  try {
    const text = JSON.stringify(value, (_key, item: unknown) => {
      if (typeof item === "bigint") return `${item.toString()}n`;
      if (typeof item === "object" && item !== null) {
        if (seen.has(item)) return "[Circular]";
        seen.add(item);
      }
      return item;
    });
    if (text === undefined) return String(value);
    return text.length > limit ? `${text.slice(0, limit)}…` : text;
  } catch (error) {
    return `[unserializable: ${error instanceof Error ? error.message : String(error)}]`;
  }
}

/**
 * Renders a node whose type has no registered descriptor: a type name and a
 * bounded JSON summary of the content.
 *
 * The host uses this for three cases — a type no installed plugin contributes, a
 * descriptor whose lazy chunk fails to load, and a descriptor component that
 * throws. All three must leave readable content on screen rather than a blank
 * page, and none of them may edit the node.
 */
export function UnknownNodeContent({ node, className }: NodeContentViewProps) {
  const nodeType = (node as { nodeType?: string } | undefined)?.nodeType;
  const content = (node as { content?: unknown } | undefined)?.content;
  const label = nodeType && nodeType.length > 0 ? nodeType : translate("未知");

  return (
    <div
      data-node-content-fallback=""
      className={cn(
        "flex flex-col gap-2 p-4 text-sm text-muted-foreground",
        className,
      )}
    >
      <p>
        {translate("Unsupported node type:")}{" "}
        <span
          data-node-content-fallback-type=""
          className="font-medium text-foreground"
        >
          {label}
        </span>
      </p>
      <pre
        data-node-content-fallback-summary=""
        className="max-h-40 overflow-auto rounded-md bg-muted/40 p-2 font-mono text-xs break-words whitespace-pre-wrap"
      >
        {summarizeNodeContent(content)}
      </pre>
    </div>
  );
}
