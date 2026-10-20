// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n } from "@workspace/ui/lib/i18n";

import { Settings2 } from "lucide-react";
import { cn } from "@workspace/ui/lib/utils";
import type { DataViewConfig, DataViewType } from "@workspace/interfaces";

import { DataViewEmptyState } from "./empty-state";

export interface DataViewConfigPlaceholderProps {
  type: DataViewType;
  config: DataViewConfig;
  readOnly?: boolean;
  className?: string;
}

/**
 * Placeholder body for every view's config editor.
 *
 * The real editors (field pickers, aggregation pickers, theme options, …) are
 * deliberately not implemented yet; each view's `config-editor.tsx` is a thin
 * wrapper that will grow into one. Until then the body shows the live config so
 * the shell's read/write path is observable. It is rendered inside the view
 * toolbar's 视图配置 popover — there is no side panel.
 */
export function DataViewConfigPlaceholder({
  type,
  config,
  readOnly,
  className,
}: DataViewConfigPlaceholderProps) {
  const { t } = useI18n();

  return (
    <div
      data-dataview-config-editor={type}
      className={cn("flex h-full min-h-0 flex-col gap-2 p-2", className)}
    >
      <DataViewEmptyState
        icon={Settings2}
        title={t("配置项尚未实现")}
        description={
          readOnly
            ? t("当前视图只读，配置不可编辑。")
            : t("该视图类型的配置项将在实现渲染器时一并落地。")
        }
      />
      <details open className="rounded-lg border border-border bg-card/40">
        <summary className="cursor-pointer px-3 py-2 text-xs text-muted-foreground">
          {t("配置数据")}{" "}
        </summary>
        <pre className="max-h-72 overflow-auto px-3 pb-3 text-[11px] leading-relaxed text-muted-foreground tabular-nums">
          {JSON.stringify(config, null, 2)}
        </pre>
      </details>
    </div>
  );
}
