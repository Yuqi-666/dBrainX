// SPDX-License-Identifier: AGPL-3.0-only

import { translate } from "@workspace/ui/lib/i18n/runtime";
/**
 * Chart data building — rows to the shapes a VChart spec consumes.
 *
 * Everything the chart draws is derived here, and nothing here knows about
 * VChart: the spec builder (`spec.ts`) receives a finished data set. That split
 * is what lets `bar` and `line` share one data path, and what makes the
 * aggregation rules readable without a canvas.
 *
 * Conventions every datum carries (they are ours, not VChart's):
 *
 * - `__rowIds` — the source rows the datum aggregates, so 打开记录 can open one.
 * - `__dim` / `__series` — the display values behind the datum, so a click can
 *   drill the chart into them without re-deriving the group key.
 *
 * Pure module: no React, no VChart.
 */
import type {
  ChartViewConfig,
  DatabaseField,
  DataRow,
  DataViewSource,
  NodeId,
} from "@workspace/interfaces";

import {
  displayText as cellDisplayText,
  toNumber,
} from "../../../source/cell-resolver";
import type { ChartTypeMeta, ResolvedMeasure } from "./config";

/** One row of chart data; the keys are the chart's encoding fields. */
export type ChartDatum = Record<string, unknown>;

/** Resolves a `relation` cell to node titles (host-supplied). */
export type NodeTitleLookup = (nodeId: NodeId) => string | undefined;

/** A view-local drill filter: the datum the user clicked. */
export interface ChartDrill {
  dimension: string;
  series?: string;
}

// —— shared helpers ———————————————————————————————————————————————————————

/** A readable, unique data key for one encoding role. */
function uniqueKey(base: string, used: Set<string>): string {
  const trimmed = base.trim() || "值";
  if (!used.has(trimmed)) {
    used.add(trimmed);
    return trimmed;
  }
  let index = 2;
  while (used.has(`${trimmed} ${index}`)) index += 1;
  const key = `${trimmed} ${index}`;
  used.add(key);
  return key;
}

/** The user-facing text of a cell, with `relation` resolved when possible. */
function text(
  row: DataRow,
  field: DatabaseField | null,
  lookup: NodeTitleLookup | undefined,
): string {
  return field ? cellDisplayText(row.cells[field.id], field, lookup) : "";
}

/**
 * The aggregate of one measure over a set of rows.
 *
 * An empty set is `0` for every operation: a chart shows an empty bucket as
 * zero, not as a hole. `count` counts rows — the measure's field, if it has
 * one, is not read at all.
 */
export function aggregateRows(
  rows: readonly DataRow[],
  measure: ResolvedMeasure,
): number {
  if (measure.count) return rows.length;
  const fieldId = measure.field?.id;
  if (!fieldId) return rows.length;
  const values: number[] = [];
  for (const row of rows) {
    const value = toNumber(row.cells[fieldId]);
    if (value !== null && Number.isFinite(value)) values.push(value);
  }
  if (values.length === 0) return 0;
  switch (measure.aggregation) {
    case "avg":
      return values.reduce((total, value) => total + value, 0) / values.length;
    case "min":
      return Math.min(...values);
    case "max":
      return Math.max(...values);
    default:
      return values.reduce((total, value) => total + value, 0);
  }
}

/** The sort key of a dimension group: a date orders chronologically. */
function dimensionSortValue(
  rows: readonly DataRow[],
  field: DatabaseField | null,
): string {
  if (!field || field.type !== "date" || rows.length === 0) return "";
  const cell = rows[0]!.cells[field.id];
  return cell?.type === "date" ? (cell.date ?? "") : "";
}

/** A "nice" full-scale bound for a single-value chart, with 10% headroom. */
export function niceMax(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  if (value <= 1) return 1;
  if (value <= 100) return 100;
  const padded = value * 1.1;
  const magnitude = 10 ** (Math.floor(Math.log10(padded)) - 1);
  return Math.ceil(padded / magnitude) * magnitude;
}

// —— dimension + series + value (cartesian / polar / heatmap) ——————————————

export interface ChartSeriesData {
  values: ChartDatum[];
  dimensionKey: string;
  seriesKey: string;
  valueKey: string;
  dimensionLabel: string;
  seriesLabel: string;
  valueLabel: string;
  /** Distinct series values, first-seen order — the legend's usefulness test. */
  seriesValues: string[];
  /** Distinct dimension values in their final (sorted, limited) order. */
  dimensionValues: string[];
  /**
   * One data key per drawn measure — only populated for the 区间 types, whose
   * spec encodes a floor and a ceiling instead of a series.
   */
  measureKeys: string[];
  rowCount: number;
  /** The measure list this data set draws (one entry per series when folded). */
  drawnMeasures: ResolvedMeasure[];
}

interface DimensionBucket {
  rows: DataRow[];
  /** Series value → rows, when the chart is split by a series field. */
  bySeries: Map<string, DataRow[]>;
}

/**
 * Rows → the long-format table the dimension/series/value encodings share.
 *
 * Two ways a chart gets more than one series, in priority order:
 *
 * 1. **系列字段** (`config.seriesField`, only for types whose role list allows
 *    it) — the rows are split by that field's value. Only the first measure is
 *    drawn when it is set: a second measure would need a second value axis,
 *    which is a different chart.
 * 2. **多个度量** — the measures themselves become the series, so 销售额 and
 *    成本 draw side by side (or stack, for 堆叠面积图).
 *
 * 排序 and 前 N 条 act on the *dimension groups*, never on the individual data
 * points: "the top 10 categories by 销售额" is what a user means, and VChart
 * preserves the order the groups appear in.
 */
export function buildSeriesData(
  source: DataViewSource,
  meta: ChartTypeMeta,
  config: ChartViewConfig,
  resolved: {
    dimension: DatabaseField | null;
    series: DatabaseField | null;
    measures: readonly ResolvedMeasure[];
  },
  drill: ChartDrill | null,
  lookup?: NodeTitleLookup,
): ChartSeriesData {
  const used = new Set<string>();
  const dimensionField = resolved.dimension;
  const dimensionKey = uniqueKey(
    dimensionField?.name ?? translate("维度"),
    used,
  );
  /**
   * 区间图 (rangeColumn / rangeArea) is the one cartesian family that does not
   * fold its measures into a series: the spec encodes a floor and a ceiling, so
   * the data stays wide — one column per measure.
   */
  const wide = meta.maxMeasures === 2 && resolved.measures.length >= 2;
  const useSeries =
    !wide && meta.roles.includes("series") && resolved.series !== null;
  const drawn = wide
    ? resolved.measures.slice(0, 2)
    : useSeries
      ? resolved.measures.slice(0, 1)
      : resolved.measures.slice();
  const measureKeys = wide
    ? drawn.map((measure) => uniqueKey(measure.label, used))
    : [];
  const seriesKey = uniqueKey(
    useSeries
      ? (resolved.series?.name ?? translate("系列"))
      : translate("指标"),
    used,
  );
  const valueKey = uniqueKey(
    drawn.length === 1 ? drawn[0]!.label : translate("数值"),
    used,
  );

  const buckets = new Map<string, DimensionBucket>();
  for (const row of source.rows) {
    const dimension = text(row, dimensionField, lookup) || translate("（空）");
    const series = useSeries
      ? text(row, resolved.series, lookup) || translate("（空）")
      : "";
    let bucket = buckets.get(dimension);
    if (!bucket) {
      bucket = { rows: [], bySeries: new Map() };
      buckets.set(dimension, bucket);
    }
    bucket.rows.push(row);
    if (useSeries) {
      const rows = bucket.bySeries.get(series);
      if (rows) rows.push(row);
      else bucket.bySeries.set(series, [row]);
    }
  }

  // —— 排序 / 前 N 条 ——
  const sortIndex = config.sortBy?.measureIndex ?? -1;
  const sortMeasure =
    sortIndex >= 0 && sortIndex < drawn.length ? drawn[sortIndex]! : null;
  let dimensionValues = Array.from(buckets.keys());
  if (sortMeasure) {
    const direction = config.sortBy?.order === "asc" ? 1 : -1;
    const scores = new Map<string, number>();
    for (const [dimension, bucket] of buckets) {
      scores.set(dimension, aggregateRows(bucket.rows, sortMeasure));
    }
    dimensionValues = dimensionValues
      .map((dimension, index) => ({ dimension, index }))
      .sort((a, b) => {
        const delta =
          (scores.get(a.dimension) ?? 0) - (scores.get(b.dimension) ?? 0);
        // Ties keep their first-seen order rather than flapping between renders.
        return delta !== 0 ? delta * direction : a.index - b.index;
      })
      .map((entry) => entry.dimension);
  } else if (dimensionField?.type === "date") {
    dimensionValues = dimensionValues
      .map((dimension, index) => ({ dimension, index }))
      .sort((a, b) => {
        const left = dimensionSortValue(
          buckets.get(a.dimension)!.rows,
          dimensionField,
        );
        const right = dimensionSortValue(
          buckets.get(b.dimension)!.rows,
          dimensionField,
        );
        return left < right ? -1 : left > right ? 1 : a.index - b.index;
      })
      .map((entry) => entry.dimension);
  }
  if (config.limit && config.limit > 0) {
    dimensionValues = dimensionValues.slice(0, config.limit);
  }

  // A drill narrows the buckets to the clicked value, so the aggregates are
  // recomputed for the subset rather than filtered out of the finished data
  // (that is what makes 下钻 a real drill and not a display trick).
  const drilledDimensions = drill
    ? dimensionValues.filter((dimension) => dimension === drill.dimension)
    : dimensionValues;

  const seriesValues: string[] = [];
  const values: ChartDatum[] = [];
  for (const dimension of drilledDimensions) {
    const bucket = buckets.get(dimension)!;
    if (wide) {
      const datum: ChartDatum = {
        [dimensionKey]: dimension,
        __rowIds: bucket.rows.map((row) => row.id),
        __dim: dimension,
      };
      drawn.forEach((measure, index) => {
        datum[measureKeys[index]!] = aggregateRows(bucket.rows, measure);
      });
      values.push(datum);
      continue;
    }
    const seriesEntries = useSeries
      ? Array.from(bucket.bySeries, ([series, rows]) => ({
          series,
          rows,
          measure: drawn[0]!,
        })).filter((entry) => !drill?.series || entry.series === drill.series)
      : drawn.map((measure) => ({
          series: measure.label,
          rows: bucket.rows,
          measure,
        }));

    for (const entry of seriesEntries) {
      if (!seriesValues.includes(entry.series)) seriesValues.push(entry.series);
      values.push({
        [dimensionKey]: dimension,
        [seriesKey]: entry.series,
        [valueKey]: aggregateRows(entry.rows, entry.measure),
        __rowIds: entry.rows.map((row) => row.id),
        __dim: dimension,
        __series: entry.series,
      });
    }
  }

  return {
    values,
    dimensionKey,
    seriesKey,
    valueKey,
    dimensionLabel: dimensionField?.name ?? translate("维度"),
    seriesLabel: useSeries
      ? (resolved.series?.name ?? translate("系列"))
      : translate("指标"),
    valueLabel: drawn.length === 1 ? drawn[0]!.label : translate("数值"),
    seriesValues,
    dimensionValues: drilledDimensions,
    measureKeys,
    rowCount: source.rows.length,
    drawnMeasures: drawn,
  };
}

// —— scatter (row-level x/y) ——————————————————————————————————————————————

export interface ChartScatterData {
  values: ChartDatum[];
  xKey: string;
  yKey: string;
  seriesKey: string;
  xLabel: string;
  yLabel: string;
  seriesLabel: string;
  seriesValues: string[];
  pointCount: number;
}

/**
 * Rows → points. No aggregation: a scatter shows the records themselves, so a
 * row whose x or y is empty has no place on the plane and is dropped.
 */
export function buildScatterData(
  source: DataViewSource,
  xy: { x: DatabaseField | null; y: DatabaseField | null },
  seriesField: DatabaseField | null,
  drill: ChartDrill | null,
  lookup?: NodeTitleLookup,
): ChartScatterData {
  const used = new Set<string>();
  const xKey = uniqueKey(xy.x?.name ?? "X", used);
  const yKey = uniqueKey(xy.y?.name ?? "Y", used);
  const seriesKey = uniqueKey(seriesField?.name ?? translate("系列"), used);

  const values: ChartDatum[] = [];
  const seriesValues: string[] = [];
  for (const row of source.rows) {
    const x = xy.x ? toNumber(row.cells[xy.x.id]) : null;
    const y = xy.y ? toNumber(row.cells[xy.y.id]) : null;
    if (x === null || y === null) continue;
    const seriesValue = seriesField
      ? text(row, seriesField, lookup) || translate("（空）")
      : translate("全部");
    if (seriesField && !seriesValues.includes(seriesValue)) {
      seriesValues.push(seriesValue);
    }
    if (drill && seriesField && seriesValue !== drill.dimension) continue;
    values.push({
      [xKey]: x,
      [yKey]: y,
      [seriesKey]: seriesValue,
      __rowIds: [row.id],
      __dim: seriesValue,
    });
  }

  return {
    values,
    xKey,
    yKey,
    seriesKey,
    xLabel: xy.x?.name ?? "X",
    yLabel: xy.y?.name ?? "Y",
    seriesLabel: seriesField?.name ?? translate("系列"),
    seriesValues,
    pointCount: values.length,
  };
}

// —— hierarchy (treemap / sunburst / circlePacking) ————————————————————————

export interface HierarchyNode {
  name: string;
  value?: number;
  children?: HierarchyNode[];
}

export interface ChartHierarchyData {
  root: HierarchyNode;
  valueLabel: string;
  levelCount: number;
  /** Leaf count, for the "nothing to draw" state. */
  leafCount: number;
}

/**
 * Rows → a nested tree.
 *
 * VChart's hierarchy types take a single `categoryField` over *nested* data, so
 * the multi-level 层级 list becomes real nesting here rather than a flattened
 * joined label (a treemap whose every tile reads "A / B" is a bar chart in
 * disguise). Leaf values are the first measure's aggregate.
 */
export function buildHierarchyData(
  source: DataViewSource,
  levels: readonly DatabaseField[],
  measures: readonly ResolvedMeasure[],
  drill: ChartDrill | null,
  lookup?: NodeTitleLookup,
): ChartHierarchyData {
  const measure = measures[0]!;

  interface Draft {
    name: string;
    children: Map<string, Draft>;
    rows: DataRow[];
  }

  const root: Draft = {
    name: source.nodeTitle?.trim() || translate("全部"),
    children: new Map(),
    rows: [],
  };

  for (const row of source.rows) {
    const path = levels.map(
      (field) => text(row, field, lookup) || translate("（空）"),
    );
    if (drill && path[0] !== drill.dimension) continue;
    root.rows.push(row);
    let node = root;
    for (const segment of path) {
      let child = node.children.get(segment);
      if (!child) {
        child = { name: segment, children: new Map(), rows: [] };
        node.children.set(segment, child);
      }
      child.rows.push(row);
      node = child;
    }
  }

  let leafCount = 0;
  const finalize = (draft: Draft): HierarchyNode => {
    if (draft.children.size === 0) {
      leafCount += 1;
      return { name: draft.name, value: aggregateRows(draft.rows, measure) };
    }
    return {
      name: draft.name,
      children: Array.from(draft.children.values()).map(finalize),
    };
  };

  return {
    root: finalize(root),
    valueLabel: measure.label,
    levelCount: levels.length,
    leafCount,
  };
}

// —— sankey ————————————————————————————————————————————————————————————————

export interface ChartSankeyData {
  nodes: Array<{ name: string }>;
  links: Array<{ source: string; target: string; value: number }>;
  sourceLabel: string;
  targetLabel: string;
  valueLabel: string;
}

/**
 * Rows → a flow graph.
 *
 * One link per 来源 → 目标 pair, its weight the first measure's aggregate, so a
 * thousand rows with the same two endpoints draw one ribbon whose width is their
 * sum rather than a thousand overlapping ones.
 */
export function buildSankeyData(
  source: DataViewSource,
  flow: { source: DatabaseField | null; target: DatabaseField | null },
  measures: readonly ResolvedMeasure[],
  drill: ChartDrill | null,
  lookup?: NodeTitleLookup,
): ChartSankeyData | null {
  if (!flow.source || !flow.target) return null;
  const measure = measures[0]!;
  const nodes: string[] = [];
  const aggregated = new Map<
    string,
    { source: string; target: string; rows: DataRow[] }
  >();

  for (const row of source.rows) {
    const from = text(row, flow.source, lookup) || translate("（空）");
    const to = text(row, flow.target, lookup) || translate("（空）");
    if (drill && drill.dimension !== from && drill.dimension !== to) continue;
    if (!nodes.includes(from)) nodes.push(from);
    if (!nodes.includes(to)) nodes.push(to);
    const key = `${from}\u0000${to}`;
    const entry = aggregated.get(key);
    if (entry) entry.rows.push(row);
    else aggregated.set(key, { source: from, target: to, rows: [row] });
  }

  return {
    nodes: nodes.map((name) => ({ name })),
    links: Array.from(aggregated.values()).map((entry) => ({
      source: entry.source,
      target: entry.target,
      value: aggregateRows(entry.rows, measure),
    })),
    sourceLabel: flow.source.name,
    targetLabel: flow.target.name,
    valueLabel: measure.label,
  };
}

// —— single value (gauge / liquid / progress) ——————————————————————————————

export interface ChartSingleData {
  /** The measure's aggregate over the whole source. */
  value: number;
  /** The auto-scaled full scale, always ≥ `value` (see `niceMax`). */
  max: number;
  /** `value / max`, clamped to 0–1 — what the canvas actually encodes. */
  ratio: number;
  valueLabel: string;
  rowIds: string[];
}

/** Rows → one number: the first measure's aggregate over the whole source. */
export function buildSingleData(
  source: DataViewSource,
  measures: readonly ResolvedMeasure[],
): ChartSingleData {
  const measure = measures[0]!;
  const value = aggregateRows(source.rows, measure);
  const max = niceMax(value);
  return {
    value,
    max,
    ratio: max > 0 ? Math.min(1, Math.max(0, value / max)) : 0,
    valueLabel: measure.label,
    rowIds: source.rows.map((row) => row.id),
  };
}
