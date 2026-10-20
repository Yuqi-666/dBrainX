// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { translate } from "@workspace/ui/lib/i18n/runtime";

import { useI18n } from "@workspace/ui/lib/i18n";

import type { LucideIcon } from "lucide-react";
import { cn } from "@workspace/ui/lib/utils";
import { Badge } from "@workspace/ui/components/ui/badge";
import type {
  DataViewConfig,
  DataViewSource,
  DataViewType,
} from "@workspace/interfaces";

import { DataViewEmptyState } from "./empty-state";
import { ViewConfigMenu, ViewToolbar } from "./view-toolbar";

export interface DataViewPlaceholderProps<C extends DataViewConfig> {
  type: DataViewType;
  icon: LucideIcon;
  /** Human label, e.g. "表格视图". */
  label: string;
  description: string;
  /** Libraries this view is planned to be built on (README §9.1). */
  plannedDependencies?: string[];
  source: DataViewSource;
  config: C;
  readOnly?: boolean;
  /** Absent when the host does not allow view management. */
  onConfigChange?: (config: C) => void;
  className?: string;
}

/**
 * The shared body every not-yet-implemented data view renders.
 *
 * A view becomes real by replacing its own `*-data-view.tsx` body with the
 * actual renderer (VTable, FullCalendar, VChart, …) while keeping the same
 * props contract — this placeholder exists so the shell, registry, routing and
 * host integration can be built and reviewed independently of the eight
 * heavyweight libraries the views will eventually pull in.
 *
 * It still carries a real view toolbar: config on the left (the registered
 * config editor, in a popover — there is no side panel any more), status on the
 * right, which keeps the toolbar contract identical for every view type.
 */
export function DataViewPlaceholder<C extends DataViewConfig>({
  type,
  icon: Icon,
  label,
  description,
  plannedDependencies,
  source,
  config,
  readOnly,
  onConfigChange,
  className,
}: DataViewPlaceholderProps<C>) {
  const { t } = useI18n();

  return (
    <div
      data-dataview-placeholder={type}
      className={cn("flex h-full min-h-0 w-full flex-col", className)}
    >
      <ViewToolbar
        actions={
          <>
            <Badge variant="muted" className="tabular-nums">
              {source.rows.length} {t("行 ·")} {source.fields.length}{" "}
              {t("字段")}{" "}
            </Badge>
            {readOnly && <Badge variant="outline">{t("只读")}</Badge>}
            <Badge variant="outline" className="border-dashed">
              {t("占位未实现")}{" "}
            </Badge>
          </>
        }
      >
        <ViewConfigMenu
          type={type}
          config={config}
          source={source}
          readOnly={readOnly}
          // The registry pairs each view type with its own config editor, so
          // the editor can only ever hand back this view's config shape.
          onConfigChange={
            onConfigChange as ((next: DataViewConfig) => void) | undefined
          }
        />
      </ViewToolbar>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4">
        <header className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="secondary" className="font-medium">
            {label}
          </Badge>
          <span>
            {t("数据源")} {source.kind}
          </span>
        </header>

        <DataViewEmptyState
          icon={Icon}
          title={translate("{value1}尚未实现", { value1: label })}
          description={description}
        />

        {plannedDependencies && plannedDependencies.length > 0 && (
          <div className="mx-auto flex max-w-xl flex-wrap justify-center gap-1.5">
            {plannedDependencies.map((dependency) => (
              <code
                key={dependency}
                className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
              >
                {dependency}
              </code>
            ))}
          </div>
        )}

        <details className="rounded-lg border border-border bg-card/40">
          <summary className="cursor-pointer px-3 py-2 text-xs text-muted-foreground">
            {t("当前视图配置（只读预览）")}{" "}
          </summary>
          <pre className="max-h-64 overflow-auto px-3 pb-3 text-[11px] leading-relaxed text-muted-foreground">
            {JSON.stringify(config, null, 2)}
          </pre>
        </details>
      </div>
    </div>
  );
}
