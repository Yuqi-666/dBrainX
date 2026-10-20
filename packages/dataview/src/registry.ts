// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { translate } from "@workspace/ui/lib/i18n/runtime";

/**
 * The data view registry — the single place a view type is declared.
 *
 * Adding a view means implementing its renderer (+ config editor, unless every
 * setting lives in its toolbar) and adding one entry here; `DataViewRoot` and the
 * toolbars all read this table and never switch on `DataViewType` themselves
 * (README §6).
 *
 * Renderers and config editors are `React.lazy` so a view's third-party bundle
 * (VTable, FullCalendar, VChart, …) is only fetched the first time that view is
 * opened (README §3.3/§9.1).
 */
import { lazy } from "react";
import type { ComponentType, LazyExoticComponent } from "react";
import {
  CalendarDays,
  ChartGantt,
  ChartPie,
  Images,
  Network,
  SquareKanban,
  Table2,
} from "lucide-react";
import type {
  DataViewConfig,
  DataViewConfigOf,
  DataViewSource,
  DataViewSourceKind,
  DataViewType,
} from "@workspace/interfaces";

import { createDefaultConfig } from "./defaults";
import type {
  DataViewConfigEditorProps,
  DataViewRendererProps,
} from "./source/types";

export type DataViewRendererComponent = ComponentType<
  DataViewRendererProps<DataViewConfig>
>;
export type DataViewConfigEditorComponent = ComponentType<
  DataViewConfigEditorProps<DataViewConfig>
>;

export interface DataViewDescriptor {
  type: DataViewType;
  /** Menu / tab label, e.g. "表格". */
  label: string;
  icon: ComponentType<{ className?: string }>;
  /** Host kinds this view may appear on. */
  nodeTypes: DataViewSourceKind[];
  renderer: LazyExoticComponent<DataViewRendererComponent>;
  /**
   * The view's generic config editor — **absent when the view configures itself
   * entirely from its own toolbar**. Today that is every view: the table's seven
   * menus, the kanban's three panels, the calendar's and the gantt's two, the
   * chart's three and the graph's 布局 / 视图 are each a dedicated menu, so no
   * descriptor registers an editor and nothing renders a 视图配置 popover.
   *
   * The slot is kept (with `ViewConfigMenu`) for a future view whose settings
   * have no dedicated control yet: a registry entry may `lazy()` its
   * `config-editor.tsx` into it and the toolbar picks it up automatically.
   */
  configEditor?: LazyExoticComponent<DataViewConfigEditorComponent>;
  defaultConfig: (source: DataViewSource) => DataViewConfig;
}

/**
 * Wraps a per-type renderer so the registry stays uniformly typed. The cast is
 * confined here: each call site still proves that the module it loads has the
 * renderer signature of the type it is registered under.
 */
function defineRenderer<T extends DataViewType>(
  loader: () => Promise<{
    default: ComponentType<DataViewRendererProps<DataViewConfigOf<T>>>;
  }>,
): LazyExoticComponent<DataViewRendererComponent> {
  return lazy(
    loader,
  ) as unknown as LazyExoticComponent<DataViewRendererComponent>;
}

export const DATA_VIEW_REGISTRY: Record<DataViewType, DataViewDescriptor> = {
  table: {
    type: "table",
    get label() {
      return translate("表格");
    },
    icon: Table2,
    nodeTypes: ["database", "collection"],
    renderer: defineRenderer<"table">(() =>
      import("./views/table/table-data-view").then((module) => ({
        default: module.TableDataView,
      })),
    ),
    // No `configEditor`: the table's configuration is the toolbar's menus.
    defaultConfig: (source) => createDefaultConfig("table", source),
  },
  kanban: {
    type: "kanban",
    get label() {
      return translate("看板");
    },
    icon: SquareKanban,
    nodeTypes: ["database", "collection"],
    renderer: defineRenderer<"kanban">(() =>
      import("./views/kanban/kanban-data-view").then((module) => ({
        default: module.KanbanDataView,
      })),
    ),
    // No `configEditor`: the kanban's four settings panels (分组 / 卡片 / 排序 /
    // 显示) are its toolbar, exactly like the table's seven menus.
    defaultConfig: (source) => createDefaultConfig("kanban", source),
  },
  calendar: {
    type: "calendar",
    get label() {
      return translate("日历");
    },
    icon: CalendarDays,
    nodeTypes: ["database", "collection"],
    renderer: defineRenderer<"calendar">(() =>
      import("./views/calendar/calendar-data-view").then((module) => ({
        default: module.CalendarDataView,
      })),
    ),
    // No `configEditor`: 字段 / 视图 / 交互 / 显示 are the calendar's own toolbar
    // panels, exactly like the table's seven menus and the kanban's four.
    defaultConfig: (source) => createDefaultConfig("calendar", source),
  },
  gantt: {
    type: "gantt",
    get label() {
      return translate("甘特图");
    },
    icon: ChartGantt,
    // Gantt needs a start/end date pair; collection exposes created/updated.
    nodeTypes: ["database", "collection"],
    renderer: defineRenderer<"gantt">(() =>
      import("./views/gantt/gantt-data-view").then((module) => ({
        default: module.GanttDataView,
      })),
    ),
    // No `configEditor`: 字段配置 / 视图 cover every `GanttViewConfig` key a user
    // can decide (the five roles as config items, plus 粒度 / 行高 / 今日线 /
    // 周末), exactly like the table's menus, the kanban's panels and the
    // calendar's two.
    defaultConfig: (source) => createDefaultConfig("gantt", source),
  },
  gallery: {
    type: "gallery",
    get label() {
      return translate("画廊");
    },
    icon: Images,
    nodeTypes: ["database", "collection"],
    renderer: defineRenderer<"gallery">(() =>
      import("./views/gallery/gallery-data-view").then((module) => ({
        default: module.GalleryDataView,
      })),
    ),
    // No `configEditor`: 字段 / 布局 / 显示 are the gallery's own toolbar panels,
    // exactly like the table's menus, the kanban's four and the calendar's four.
    defaultConfig: (source) => createDefaultConfig("gallery", source),
  },
  chart: {
    type: "chart",
    get label() {
      return translate("图表");
    },
    icon: ChartPie,
    nodeTypes: ["database", "collection"],
    renderer: defineRenderer<"chart">(() =>
      import("./views/chart/chart-data-view").then((module) => ({
        default: module.ChartDataView,
      })),
    ),
    // No `configEditor`: 图表 / 字段配置 / 视图 cover every `ChartViewConfig` key
    // a user can decide (the type catalogue, the role encodings, and the
    // presentation), exactly like the table's seven menus and the gantt's two
    // panels.
    defaultConfig: (source) => createDefaultConfig("chart", source),
  },
  graph: {
    type: "graph",
    get label() {
      return translate("节点图");
    },
    icon: Network,
    // Database rows are not graph nodes, so there is nothing to draw.
    nodeTypes: ["collection"],
    renderer: defineRenderer<"graph">(() =>
      import("./views/graph/graph-data-view").then((module) => ({
        default: module.GraphDataView,
      })),
    ),
    // No `configEditor`: 布局 / 视图 are the graph's own toolbar panels, exactly
    // like the six other views' panels. The collection's filter is *not* view
    // config — it is the node content's, and the host (`collection-node-content`)
    // renders its entry and its editor next to the write path.
    defaultConfig: (source) => createDefaultConfig("graph", source),
  },
};

/** Registry order — used for the "new view" menu and tab ordering. */
export const DATA_VIEW_DESCRIPTOR_LIST: DataViewDescriptor[] =
  Object.values(DATA_VIEW_REGISTRY);

export function getDataViewDescriptor(type: DataViewType): DataViewDescriptor {
  return DATA_VIEW_REGISTRY[type];
}

/** Descriptors whose `nodeTypes` allow `kind` (capability matrix, README §7). */
export function getDataViewDescriptorsForKind(
  kind: DataViewSourceKind,
): DataViewDescriptor[] {
  return DATA_VIEW_DESCRIPTOR_LIST.filter((descriptor) =>
    descriptor.nodeTypes.includes(kind),
  );
}

/**
 * Whether `kind` may host `type`.
 *
 * Deliberately defensive about the key: the type arrives from **persisted** node
 * content, so a view saved by an older build (the `nodeGraph` → `graph` rename)
 * or by a newer one must degrade into "not allowed" rather than crashing on
 * `undefined.nodeTypes`. `DataViewRoot` then drops it and self-heals.
 */
export function isDataViewTypeAllowed(
  type: DataViewType,
  kind: DataViewSourceKind,
): boolean {
  return DATA_VIEW_REGISTRY[type]?.nodeTypes.includes(kind) ?? false;
}
