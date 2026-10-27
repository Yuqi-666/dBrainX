// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Chart spec building — a resolved config plus built data to a VChart spec.
 *
 * This is the only module in the view that speaks VChart's spec vocabulary; it
 * never reads rows (that is `schema.ts`) and never touches the DOM (that is
 * `board/`). The spec is a plain object so the surface can memoise it and so a
 * chart type is added by adding one `case` here.
 *
 * Pure module: no React, and only VChart's *type* vocabulary (never its
 * runtime), so the library is still reached exclusively through the lazy
 * `board/chart-surface.tsx`.
 */
import type { ChartViewConfig } from "@workspace/interfaces";

import { CHART_FIXED, resolvePalette, type ChartTypeMeta } from "./config";
import type {
  ChartHierarchyData,
  ChartSankeyData,
  ChartScatterData,
  ChartSeriesData,
  ChartSingleData,
} from "./schema";
import type { ChartThemeVars } from "./theme";

/** A VChart spec, typed loosely: it is data we assemble, not a fixed shape. */
export type ChartSpec = Record<string, unknown>;

/** The data set the shell built for the active type. */
export type ChartBuiltData =
  | { shape: "series"; data: ChartSeriesData }
  | { shape: "scatter"; data: ChartScatterData }
  | { shape: "hierarchy"; data: ChartHierarchyData }
  | { shape: "sankey"; data: ChartSankeyData }
  | { shape: "single"; data: ChartSingleData };

export interface ChartSpecInput {
  meta: ChartTypeMeta;
  config: ChartViewConfig;
  theme: ChartThemeVars;
  built: ChartBuiltData;
}

/** The single data set's id; VChart needs one stable name per spec. */
const DATA_ID = "dataview-chart";

/** The datum key a single-value chart hangs its category on. */
export const SINGLE_CATEGORY_KEY = "指标";
/** The 0–1 key every progress/gauge/liquid chart encodes. */
export const SINGLE_RATIO_KEY = "进度";

/**
 * Whether a legend says anything for this type and data.
 *
 * A legend listing one entry ("求和") is noise: it restates the axis. A
 * single-value chart has the readout instead, a treemap's tiles are labelled,
 * and a sankey's nodes are named — so only a real series split gets one.
 */
function legendVisible(
  meta: ChartTypeMeta,
  config: ChartViewConfig,
  built: ChartBuiltData,
): boolean {
  if (!config.showLegend) return false;
  switch (built.shape) {
    case "series":
      return built.data.seriesValues.length > 1;
    case "scatter":
      return built.data.seriesValues.length > 1;
    default:
      return false;
  }
}

function titleSpec(config: ChartViewConfig): Record<string, unknown> {
  const text = config.title?.trim();
  return text
    ? { title: { visible: true, text, textStyle: { fontSize: 13 } } }
    : {};
}

/**
 * Builds the spec for the active type.
 *
 * Every branch starts from {@link baseSpec} so theme, title, legend, tooltip
 * and palette are decided in one place — a chart type cannot accidentally opt
 * out of dark mode or the 填色 palette.
 */
export function buildChartSpec({
  meta,
  config,
  theme,
  built,
}: ChartSpecInput): ChartSpec {
  const palette = resolvePalette(config.colorScheme);
  const base: ChartSpec = {
    type: meta.specType,
    theme,
    padding: CHART_FIXED.padding,
    animation: CHART_FIXED.animation,
    legends: { visible: legendVisible(meta, config, built) },
    tooltip: { visible: config.showTooltip },
    ...titleSpec(config),
    ...(palette.length > 0 ? { color: [...palette] } : {}),
    ...(meta.variant ?? {}),
  };

  switch (meta.shape) {
    case "cartesian":
      return cartesianSpec(base, meta, config, built.data as ChartSeriesData);
    case "polar":
      return polarSpec(base, meta, config, built.data as ChartSeriesData);
    case "heatmap":
      return heatmapSpec(base, meta, config, built.data as ChartSeriesData);
    case "wordCloud":
      return wordCloudSpec(base, config, built.data as ChartSeriesData);
    case "scatter":
      return scatterSpec(base, meta, config, built.data as ChartScatterData);
    case "hierarchy":
      return hierarchySpec(base, config, built.data as ChartHierarchyData);
    case "sankey":
      return sankeySpec(base, config, built.data as ChartSankeyData);
    case "single":
      return singleSpec(base, meta, config, built.data as ChartSingleData);
  }
}

// —— cartesian (bar / line / area / range) ————————————————————————————————

function cartesianSpec(
  base: ChartSpec,
  meta: ChartTypeMeta,
  config: ChartViewConfig,
  data: ChartSeriesData,
): ChartSpec {
  const horizontal = meta.variant?.direction === "horizontal";
  const spec: ChartSpec = {
    ...base,
    data: [{ id: DATA_ID, values: data.values }],
    label: { visible: config.showLabel },
  };

  if (meta.maxMeasures === 2 && data.measureKeys.length === 2) {
    return {
      ...spec,
      // 区间图 encodes two measures as the band's floor and ceiling, so its
      // data stays wide (one column per measure) instead of folding into
      // series.
      xField: data.dimensionKey,
      minField: data.measureKeys[0],
      maxField: data.measureKeys[1],
    };
  }

  const seriesSplit = data.seriesValues.length > 1;
  if (horizontal) {
    spec.xField = data.valueKey;
    spec.yField = data.dimensionKey;
  } else {
    spec.xField = data.dimensionKey;
    spec.yField = data.valueKey;
  }
  if (seriesSplit) {
    spec.seriesField = data.seriesKey;
    /**
     * A `seriesField` on a bar chart **stacks** the series — VChart's stacking
     * is implicit in "same band, same series type". 堆叠 is its own catalogue
     * entry (堆叠面积图), so a 柱状图 means 并排: the series has to become the
     * band's second dimension for the bars to sit beside each other (the
     * library's own grouped-bar recipe).
     */
    if (meta.specType === "bar") {
      if (horizontal) spec.yField = [data.dimensionKey, data.seriesKey];
      else spec.xField = [data.dimensionKey, data.seriesKey];
    }
  }

  switch (meta.specType) {
    case "bar":
      spec.bar = {
        style: {
          cornerRadius: horizontal
            ? [0, CHART_FIXED.cornerRadius, CHART_FIXED.cornerRadius, 0]
            : [CHART_FIXED.cornerRadius, CHART_FIXED.cornerRadius, 0, 0],
        },
      };
      break;
    case "line":
      spec.line = { style: { lineWidth: 2, curveType: "monotone" } };
      spec.point = { visible: false };
      break;
    case "area":
      spec.line = { style: { lineWidth: 2, curveType: "monotone" } };
      spec.point = { visible: false };
      spec.area = { style: { fillOpacity: 0.35 } };
      break;
    default:
      break;
  }
  return spec;
}

// —— polar (pie / rose / funnel / radar) ——————————————————————————————————

function polarSpec(
  base: ChartSpec,
  meta: ChartTypeMeta,
  config: ChartViewConfig,
  data: ChartSeriesData,
): ChartSpec {
  const seriesSplit = data.seriesValues.length > 1;
  switch (meta.specType) {
    case "pie":
      return {
        ...base,
        data: [{ id: DATA_ID, values: data.values }],
        valueField: data.valueKey,
        categoryField: data.dimensionKey,
        label: { visible: config.showLabel, position: "outside" },
      };
    case "rose":
      return {
        ...base,
        data: [{ id: DATA_ID, values: data.values }],
        valueField: data.valueKey,
        categoryField: data.dimensionKey,
        /**
         * A rose's *series* is its own category — the library's documented
         * recipe. Without it every sector shares one series and therefore one
         * colour, and an equal-angle rose whose sectors differ only in radius
         * reads as a single blue blob.
         */
        seriesField: data.dimensionKey,
        legends: {
          visible: config.showLegend && data.dimensionValues.length > 1,
        },
        label: { visible: config.showLabel },
      };
    case "funnel":
      return {
        ...base,
        data: [{ id: DATA_ID, values: data.values }],
        valueField: data.valueKey,
        categoryField: data.dimensionKey,
        shape: "trapezoid",
        isTransform: true,
        label: { visible: config.showLabel, position: "inside" },
      };
    case "radar":
      return {
        ...base,
        data: [{ id: DATA_ID, values: data.values }],
        valueField: data.valueKey,
        categoryField: data.dimensionKey,
        ...(seriesSplit ? { seriesField: data.seriesKey } : {}),
        area: { visible: true, style: { fillOpacity: 0.2 } },
        line: { style: { lineWidth: 2 } },
        point: { visible: true, style: { size: 5 } },
        label: { visible: config.showLabel },
      };
    default:
      return base;
  }
}

// —— heatmap ——————————————————————————————————————————————————————————————

function heatmapSpec(
  base: ChartSpec,
  meta: ChartTypeMeta,
  config: ChartViewConfig,
  data: ChartSeriesData,
): ChartSpec {
  void meta;
  return {
    ...base,
    data: [{ id: DATA_ID, values: data.values }],
    xField: data.dimensionKey,
    yField: data.seriesKey,
    valueField: data.valueKey,
    /**
     * Both axes must be **explicitly band**. The heatmap's series declares both
     * x and y as *dimensions* and the value as its measure, and with no axis
     * type the inference binds the measure to the y axis: the cells then sit on
     * a linear 0–1 axis as slivers at the top of the pane. (Verified in the
     * browser: adding the two axes turns that back into a grid.)
     */
    axes: [
      { orient: "bottom", type: "band" },
      { orient: "left", type: "band" },
    ],
    /**
     * The colour scale *is* the heatmap's legend, but VChart titles it with the
     * internal series key (`heatmap__69`) unless a title is supplied.
     */
    legends: {
      visible: config.showLegend,
      title: { visible: true, text: data.valueLabel },
    },
    label: { visible: config.showLabel },
  };
}

// —— 词云 ———————————————————————————————————————————————————————————————————

function wordCloudSpec(
  base: ChartSpec,
  config: ChartViewConfig,
  data: ChartSeriesData,
): ChartSpec {
  void config;
  return {
    ...base,
    data: [{ id: DATA_ID, values: data.values }],
    nameField: data.dimensionKey,
    valueField: data.valueKey,
    fontSizeRange: [...CHART_FIXED.wordCloudFontSizeRange],
    // A word cloud's words *are* its labels; 数据标签 has nothing to add.
    label: { visible: false },
  };
}

// —— scatter ——————————————————————————————————————————————————————————————

function scatterSpec(
  base: ChartSpec,
  meta: ChartTypeMeta,
  config: ChartViewConfig,
  data: ChartScatterData,
): ChartSpec {
  void meta;
  const seriesSplit = data.seriesValues.length > 1;
  return {
    ...base,
    data: [{ id: DATA_ID, values: data.values }],
    xField: data.xKey,
    yField: data.yKey,
    ...(seriesSplit ? { seriesField: data.seriesKey } : {}),
    point: { style: { size: 8, fillOpacity: 0.75, stroke: "transparent" } },
    label: { visible: config.showLabel },
  };
}

// —— hierarchy (treemap / sunburst / circlePacking) ————————————————————————

function hierarchySpec(
  base: ChartSpec,
  config: ChartViewConfig,
  data: ChartHierarchyData,
): ChartSpec {
  void config;
  const spec: ChartSpec = {
    ...base,
    // Hierarchy data is an **array of roots** at runtime, whatever the
    // `IHierarchyDataValues` type says: `dataToDataView` replaces a non-array
    // `values` with `[]` ("values should be array"), and every layout util
    // starts with `nodes.forEach`. One root node is therefore a one-element
    // array.
    data: [{ id: DATA_ID, values: [data.root] }],
    // Hierarchy types read the *node* shape: every node carries a `name` and
    // leaves carry a `value` (schema.ts builds exactly that).
    categoryField: "name",
    valueField: "value",
    label: { visible: true },
  };
  if (base.type === "treemap") {
    spec.gapWidth = 2;
    spec.nodePadding = 2;
  }
  if (base.type === "sunburst") {
    spec.innerRadius = 0.12;
    spec.outerRadius = 0.85;
    spec.gap = 2;
  }
  return spec;
}

// —— sankey ————————————————————————————————————————————————————————————————

function sankeySpec(
  base: ChartSpec,
  config: ChartViewConfig,
  data: ChartSankeyData,
): ChartSpec {
  void config;
  return {
    ...base,
    // A sankey's raw data is one graph object (`{ nodes, links }`), not a list
    // of rows: VChart reads `latestData[0].links` to build the ribbons.
    data: [{ id: DATA_ID, values: [{ nodes: data.nodes, links: data.links }] }],
    categoryField: "name",
    valueField: "value",
    sourceField: "source",
    targetField: "target",
    /**
     * The node key **must** be named. With `nodes` present, the layout keys its
     * node map off `nodeKey` (defaulting to the node's *index*) and then drops
     * every link whose endpoints are not in that map — with string endpoint
     * names and numeric keys, that silently removes all of them and the chart
     * draws nothing at all.
     */
    nodeKey: "name",
    nodeGap: 8,
    nodeWidth: 12,
    // Node names are the chart, so they are never optional.
    label: { visible: true },
    tooltip: { visible: config.showTooltip },
    emphasis: { enable: true, trigger: "hover", effect: "adjacency" },
  };
}

// —— single value (gauge / liquid / progress) ————————————————————————————

/**
 * One number, encoded as a 0–1 ratio.
 *
 * VChart's progress/gauge/liquid transformers fix the value axis to `0…1` when
 * the spec does not override it, and none of the three has an `indicator` the
 * way a gauge or a pie does — so the *absolute* value is drawn by the surface's
 * DOM readout (`board/chart-readout.tsx`) and the canvas carries the ratio. That
 * keeps one code path for four types and makes the number readable at any size.
 */
function singleSpec(
  base: ChartSpec,
  meta: ChartTypeMeta,
  config: ChartViewConfig,
  data: ChartSingleData,
): ChartSpec {
  void config;
  const values = [
    {
      [SINGLE_CATEGORY_KEY]: data.valueLabel,
      [SINGLE_RATIO_KEY]: data.ratio,
      __rowIds: data.rowIds,
    },
  ];
  const shared: ChartSpec = {
    ...base,
    legends: { visible: false },
    label: { visible: false },
  };

  switch (meta.specType) {
    case "gauge":
      return {
        ...shared,
        data: [{ id: DATA_ID, values }],
        valueField: SINGLE_RATIO_KEY,
        categoryField: SINGLE_CATEGORY_KEY,
        startAngle: CHART_FIXED.gauge.startAngle,
        endAngle: CHART_FIXED.gauge.endAngle,
        outerRadius: CHART_FIXED.gauge.outerRadius,
        innerRadius: CHART_FIXED.gauge.innerRadius,
      };
    case "liquid":
      return {
        ...shared,
        data: [{ id: DATA_ID, values }],
        valueField: SINGLE_RATIO_KEY,
        maskShape: "circle",
        indicatorSmartInvert: true,
      };
    case "circularProgress":
      return {
        ...shared,
        data: [{ id: DATA_ID, values }],
        valueField: SINGLE_RATIO_KEY,
        categoryField: SINGLE_CATEGORY_KEY,
        maxValue: 1,
        outerRadius: 0.9,
        innerRadius: 0.72,
        cornerRadius: 12,
      };
    default:
      // linearProgress
      return {
        ...shared,
        data: [{ id: DATA_ID, values }],
        xField: SINGLE_CATEGORY_KEY,
        yField: SINGLE_RATIO_KEY,
        direction: "horizontal",
        bandWidth: 28,
        cornerRadius: 8,
      };
  }
}
