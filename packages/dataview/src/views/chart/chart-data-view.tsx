// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { translate } from "@workspace/ui/lib/i18n/runtime";
import { useI18n, useLocaleMemo } from "@workspace/ui/lib/i18n";

/**
 * Chart data view — rows aggregated into a statistical picture (chart.md).
 *
 * The shell owns four things and nothing else:
 *
 * - **the encoding**, resolved against the *live* schema every render
 *   (`core/config.ts`), so a deleted field degrades into guidance instead of a
 *   crash and the toolbar always shows the field a role currently means;
 * - **the data**: the rows are aggregated once, by the one shape the active type
 *   declares (`core/schema.ts`), and the finished set is handed to the spec
 *   builder — the chart never reads a cell itself;
 * - **the interactions**: a click encodes 不响应 / 下钻筛选 / 打开记录. 下钻 is
 *   view-local (the chart re-aggregates the clicked slice and the toolbar shows
 *   the chip that clears it); 打开记录 goes out through the shared record
 *   surface, exactly like every other view (`useRecordActions().openRecord`);
 * - **the readout** for the single-value types, whose canvas has no text mark
 *   (see `board/chart-readout.tsx`).
 *
 * The chart writes nothing: there is no cell editing here, so `onCellChange` /
 * `onRowInsert` / `onRowReorder` are not part of its contract.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import { ChartPie } from "lucide-react";
import { cn } from "@workspace/ui/lib/utils";
import type { IVChart } from "@visactor/vchart";
import type { DatabaseField } from "@workspace/interfaces";

import { DataViewEmptyState } from "../../shared/empty-state";
import { useRecordActions } from "../../shared/record-actions";
import { useDataViewThemeTokens } from "../../shared/theme-tokens";
import type {
  ChartViewConfig,
  DataViewRendererProps,
} from "../../source/types";
import { ChartSurface } from "./board/chart-surface";
import { ChartValueReadout } from "./board/chart-readout";
import {
  resolveChartFields,
  resolveChartType,
  resolveFlowFields,
  resolveHierarchyFields,
  resolveXYMeasures,
} from "./core/config";
import {
  buildHierarchyData,
  buildSankeyData,
  buildScatterData,
  buildSeriesData,
  buildSingleData,
  type ChartDrill,
} from "./core/schema";
import { buildChartSpec, type ChartBuiltData } from "./core/spec";
import { buildChartTheme } from "./core/theme";
import { ChartToolbar } from "./toolbar/chart-toolbar";

/** The built data, plus the two things derived from it that the shell needs. */
interface ChartBundle {
  built: ChartBuiltData;
  /**
   * What the surface is keyed on: the *structure* (type + encoding), never the
   * data. A row change must update the live instance; a type or field change
   * remounts it, because morphing between unrelated chart types is not
   * something the library promises.
   */
  structureKey: string;
  /** The fields this chart draws from — everything else is 隐藏字段. */
  shownFieldIds: string[];
}

/** The readout state, remembered per structure so a stale value cannot persist. */
interface DrillState {
  signature: string;
  drill: ChartDrill;
}

export function ChartDataView({
  source,
  config,
  onConfigChange,
  onFieldsChange,
  resolveNodeTitle,
  className,
}: DataViewRendererProps<ChartViewConfig>) {
  useI18n();

  const tokens = useDataViewThemeTokens(config.theme);
  const theme = useMemo(() => buildChartTheme(tokens), [tokens]);

  /**
   * The host may pass `resolveNodeTitle` as a fresh closure on every render; the
   * aggregation memo below must not depend on its identity, or every unrelated
   * re-render would walk the whole table again to resolve `relation` labels.
   */
  const resolveNodeTitleRef = useRef(resolveNodeTitle);
  resolveNodeTitleRef.current = resolveNodeTitle;
  const lookupNodeTitle = useCallback(
    (nodeId: string) => resolveNodeTitleRef.current?.(nodeId),
    [],
  );

  const meta = useMemo(
    () => resolveChartType(config.chartType),
    [config.chartType],
  );
  const resolved = useLocaleMemo(
    () => resolveChartFields(source, meta, config),
    [source, meta, config],
  );
  const xy = useMemo(
    () => resolveXYMeasures(source.fields, config.xMeasure, config.yMeasure),
    [source.fields, config.xMeasure, config.yMeasure],
  );
  const flow = useMemo(
    () =>
      resolveFlowFields(source.fields, config.sourceField, config.targetField),
    [source.fields, config.sourceField, config.targetField],
  );
  const levels = useMemo(
    () =>
      resolveHierarchyFields(
        source.fields,
        config.hierarchyFields,
        resolved.dimension,
      ),
    [source.fields, config.hierarchyFields, resolved.dimension],
  );

  /** A drill belongs to the encoding it was taken from, not to the view. */
  const drillSignature = [
    meta.id,
    resolved.dimension?.id ?? "",
    resolved.series?.id ?? "",
    config.xMeasure ?? "",
    config.yMeasure ?? "",
    levels.map((field) => field.id).join(","),
  ].join("|");
  const [drillState, setDrillState] = useState<DrillState | null>(null);
  const drill =
    drillState?.signature === drillSignature ? drillState.drill : null;

  const recordActions = useRecordActions();
  const instanceRef = useRef<IVChart | null>(null);

  const bundle = useLocaleMemo<ChartBundle | null>(() => {
    const measures = resolved.measures;
    const shownFieldIds = new Set<string>();
    const mark = (field: DatabaseField | null | undefined) => {
      if (field) shownFieldIds.add(field.id);
    };
    mark(resolved.dimension);
    mark(resolved.series);
    mark(xy.x);
    mark(xy.y);
    mark(flow.source);
    mark(flow.target);
    for (const level of levels) shownFieldIds.add(level.id);
    for (const measure of measures) mark(measure.field);

    const activeDrill = drill;
    switch (meta.shape) {
      case "cartesian":
      case "polar":
      case "heatmap": {
        const data = buildSeriesData(
          source,
          meta,
          config,
          resolved,
          activeDrill,
          lookupNodeTitle,
        );
        return {
          built: { shape: "series", data },
          structureKey: [
            meta.id,
            data.dimensionKey,
            data.seriesKey,
            data.valueKey,
            data.measureKeys.join(","),
          ].join("|"),
          shownFieldIds: [...shownFieldIds],
        };
      }
      case "wordCloud": {
        const data = buildSeriesData(
          source,
          meta,
          config,
          resolved,
          activeDrill,
          lookupNodeTitle,
        );
        return {
          built: { shape: "series", data },
          structureKey: [meta.id, data.dimensionKey, data.valueKey].join("|"),
          shownFieldIds: [...shownFieldIds],
        };
      }
      case "scatter": {
        const data = buildScatterData(
          source,
          xy,
          resolved.series,
          activeDrill,
          lookupNodeTitle,
        );
        return {
          built: { shape: "scatter", data },
          structureKey: [meta.id, data.xKey, data.yKey, data.seriesKey].join(
            "|",
          ),
          shownFieldIds: [...shownFieldIds],
        };
      }
      case "hierarchy": {
        const data = buildHierarchyData(
          source,
          levels,
          measures,
          activeDrill,
          lookupNodeTitle,
        );
        return {
          built: { shape: "hierarchy", data },
          structureKey: [meta.id, levels.map((f) => f.id).join(",")].join("|"),
          shownFieldIds: [...shownFieldIds],
        };
      }
      case "sankey": {
        const data = buildSankeyData(
          source,
          flow,
          measures,
          activeDrill,
          lookupNodeTitle,
        );
        if (!data) return null;
        return {
          built: { shape: "sankey", data },
          structureKey: [
            meta.id,
            flow.source?.id ?? "",
            flow.target?.id ?? "",
          ].join("|"),
          shownFieldIds: [...shownFieldIds],
        };
      }
      case "single": {
        const data = buildSingleData(source, measures);
        return {
          built: { shape: "single", data },
          structureKey: meta.id,
          shownFieldIds: [...shownFieldIds],
        };
      }
    }
  }, [
    source,
    meta,
    config,
    resolved,
    xy,
    flow,
    levels,
    drill,
    lookupNodeTitle,
  ]);

  const spec = useLocaleMemo(
    () =>
      bundle
        ? buildChartSpec({ meta, config, theme, built: bundle.built })
        : null,
    [bundle, meta, config, theme],
  );

  const hiddenFieldIds = useMemo(() => {
    const shown = new Set(bundle?.shownFieldIds ?? []);
    return source.fields
      .filter((field) => !shown.has(field.id))
      .map((field) => field.id);
  }, [bundle, source.fields]);
  const hiddenFieldIdsRef = useRef<readonly string[]>(hiddenFieldIds);
  hiddenFieldIdsRef.current = hiddenFieldIds;

  /**
   * Every callback the surface holds is stable, so a hover or a data change does
   * not rebind the library's event handlers; the shell's live values are read
   * through this ref instead.
   */
  const latest = useRef({ config, recordActions });
  latest.current = { config, recordActions };

  const handleReady = useCallback((instance: IVChart) => {
    instanceRef.current = instance;
  }, []);

  const handleClickDatum = useCallback(
    (datum: Record<string, unknown>) => {
      const { clickAction } = latest.current.config;
      if (clickAction === "none") return;
      const rowIds = Array.isArray(datum.__rowIds)
        ? (datum.__rowIds as string[])
        : [];
      if (clickAction === "open") {
        const rowId = rowIds[0];
        if (!rowId) return;
        latest.current.recordActions.openRecord(rowId, {
          hiddenFieldIds: hiddenFieldIdsRef.current,
        });
        return;
      }
      // 下钻筛选: the same datum again clears it, which is what "再次点击清除"
      // means for a chart whose elements are its own filter chips.
      const dimension =
        typeof datum.__dim === "string" ? datum.__dim : undefined;
      if (!dimension) return;
      const series =
        typeof datum.__series === "string" ? datum.__series : undefined;
      setDrillState((current) => {
        const active =
          current?.signature === drillSignature ? current.drill : null;
        if (
          active &&
          active.dimension === dimension &&
          active.series === series
        ) {
          return null;
        }
        return {
          signature: drillSignature,
          drill: series ? { dimension, series } : { dimension },
        };
      });
    },
    [drillSignature],
  );

  const handleClearDrill = useCallback(() => setDrillState(null), []);

  const handleExport = useCallback(() => {
    const instance = instanceRef.current;
    if (!instance) return;
    const name =
      config.title?.trim() ||
      source.nodeTitle?.trim() ||
      source.kind ||
      "chart";
    void instance.exportImg(name).catch((error: unknown) => {
      console.error("[dataview] chart export failed", error);
    });
  }, [config.title, source.nodeTitle, source.kind]);

  const guidance = useLocaleMemo(
    () =>
      chartGuidance({
        fieldCount: source.fields.length,
        rowCount: source.rows.length,
        meta,
        hasDimension: resolved.dimension !== null,
        hasSeries: resolved.series !== null,
        measureCount: resolved.measures.length,
        xyReady: xy.x !== null && xy.y !== null,
        numberFieldCount: source.fields.filter(
          (field) => field.type === "number",
        ).length,
        flowReady: flow.source !== null && flow.target !== null,
        levelCount: levels.length,
        sankeyBuilt: bundle?.built.shape === "sankey",
      }),
    [
      source.fields,
      source.rows.length,
      meta,
      resolved,
      xy,
      flow,
      levels,
      bundle,
    ],
  );

  const single = bundle?.built.shape === "single" ? bundle.built.data : null;

  return (
    <div
      data-dataview-chart
      className={cn(
        // The shell's renderer box never scrolls; this view clips itself.
        "flex h-full min-h-0 w-full flex-col overflow-hidden bg-background",
        className,
      )}
    >
      <ChartToolbar
        source={source}
        config={config}
        meta={meta}
        resolved={resolved}
        xy={xy}
        flow={flow}
        canConfigure={Boolean(onConfigChange)}
        drill={drill}
        onClearDrill={handleClearDrill}
        onConfigChange={onConfigChange}
        onFieldsChange={onFieldsChange}
        onExport={handleExport}
      />
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {guidance ? (
          <DataViewEmptyState
            icon={ChartPie}
            title={guidance.title}
            description={guidance.description}
            className="absolute inset-0"
          />
        ) : (
          spec &&
          bundle && (
            <>
              <ChartSurface
                key={bundle.structureKey}
                spec={spec}
                className="absolute inset-2"
                onReady={handleReady}
                onClickDatum={handleClickDatum}
              />
              {single && (
                <ChartValueReadout
                  value={single.value}
                  label={single.valueLabel}
                  ratio={single.ratio}
                  align={meta.specType === "linearProgress" ? "top" : "center"}
                />
              )}
            </>
          )
        )}
      </div>
    </div>
  );
}

/** What to say when the chart has nothing to draw — checked in priority order. */
function chartGuidance({
  fieldCount,
  rowCount,
  meta,
  hasDimension,
  hasSeries,
  measureCount,
  xyReady,
  numberFieldCount,
  flowReady,
  levelCount,
  sankeyBuilt,
}: {
  fieldCount: number;
  rowCount: number;
  meta: ReturnType<typeof resolveChartType>;
  hasDimension: boolean;
  hasSeries: boolean;
  measureCount: number;
  xyReady: boolean;
  numberFieldCount: number;
  flowReady: boolean;
  levelCount: number;
  sankeyBuilt: boolean;
}): { title: string; description?: string } | null {
  if (fieldCount === 0) {
    return {
      title: translate("这张表还没有字段"),
      description: translate(
        "先在表格视图中添加字段，再回来把它们的分布画成图表。",
      ),
    };
  }
  if (rowCount === 0) {
    return {
      title: translate("还没有记录"),
      description: translate("图表按行统计；先添加几条记录，图形就有了数据。"),
    };
  }
  if (meta.shape === "scatter") {
    if (!xyReady) {
      return {
        title:
          numberFieldCount < 2
            ? translate("散点图需要两个「数字」字段")
            : translate("还没有选择 X / Y 度量"),
        description:
          numberFieldCount < 2
            ? translate(
                "散点图把两条数字列画成平面上的点。先用表格视图添加第二个「数字」字段。",
              )
            : translate("在上方工具条的「字段配置」里选择 X 轴与 Y 轴度量。"),
      };
    }
    return null;
  }
  if (meta.shape === "sankey") {
    if (!flowReady || !sankeyBuilt) {
      return {
        title: translate("桑基图需要两个字段表示流向"),
        description: translate(
          "在「字段配置」里选择 来源 与 目标，记录就会连成带权重的流带。",
        ),
      };
    }
    return null;
  }
  if (meta.shape === "hierarchy" && levelCount === 0) {
    return {
      title: translate("矩形树图需要一个层级字段"),
      description: translate("在「字段配置」的「层级」里选择至少一个字段。"),
    };
  }
  if (meta.shape === "heatmap" && !hasSeries) {
    return {
      title: translate("热力图需要两个维度"),
      description: translate(
        "在「字段配置」里选择横轴与纵轴维度，颜色会表示度量的大小。",
      ),
    };
  }
  if (
    (meta.shape === "cartesian" ||
      meta.shape === "polar" ||
      meta.shape === "wordCloud") &&
    !hasDimension
  ) {
    return {
      title: translate("图表需要一个「维度」字段"),
      description: translate(
        "维度决定图表怎么分组（分类轴、扇区或词条）。先用表格视图添加一个文本或单选字段。",
      ),
    };
  }
  if (meta.maxMeasures === 2 && measureCount < 2) {
    return {
      title: translate("区间图需要两个度量"),
      description: translate(
        "区间的上下界各来自一个「数字」字段。在「字段配置」的「度量」里再加一个。",
      ),
    };
  }
  return null;
}
