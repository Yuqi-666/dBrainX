// SPDX-License-Identifier: AGPL-3.0-only

import { translate } from "@workspace/ui/lib/i18n/runtime";
/**
 * Chart config resolution — the catalogue of chart types the view can draw, the
 * self-healing field/measure resolution over a live schema, and the
 * presentation defaults.
 *
 * A view config outlives the schema it was written against: a number field can
 * be deleted or retyped between two openings, so nothing here trusts the
 * persisted ids. Every resolver answers "what is the *live* thing this id means"
 * and degrades instead of throwing (README §5.1); the renderer turns that into
 * the missing-field guidance.
 *
 * Pure module: no React, no VChart. The catalogue is data — adding a chart type
 * means adding a row here plus a branch in `spec.ts`, never touching the shell.
 */
import type {
  ChartAggregation,
  ChartMeasure,
  ChartViewConfig,
  DatabaseField,
  DataViewSource,
} from "@workspace/interfaces";

/**
 * The one measure that needs no field: a row count.
 *
 * It is what the default config falls back to when the table has no number
 * field, so a chart is never empty just because nothing is summable.
 */
export const CHART_COUNT_FIELD = "__count";

/** What a chart type needs from the schema — drives the 字段配置 panel. */
export type ChartRole =
  | "dimension"
  | "series"
  | "measures"
  | "xy"
  | "hierarchy"
  | "flow";

/**
 * How the rows become the chart's data.
 *
 * The shape — not the VChart type — decides which builder in `schema.ts` runs
 * and which encoding fields the spec sets, so two types that share a shape
 * (`bar` and `line`) share their whole data path.
 */
export type ChartShape =
  | "cartesian"
  | "scatter"
  | "heatmap"
  | "polar"
  | "hierarchy"
  | "wordCloud"
  | "single"
  | "sankey";

/** The type picker's groups, in the order it shows them. */
export const CHART_GROUPS = [
  "比较",
  "趋势",
  "占比",
  "分布",
  "仪表",
  "关系",
] as const;

export type ChartGroup = (typeof CHART_GROUPS)[number];

export interface ChartTypeMeta {
  /** The persisted `config.chartType` — a VChart spec type plus a variant tag. */
  id: string;
  /** The VChart spec `type`. */
  specType: string;
  label: string;
  group: ChartGroup;
  shape: ChartShape;
  /** Which roles the 字段配置 panel offers for this type. */
  roles: readonly ChartRole[];
  /** How many measures the type draws; a smaller number disables 添加度量. */
  maxMeasures: number;
  /** Fixed spec fields a variant adds (`direction`, `stack`, `innerRadius`…). */
  variant?: Readonly<Record<string, unknown>>;
}

/**
 * Every chart type the view offers.
 *
 * The design doc asks for "VChart 全类型"; this is the subset that maps onto a
 * normalized `fields + rows` source without extra assets or a second schema.
 * Deliberately **not** offered (chart.md §8): the 3D variants (`bar3d`,
 * `pie3d`, …) and `map` (needs geographic JSON), `histogram` / `boxPlot` /
 * `mosaic` / `venn` / `correlation` (need a different statistical shape), and
 * `sequence` (needs its own event schema). Each would be another catalogue row
 * plus a builder — nothing in the shell assumes this list is closed.
 */
export const CHART_TYPES: readonly ChartTypeMeta[] = [
  // —— 比较 ——
  {
    id: "bar",
    specType: "bar",
    get label() {
      return translate("柱状图");
    },
    group: "比较",
    shape: "cartesian",
    roles: ["dimension", "measures", "series"],
    maxMeasures: Number.POSITIVE_INFINITY,
  },
  {
    id: "bar-horizontal",
    specType: "bar",
    get label() {
      return translate("条形图");
    },
    group: "比较",
    shape: "cartesian",
    roles: ["dimension", "measures", "series"],
    maxMeasures: Number.POSITIVE_INFINITY,
    variant: { direction: "horizontal" },
  },
  {
    id: "rangeColumn",
    specType: "rangeColumn",
    get label() {
      return translate("区间柱状图");
    },
    group: "比较",
    shape: "cartesian",
    roles: ["dimension", "measures"],
    maxMeasures: 2,
  },
  // —— 趋势 ——
  {
    id: "line",
    specType: "line",
    get label() {
      return translate("折线图");
    },
    group: "趋势",
    shape: "cartesian",
    roles: ["dimension", "measures", "series"],
    maxMeasures: Number.POSITIVE_INFINITY,
  },
  {
    id: "area",
    specType: "area",
    get label() {
      return translate("面积图");
    },
    group: "趋势",
    shape: "cartesian",
    roles: ["dimension", "measures", "series"],
    maxMeasures: Number.POSITIVE_INFINITY,
  },
  {
    id: "area-stacked",
    specType: "area",
    get label() {
      return translate("堆叠面积图");
    },
    group: "趋势",
    shape: "cartesian",
    roles: ["dimension", "measures", "series"],
    maxMeasures: Number.POSITIVE_INFINITY,
    variant: { stack: true },
  },
  {
    id: "rangeArea",
    specType: "rangeArea",
    get label() {
      return translate("区间面积图");
    },
    group: "趋势",
    shape: "cartesian",
    roles: ["dimension", "measures"],
    maxMeasures: 2,
  },
  // —— 占比 ——
  {
    id: "pie",
    specType: "pie",
    get label() {
      return translate("饼图");
    },
    group: "占比",
    shape: "polar",
    roles: ["dimension", "measures"],
    maxMeasures: 1,
  },
  {
    id: "pie-ring",
    specType: "pie",
    get label() {
      return translate("环形图");
    },
    group: "占比",
    shape: "polar",
    roles: ["dimension", "measures"],
    maxMeasures: 1,
    variant: { innerRadius: 0.5 },
  },
  {
    id: "rose",
    specType: "rose",
    get label() {
      return translate("玫瑰图");
    },
    group: "占比",
    shape: "polar",
    roles: ["dimension", "measures"],
    maxMeasures: 1,
  },
  {
    id: "funnel",
    specType: "funnel",
    get label() {
      return translate("漏斗图");
    },
    group: "占比",
    shape: "polar",
    roles: ["dimension", "measures"],
    maxMeasures: 1,
  },
  {
    id: "wordCloud",
    specType: "wordCloud",
    get label() {
      return translate("词云");
    },
    group: "占比",
    shape: "wordCloud",
    roles: ["dimension", "measures"],
    maxMeasures: 1,
  },
  {
    id: "treemap",
    specType: "treemap",
    get label() {
      return translate("矩形树图");
    },
    group: "占比",
    shape: "hierarchy",
    roles: ["hierarchy", "measures"],
    maxMeasures: 1,
  },
  {
    id: "sunburst",
    specType: "sunburst",
    get label() {
      return translate("旭日图");
    },
    group: "占比",
    shape: "hierarchy",
    roles: ["hierarchy", "measures"],
    maxMeasures: 1,
  },
  {
    id: "circlePacking",
    specType: "circlePacking",
    get label() {
      return translate("圆填充图");
    },
    group: "占比",
    shape: "hierarchy",
    roles: ["hierarchy", "measures"],
    maxMeasures: 1,
  },
  // —— 分布 ——
  {
    id: "scatter",
    specType: "scatter",
    get label() {
      return translate("散点图");
    },
    group: "分布",
    shape: "scatter",
    roles: ["xy", "series"],
    maxMeasures: 0,
  },
  {
    id: "heatmap",
    specType: "heatmap",
    get label() {
      return translate("热力图");
    },
    group: "分布",
    shape: "heatmap",
    roles: ["dimension", "series", "measures"],
    maxMeasures: 1,
  },
  {
    id: "radar",
    specType: "radar",
    get label() {
      return translate("雷达图");
    },
    group: "分布",
    shape: "polar",
    roles: ["dimension", "measures", "series"],
    maxMeasures: Number.POSITIVE_INFINITY,
  },
  // —— 仪表 ——
  {
    id: "gauge",
    specType: "gauge",
    get label() {
      return translate("仪表盘");
    },
    group: "仪表",
    shape: "single",
    roles: ["measures"],
    maxMeasures: 1,
  },
  {
    id: "liquid",
    specType: "liquid",
    get label() {
      return translate("水波图");
    },
    group: "仪表",
    shape: "single",
    roles: ["measures"],
    maxMeasures: 1,
  },
  {
    id: "circularProgress",
    specType: "circularProgress",
    get label() {
      return translate("环形进度");
    },
    group: "仪表",
    shape: "single",
    roles: ["measures"],
    maxMeasures: 1,
  },
  {
    id: "linearProgress",
    specType: "linearProgress",
    get label() {
      return translate("线性进度");
    },
    group: "仪表",
    shape: "single",
    roles: ["measures"],
    maxMeasures: 1,
  },
  // —— 关系 ——
  {
    id: "sankey",
    specType: "sankey",
    get label() {
      return translate("桑基图");
    },
    group: "关系",
    shape: "sankey",
    roles: ["flow", "measures"],
    maxMeasures: 1,
  },
];

/** The type a config opens with, and the fallback for an unknown id. */
export const DEFAULT_CHART_TYPE = "bar";

/** Resolves a persisted `chartType`, degrading to the default. */
export function resolveChartType(id: string | undefined): ChartTypeMeta {
  return (
    CHART_TYPES.find((meta) => meta.id === id) ??
    CHART_TYPES.find((meta) => meta.id === DEFAULT_CHART_TYPE)!
  );
}

/** True when the type draws a legend worth showing (never a lone measure). */
export function typeUsesSeries(meta: ChartTypeMeta): boolean {
  return meta.roles.includes("series");
}

/** True when 排序 / 前 N 条 mean something for this type. */
export function typeSupportsRanking(meta: ChartTypeMeta): boolean {
  return (
    meta.shape === "cartesian" ||
    meta.shape === "polar" ||
    meta.shape === "heatmap" ||
    meta.shape === "wordCloud" ||
    meta.shape === "hierarchy"
  );
}

// —— field resolution ————————————————————————————————————————————————————

/** The live field behind an id, or `null` when it no longer exists. */
export function resolveField(
  fields: readonly DatabaseField[],
  fieldId: string | undefined,
): DatabaseField | null {
  if (!fieldId) return null;
  return fields.find((field) => field.id === fieldId) ?? null;
}

/** A field that can be a category axis / slice / tree level. */
export function isDimensionField(
  field: Pick<DatabaseField, "type"> | undefined,
): boolean {
  return field !== undefined && field.type !== "number";
}

/** Every field a measure can point at, plus the synthetic 计数 row. */
export function measureFieldChoices(
  fields: readonly DatabaseField[],
): DatabaseField[] {
  return [
    { id: CHART_COUNT_FIELD, name: translate("计数"), type: "number" },
    ...fields.filter((field) => field.type === "number"),
  ];
}

/** Every field a dimension may point at, in schema order. */
export function dimensionFields(
  fields: readonly DatabaseField[],
): DatabaseField[] {
  return fields.filter(isDimensionField);
}

/** The dimension a shape uses when the configured one does not resolve. */
export function resolveDimensionField(
  fields: readonly DatabaseField[],
  dimensionField: string | undefined,
): DatabaseField | null {
  const configured = resolveField(fields, dimensionField);
  if (configured && isDimensionField(configured)) return configured;
  // Smart fallback: a 单选/多选 groups best, then a text column, then anything
  // that is not a measure.
  return (
    fields.find(
      (field) => field.type === "select" || field.type === "multiSelect",
    ) ??
    fields.find((field) => field.type === "text") ??
    dimensionFields(fields)[0] ??
    null
  );
}

/** The live series field — a dimension-ish field, or `null`. */
export function resolveSeriesField(
  fields: readonly DatabaseField[],
  seriesField: string | undefined,
): DatabaseField | null {
  const field = resolveField(fields, seriesField);
  return field && isDimensionField(field) ? field : null;
}

/** The live scatter x/y measures — two `number` fields, or `null` each. */
export function resolveXYMeasures(
  fields: readonly DatabaseField[],
  xMeasure: string | undefined,
  yMeasure: string | undefined,
): { x: DatabaseField | null; y: DatabaseField | null } {
  const x = resolveField(fields, xMeasure);
  const y = resolveField(fields, yMeasure);
  return {
    x: x?.type === "number" ? x : null,
    y: y?.type === "number" ? y : null,
  };
}

/** The live sankey endpoints — two dimension-ish fields. */
export function resolveFlowFields(
  fields: readonly DatabaseField[],
  sourceField: string | undefined,
  targetField: string | undefined,
): { source: DatabaseField | null; target: DatabaseField | null } {
  const source = resolveField(fields, sourceField);
  const target = resolveField(fields, targetField);
  return {
    source: source && isDimensionField(source) ? source : null,
    target:
      target && isDimensionField(target) && target.id !== source?.id
        ? target
        : null,
  };
}

/**
 * The live hierarchy levels, outermost first.
 *
 * A deleted id silently drops out; an empty result falls back to the dimension
 * field so a freshly-created 树图 has a level to draw (`schema.ts` then treats
 * the root as a single level).
 */
export function resolveHierarchyFields(
  fields: readonly DatabaseField[],
  hierarchyFields: readonly string[] | undefined,
  fallback: DatabaseField | null,
): DatabaseField[] {
  const levels = (hierarchyFields ?? [])
    .map((fieldId) => resolveField(fields, fieldId))
    .filter(
      (field): field is DatabaseField =>
        field !== null && isDimensionField(field),
    );
  if (levels.length > 0) return levels;
  return fallback ? [fallback] : [];
}

// —— measures ————————————————————————————————————————————————————————————

/** One measure, resolved against the live schema. */
export interface ResolvedMeasure {
  /** The live `number` field, or `null` for a row count. */
  field: DatabaseField | null;
  /** Row count semantics — no field is read at all. */
  count: boolean;
  /** The aggregation actually applied (`sum` for a count, which is unused). */
  aggregation: Exclude<ChartAggregation, "count">;
  /** Axis / legend / tooltip name, before de-duplication. */
  label: string;
}

/**
 * The measures a chart actually draws.
 *
 * The persisted list is read defensively: a measure naming a deleted or retyped
 * field drops out, and a list that resolves to nothing falls back to a row
 * count, so `buildSeriesData` always receives at least one measure and the
 * chart never renders an empty frame because the schema changed underneath it.
 */
export function resolveMeasures(
  fields: readonly DatabaseField[],
  config: ChartViewConfig,
  maxMeasures: number = Number.POSITIVE_INFINITY,
): ResolvedMeasure[] {
  const declared: ChartMeasure[] =
    config.measures && config.measures.length > 0
      ? config.measures
      : [{ fieldId: CHART_COUNT_FIELD }];

  const resolved: ResolvedMeasure[] = [];
  for (const measure of declared) {
    if (measure.fieldId === CHART_COUNT_FIELD) {
      resolved.push({
        field: null,
        count: true,
        aggregation: "sum",
        label: measure.alias?.trim() || translate("计数"),
      });
      continue;
    }
    const field = resolveField(fields, measure.fieldId);
    if (field?.type !== "number") continue;
    const aggregation = measure.aggregation ?? config.aggregation;
    const count = aggregation === "count";
    resolved.push({
      field,
      count,
      aggregation: count ? "sum" : aggregation,
      label:
        measure.alias?.trim() ||
        (count
          ? translate("{value1}（计数）", { value1: field.name })
          : field.name),
    });
  }

  if (resolved.length === 0) {
    resolved.push({
      field: null,
      count: true,
      aggregation: "sum",
      label: translate("计数"),
    });
  }

  return Number.isFinite(maxMeasures)
    ? resolved.slice(0, Math.max(1, maxMeasures))
    : resolved;
}

// —— the resolved field bundle ————————————————————————————————————————————

/** Everything a chart type reads from the schema, resolved once per render. */
export interface ResolvedChartFields {
  dimension: DatabaseField | null;
  series: DatabaseField | null;
  measures: ResolvedMeasure[];
}

/**
 * Resolves the whole encoding against the live schema.
 *
 * The shell resolves once and hands the bundle to both the toolbar (so the
 * panels show live names) and the data builders (so the two can never disagree
 * about which field a role means).
 */
export function resolveChartFields(
  source: DataViewSource,
  meta: ChartTypeMeta,
  config: ChartViewConfig,
): ResolvedChartFields {
  return {
    dimension: resolveDimensionField(source.fields, config.dimensionField),
    series: meta.roles.includes("series")
      ? resolveSeriesField(source.fields, config.seriesField)
      : null,
    measures: resolveMeasures(source.fields, config, meta.maxMeasures),
  };
}

// —— palettes —————————————————————————————————————————————————————————————

/** The categorical palettes 色板 offers. `default` keeps VChart's own scheme. */
export const CHART_PALETTES: ReadonlyArray<{
  value: string;
  label: string;
  colors: readonly string[];
}> = [
  {
    value: "default",
    get label() {
      return translate("默认");
    },
    colors: [],
  },
  {
    value: "vivid",
    get label() {
      return translate("明亮");
    },
    colors: [
      "#3b82f6",
      "#22c55e",
      "#f59e0b",
      "#ef4444",
      "#8b5cf6",
      "#14b8a6",
      "#ec4899",
      "#84cc16",
    ],
  },
  {
    value: "pastel",
    get label() {
      return translate("柔和");
    },
    colors: [
      "#93c5fd",
      "#86efac",
      "#fcd34d",
      "#fca5a5",
      "#c4b5fd",
      "#5eead4",
      "#f9a8d4",
      "#bef264",
    ],
  },
  {
    value: "cool",
    get label() {
      return translate("冷色");
    },
    colors: [
      "#0ea5e9",
      "#6366f1",
      "#14b8a6",
      "#3b82f6",
      "#8b5cf6",
      "#06b6d4",
      "#0891b2",
      "#4f46e5",
    ],
  },
  {
    value: "warm",
    get label() {
      return translate("暖色");
    },
    colors: [
      "#f97316",
      "#ef4444",
      "#eab308",
      "#ec4899",
      "#f59e0b",
      "#dc2626",
      "#fb923c",
      "#facc15",
    ],
  },
  {
    value: "earth",
    get label() {
      return translate("大地");
    },
    colors: [
      "#a16207",
      "#4d7c0f",
      "#0f766e",
      "#b45309",
      "#7c2d12",
      "#365314",
      "#78716c",
      "#9a3412",
    ],
  },
];

/** The colours behind `config.colorScheme`, or `[]` for the library default. */
export function resolvePalette(
  colorScheme: string | undefined,
): readonly string[] {
  if (!colorScheme || colorScheme === "default") return [];
  return (
    CHART_PALETTES.find((palette) => palette.value === colorScheme)?.colors ??
    []
  );
}

// —— the fixed defaults ———————————————————————————————————————————————————

/**
 * The chart's presentation, as constants rather than config.
 *
 * Only the values nobody would decide differently per view live here; anything
 * a user may reasonably want (title, legend, labels, tooltip, theme, palette,
 * click behaviour, sorting, Top-N) stays on `ChartViewConfig` and is set from
 * the view's own toolbar panels.
 */
export const CHART_FIXED = {
  /** Pane padding; the light theme's own default is 20. */
  padding: 12,
  animation: true,
  /** Word-cloud font-size range (px) — a word cloud with tiny words is noise. */
  wordCloudFontSizeRange: [14, 56] as [number, number],
  /** Gauge/progress arc geometry. */
  gauge: {
    startAngle: -225,
    endAngle: 45,
    outerRadius: 0.85,
    innerRadius: 0.68,
  },
  /** A柱状图/条形图 corner radius, matching the app's rounded chrome. */
  cornerRadius: 4,
} as const;

/** The aggregation choices the 度量 rows offer. */
export const CHART_AGGREGATIONS: ReadonlyArray<{
  value: Exclude<ChartAggregation, "count">;
  label: string;
}> = [
  {
    value: "sum",
    get label() {
      return translate("求和");
    },
  },
  {
    value: "avg",
    get label() {
      return translate("平均");
    },
  },
  {
    value: "min",
    get label() {
      return translate("最小");
    },
  },
  {
    value: "max",
    get label() {
      return translate("最大");
    },
  },
];

/** The 点击行为 choices. */
export const CHART_CLICK_ACTIONS: ReadonlyArray<{
  value: ChartViewConfig["clickAction"];
  label: string;
}> = [
  {
    value: "none",
    get label() {
      return translate("不响应");
    },
  },
  {
    value: "filter",
    get label() {
      return translate("下钻筛选");
    },
  },
  {
    value: "open",
    get label() {
      return translate("打开记录");
    },
  },
];

/** The 主题 choices. */
export const CHART_THEMES: ReadonlyArray<{
  value: ChartViewConfig["theme"];
  label: string;
}> = [
  {
    value: "auto",
    get label() {
      return translate("跟随");
    },
  },
  {
    value: "light",
    get label() {
      return translate("浅色");
    },
  },
  {
    value: "dark",
    get label() {
      return translate("深色");
    },
  },
];

/** 前 N 条 presets. */
export const CHART_LIMITS: readonly number[] = [5, 10, 20, 50];

/**
 * The largest legend / data set worth drawing without a scroll.
 *
 * Not enforced — 前 N 条 is the user's tool for that — but the toolbar offers
 * these as the quick presets.
 */
export function describeSource(source: DataViewSource): string {
  return translate("{value1} 条记录", { value1: source.rows.length });
}
