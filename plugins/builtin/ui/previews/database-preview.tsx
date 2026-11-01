// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n } from "@workspace/ui/lib/i18n";

import type {
  DatabaseCell,
  DatabaseField,
  DatabaseNodeData,
} from "@workspace/interfaces";
import { useDataStore } from "@workspace/store";

/** How many records the compact hover preview shows. */
const PREVIEW_ROW_LIMIT = 5;

/**
 * Flattens a cell to display text. `relation` cells hold soft `NodeId`
 * references, so they are resolved to the referenced node's title and fall back
 * to the raw id when the target is missing from the store.
 */
function cellText(
  cell: DatabaseCell | undefined,
  field: DatabaseField,
  nodeTitle: (nodeId: string) => string | undefined,
): string {
  if (!cell) return "";

  switch (cell.type) {
    case "text":
      return cell.text;
    case "number":
      return cell.number === null ? "" : String(cell.number);
    case "select": {
      if (cell.optionId === null) return "";
      const option = field.options?.find((o) => o.id === cell.optionId);
      return option?.name ?? cell.optionId;
    }
    case "multiSelect":
      return cell.optionIds
        .map((id) => field.options?.find((o) => o.id === id)?.name ?? id)
        .join(", ");
    case "date":
      return cell.date ?? "";
    case "checkbox":
      return cell.checked ? "✓" : "";
    case "url":
      return cell.url ?? "";
    case "relation":
      return cell.nodeIds.map((id) => nodeTitle(id) ?? id).join(", ");
  }
}

export function DatabasePreview({ node }: { node: DatabaseNodeData }) {
  const { t } = useI18n();

  const nodes = useDataStore((state) => state.nodes);
  const fields = node.content?.fields ?? [];
  const rows = node.content?.rows ?? [];
  const visibleRows = rows.slice(0, PREVIEW_ROW_LIMIT);

  if (fields.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        {rows.length} {t("条记录 · 暂无字段")}{" "}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="bg-muted/60">
              {fields.map((field) => (
                <th
                  key={field.id}
                  className="border-b px-2 py-1 text-left font-medium whitespace-nowrap text-muted-foreground"
                >
                  {field.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => (
              <tr key={row.id} className="border-b last:border-b-0">
                {fields.map((field) => {
                  const text = cellText(
                    row.cells[field.id],
                    field,
                    (nodeId) => nodes.get(nodeId)?.title,
                  );
                  return (
                    <td
                      key={field.id}
                      className="max-w-[140px] truncate px-2 py-1"
                    >
                      {text || <span className="text-muted-foreground">—</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {visibleRows.length === 0 && (
        <p className="text-xs text-muted-foreground">{t("No records yet")}</p>
      )}
      <p className="text-xs text-muted-foreground">
        {fields.length} {t("fields ·")} {rows.length} {t("records")}{" "}
      </p>
    </div>
  );
}
